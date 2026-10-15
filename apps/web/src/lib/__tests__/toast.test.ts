import { afterEach, describe, expect, it, vi } from "vitest";

import { toast, toastFromMessage, useToasts } from "../toast";

afterEach(() => {
  useToasts.setState({ toasts: [] });
  vi.useRealTimers();
});

describe("toast", () => {
  it("resolves a pending toast in place (one toast per transaction)", () => {
    const id = toast.pending("Confirming…");
    toast.success("Bought 0.41 YES", { id, href: "https://explorer.solana.com/tx/x" });
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, kind: "success", title: "Bought 0.41 YES" });
  });

  it("never auto-dismisses a pending toast; dismisses the rest on a timer", () => {
    vi.useFakeTimers();
    toast.pending("Signing…");
    toast.info("hello");
    vi.advanceTimersByTime(10_000);
    expect(useToasts.getState().toasts.map((t) => t.kind)).toEqual(["pending"]);
  });

  it("infers the tone of legacy messages", () => {
    toastFromMessage("Sell failed: insufficient funds");
    toastFromMessage("Market created");
    expect(useToasts.getState().toasts.map((t) => t.kind)).toEqual(["error", "info"]);
  });
});
