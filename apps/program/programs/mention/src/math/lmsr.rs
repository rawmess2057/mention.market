/// LMSR pricing (port of `apps/web/src/lib/lmsr.ts`) for on-chain use.
///
/// State is `(q_yes, q_no, b)` in base units (lamports or USDC 1e-6 units) for
/// q/b, and the same units for the resulting costs/shares. All math runs in
/// f64 via `libm` so the program compiles to BPF; the SBF host and the TS
/// preview implement the same IEEE-754 operations, so quotes match to
/// float precision. This is fixed-point-safe for staging and must be replaced
/// by a 64.64 fixed-point implementation before mainnet.

use std::f64::consts::LN_2;

pub const LN2: f64 = LN_2;

/// C(q) = b * ln(e^{q_y/b} + e^{q_n/b}) — numerically stable against overflow
/// by factoring out the dominant exponent. Always >= max(q_y, q_n).
pub fn cost_units(q_y: f64, q_n: f64, b: f64) -> f64 {
    let m = q_y.max(q_n);
    let ey = libm::exp((q_y - m) / b);
    let en = libm::exp((q_n - m) / b);
    m + b * libm::log(ey + en)
}

/// Implied probability of YES in (0..1).
pub fn price_yes(q_y: f64, q_n: f64, b: f64) -> f64 {
    let m = q_y.max(q_n);
    let ey = libm::exp((q_y - m) / b);
    let en = libm::exp((q_n - m) / b);
    ey / (ey + en)
}

fn after(q_y: f64, q_n: f64, side: u8, shares: f64) -> (f64, f64) {
    match side {
        0 => (q_y + shares, q_n),
        _ => (q_y, q_n + shares),
    }
}

fn before(q_y: f64, q_n: f64, side: u8, shares: f64) -> (f64, f64) {
    match side {
        0 => (q_y - shares, q_n),
        _ => (q_y, q_n - shares),
    }
}

/// Cost to acquire `shares` of `side` (0 = YES, 1 = NO).
pub fn cost_delta(q_y: f64, q_n: f64, b: f64, side: u8, shares: f64) -> f64 {
    let (ay, an) = after(q_y, q_n, side, shares);
    cost_units(ay, an, b) - cost_units(q_y, q_n, b)
}

/// Payout received for selling `shares` of `side` back to the AMM.
pub fn sell_return(q_y: f64, q_n: f64, b: f64, side: u8, shares: f64) -> f64 {
    let (by, bn) = before(q_y, q_n, side, shares);
    cost_units(q_y, q_n, b) - cost_units(by, bn, b)
}

/// Shares granted for a given `cost`, by monotonic binary search (mirrors the
/// TS `lmsrSharesForCost`).
pub fn shares_for_cost(q_y: f64, q_n: f64, b: f64, side: u8, cost: f64) -> f64 {
    if cost <= 0.0 {
        return 0.0;
    }
    let mut lo = 0.0f64;
    let mut hi = 1.0f64;
    while cost_delta(q_y, q_n, b, side, hi) < cost {
        hi *= 2.0;
    }
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if cost_delta(q_y, q_n, b, side, mid) < cost {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

/// Creator ante required to seed a market: the theoretical max AMM loss is
/// b * ln(2). Depositing this makes the vault anti-property solvent at all
/// times (see crate docs for the invariant `vault_balance >= C(bal)`).
pub fn reserve_ante(b: u64) -> u64 {
    (b as f64 * LN2).ceil() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64, tol: f64, ctx: &str) {
        assert!(
            (actual - expected).abs() <= tol,
            "{ctx}: got {actual}, expected {expected}"
        );
    }

    #[test]
    fn shares_for_cost_matches_ts() {
        // Vectors pinned from lmsr.ts (q in base units, b in base units).
        let cases: &[(f64, f64, f64, u8, f64, f64)] = &[
            // (q_y, q_n, b, side, cost, expected_shares)
            (100.0, 100.0, 100.0, 0, 50.0, 83.179657),
            (100.0, 100.0, 100.0, 1, 25.0, 44.983334),
            (200.0, 80.0, 120.0, 0, 75.0, 93.939667),
            (80.0, 200.0, 120.0, 1, 40.0, 51.903475),
            (0.0, 0.0, 100.0, 0, 10.0, 19.090283),
            (0.0, 0.0, 100.0, 1, 7.0, 13.541893),
            (150.0, 150.0, 100.0, 1, 33.0, 57.770056),
        ];
        for (qy, qn, b, side, cost, exp) in cases {
            let shares = shares_for_cost(*qy, *qn, *b, *side, *cost);
            close(shares, *exp, 1e-4, &format!("shares_for_cost({qy},{qn},{b},{side},{cost})"));
        }
    }

    #[test]
    fn sell_return_matches_ts() {
        let cases: &[(f64, f64, f64, u8, f64, f64)] = &[
            (150.0, 100.0, 100.0, 0, 50.0, 28.09298),
            (100.0, 150.0, 100.0, 1, 33.0, 19.232165),
            (250.0, 80.0, 120.0, 0, 120.0, 85.293887),
        ];
        for (qy, qn, b, side, sh, exp) in cases {
            let ret = sell_return(*qy, *qn, *b, *side, *sh);
            close(ret, *exp, 1e-4, &format!("sell_return({qy},{qn},{b},{side},{sh})"));
        }
    }

    #[test]
    fn price_yes_matches_ts() {
        close(price_yes(100.0, 100.0, 100.0), 0.5, 1e-9, "balanced");
        close(price_yes(200.0, 80.0, 120.0), 0.731059, 1e-4, "skewed");
    }

    #[test]
    fn cost_covers_worst_case_payout() {
        // Solvency invariant: C(q) >= max(q_y, q_n).
        for (qy, qn, b) in [(0.0, 0.0, 100.0), (100.0, 100.0, 100.0), (1e6, 3.0, 120.0)] {
            let c = cost_units(qy, qn, b);
            assert!(c >= qy.max(qn), "C({qy},{qn},{b})={c} < max");
        }
    }

    #[test]
    fn ante_is_ceil_b_ln2() {
        assert_eq!(reserve_ante(100), 70); // ceil(69.31)
        assert_eq!(reserve_ante(1), 1);
    }
}