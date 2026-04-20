import { describe, expect, it, vi } from "vitest";
import type { BackendResponseEnvelope } from "../../contracts/backend";
import { BACKEND_PROTOCOL_VERSION } from "../../contracts/backend";
import { BackendPendingRequestMap } from "./backend-request-pending-map";

describe("BackendPendingRequestMap", () => {
  it("resolves pending requests and clears timeout", () => {
    vi.useFakeTimers();

    const pending = new BackendPendingRequestMap();
    const onResolve = vi.fn();
    const onReject = vi.fn();

    const timeout = setTimeout(() => {}, 10_000);
    pending.register("req-1", timeout, { onResolve, onReject });

    const response: BackendResponseEnvelope = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: "req-1",
      result: { ok: true }
    };

    expect(pending.resolve("req-1", response)).toBe(true);
    expect(onResolve).toHaveBeenCalledWith(response);
    expect(onReject).not.toHaveBeenCalled();
    expect(pending.size()).toBe(0);

    vi.useRealTimers();
  });

  it("rejects pending requests and clears timeout", () => {
    vi.useFakeTimers();

    const pending = new BackendPendingRequestMap();
    const onResolve = vi.fn();
    const onReject = vi.fn();

    const timeout = setTimeout(() => {}, 10_000);
    pending.register("req-2", timeout, { onResolve, onReject });

    const reason = new Error("failed");
    expect(pending.reject("req-2", reason)).toBe(true);
    expect(onReject).toHaveBeenCalledWith(reason);
    expect(onResolve).not.toHaveBeenCalled();
    expect(pending.size()).toBe(0);

    vi.useRealTimers();
  });
});
