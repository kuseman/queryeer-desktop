import { describe, expect, it, vi, type Mock } from "vitest";
import {
  BACKEND_PROTOCOL_VERSION,
  type BackendError,
  type BackendEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type HandshakeResult,
  type PingResult,
  type RuntimeStatusResult,
  type QueryCancelParams,
  type QueryCancelResult,
  type QueryExecuteParams,
  type QueryExecuteResult
} from "../../contracts/backend";
import { BackendGateway } from "./backend-gateway";

type EnvelopeHandler = (envelope: BackendEnvelope) => void;

type TestTransport = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendEnvelope: Mock<(envelope: BackendEnvelope) => void>;
  mode: "mock-stdio";
  emitEnvelope: (envelope: BackendEnvelope) => void;
};

type TransportBehavior = {
  dropHandshake?: boolean;
  dropExecute?: boolean;
  failExecuteSend?: boolean;
  failPingAfterStart?: boolean;
};

const createGatewayWithTestTransport = (behavior: TransportBehavior = {}) => {
  let onEnvelope: EnvelopeHandler | null = null;
  let pingCount = 0;

  const transport: TestTransport = {
    mode: "mock-stdio",
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    sendEnvelope: vi.fn((envelope: BackendEnvelope) => {
      if (envelope.type !== "request") {
        return;
      }

      if (envelope.method === "backend.handshake") {
        if (behavior.dropHandshake) {
          return;
        }
        respond(envelope.id, {
          server: {
            name: "queryeer-java-backend",
            version: "0.1.0"
          },
          selectedProtocolVersion: BACKEND_PROTOCOL_VERSION,
          supportedCapabilities: [
            "backend.runtimeStatus",
            "health.ping",
            "query.execute",
            "query.cancel",
            "query.progress",
            "query.resultChunk",
            "query.completed",
            "query.failed"
          ]
        } satisfies HandshakeResult);
        return;
      }

      if (envelope.method === "health.ping") {
        pingCount += 1;
        if (behavior.failPingAfterStart && pingCount > 1) {
          respondError(envelope.id, {
            code: "TIMEOUT",
            message: "Simulated ping timeout"
          });
          return;
        }
        respond(envelope.id, {
          timestamp: "2026-01-01T00:00:00.000Z",
          uptimeMs: 1234
        } satisfies PingResult);
        return;
      }

      if (envelope.method === "backend.runtimeStatus") {
        respond(envelope.id, {
          startedAt: "2026-01-01T00:00:00.000Z",
          pluginStatuses: [
            {
              pluginId: "query.payloadbuilder",
              state: "activated",
              reason: "Activated"
            }
          ],
          activatedPluginIds: ["query.payloadbuilder"],
          providedCapabilities: ["query.execute"]
        } satisfies RuntimeStatusResult);
        return;
      }

      if (envelope.method === "query.execute") {
        if (behavior.failExecuteSend) {
          throw new Error("Simulated execute send failure");
        }
        if (behavior.dropExecute) {
          return;
        }
        const params = envelope.params as QueryExecuteParams;
        respond(envelope.id, {
          accepted: true,
          queryExecutionId: params.queryExecutionId
        } satisfies QueryExecuteResult);
        return;
      }

      if (envelope.method === "query.cancel") {
        const params = envelope.params as QueryCancelParams;
        respond(envelope.id, {
          accepted: true,
          queryExecutionId: params.queryExecutionId
        } satisfies QueryCancelResult);
      }
    }),
    emitEnvelope: (envelope: BackendEnvelope) => {
      onEnvelope?.(envelope);
    }
  };

  const respond = (id: string, result: unknown): void => {
    const response: BackendResponseEnvelope = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id,
      result
    };
    onEnvelope?.(response);
  };

  const respondError = (
    id: string,
    error: Omit<BackendError, "details"> & { details?: Record<string, unknown> }
  ): void => {
    const response: BackendResponseEnvelope = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id,
      error
    };
    onEnvelope?.(response);
  };

  const gateway = new BackendGateway((envelopeHandler, onDiagnostic) => {
    onEnvelope = envelopeHandler;
    void onDiagnostic;
    return transport;
  });

  return {
    gateway,
    transport
  };
};

describe("BackendGateway", () => {
  it("starts healthy with handshake and ping", async () => {
    const { gateway } = createGatewayWithTestTransport();

    await gateway.start();

    const status = gateway.getStatus();
    expect(status.state).toBe("healthy");
    expect(status.serverName).toBe("queryeer-java-backend");
    expect(status.supportedCapabilities).toContain("query.execute");

    await gateway.stop();
  });

  it("execute query sends request and tracks accepted execution", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    const result = await gateway.executeQuery({
      queryExecutionId: "exec-1",
      engineId: "payloadbuilder",
      text: "select 1"
    });

    expect(result.accepted).toBe(true);
    expect(result.queryExecutionId).toBe("exec-1");

    const status = gateway.getStatus();
    expect(status.activeExecutionIds).toContain("exec-1");
    expect(status.recentExecutions[0]?.queryExecutionId).toBe("exec-1");

    const executeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "query.execute"
      );

    expect(executeRequest).toBeDefined();
    await gateway.stop();
  });

  it("marks unavailable when handshake times out", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ dropHandshake: true });

    const startPromise = gateway.start();
    await vi.advanceTimersByTimeAsync(90_001);
    await startPromise;

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("Request timeout: backend.handshake");

    await gateway.stop();
    vi.useRealTimers();
  });

  it("rejects execute query when send fails and sets unavailable", async () => {
    const { gateway } = createGatewayWithTestTransport({ failExecuteSend: true });
    await gateway.start();

    await expect(
      gateway.executeQuery({
        queryExecutionId: "exec-2",
        engineId: "payloadbuilder",
        text: "select 1"
      })
    ).rejects.toThrow("Simulated execute send failure");

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");

    await gateway.stop();
  });

  it("rejects execute query when request times out", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ dropExecute: true });
    await gateway.start();

    const executePromise = gateway.executeQuery({
      queryExecutionId: "exec-3",
      engineId: "payloadbuilder",
      text: "select 1"
    });

    const assertion = expect(executePromise).rejects.toThrow("Request timeout: query.execute");

    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;

    await gateway.stop();
    vi.useRealTimers();
  });

  it("logs warning for unknown response ids", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    transport.emitEnvelope({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: "req-unknown",
      result: { ok: true }
    });

    const warning = gateway
      .getStatus()
      .backendLogs.find((entry) => entry.level === "warn" && entry.message.includes("req-unknown"));

    expect(warning).toBeDefined();
    await gateway.stop();
  });

  it("marks unavailable when ping loop fails", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ failPingAfterStart: true });
    await gateway.start();

    await vi.advanceTimersByTimeAsync(5_100);

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("TIMEOUT");

    await gateway.stop();
    vi.useRealTimers();
  });
});
