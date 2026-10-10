# Resolution Service

Initial backend contract package for the closed devnet beta. It defines strict v1 resolution-spec and evidence-manifest shapes, a conservative deterministic transcript evaluator, canonical JSON, and SHA-256 commitment helpers. Evidence hashes require the corresponding resolution spec, binding evidence to the market rules and source. Fixed commitment vectors are in the tests for future Rust parity. It intentionally does not read RPC, hold a resolver key, or submit transactions yet.

Run the contract tests from this directory:

```bash
pnpm test
```

The JSON field sets are versioned contracts. Changing them requires a new schema version and shared test vectors before they are used by the program or web client.