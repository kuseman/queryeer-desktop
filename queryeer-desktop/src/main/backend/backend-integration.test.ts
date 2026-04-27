import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  BACKEND_PROTOCOL_VERSION,
  type QueryExecuteParams,
  type QueryCancelParams
} from "../../contracts/backend/index.js";
import { BackendGateway } from "./backend-gateway.js";
import { DevBackendTransport } from "./backend-transport-dev.js";

const INTEGRATION_STARTUP_TIMEOUT = 120_000;

let globalGateway: BackendGateway | null = null;

process.on("exit", () => {
  if (globalGateway) {
    try {
      globalGateway.stop();
    } catch {
      // ignore during exit
    }
  }
});

describe("Backend E2E Integration", () => {
  let gateway: BackendGateway;

  beforeAll(async () => {
    const devState = { dependenciesPrepared: false };
    gateway = new BackendGateway({
      mode: "dev-maven",
      create: (callbacks) => new DevBackendTransport(callbacks, devState)
    });
    globalGateway = gateway;
    await gateway.start();
  }, INTEGRATION_STARTUP_TIMEOUT);

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));
      globalGateway = null;
    }
  });

  it("completes handshake and becomes healthy", async () => {
    const status = gateway.getStatus();

    if (status.state !== "healthy") {
      console.log("Backend logs:", status.backendLogs.slice(-10));
      console.log("Status:", JSON.stringify(status, null, 2));
    }

    expect(status.state).toBe("healthy");
    expect(status.serverName).toBe("queryeer-java-backend");
    expect(status.protocolVersion).toBe(BACKEND_PROTOCOL_VERSION);
  });

  it("responds to health.ping", async () => {
    const status = gateway.getStatus();
    expect(status.lastPingAt).toBeDefined();
  });

  it("reports runtime status with plugins", async () => {
    const status = gateway.getStatus();
    expect(status.runtimeStatus).toBeDefined();
    expect(status.runtimeStatus?.activatedPluginIds).toBeDefined();
  });

  it("invokes payloadbuilder engine action end-to-end", async () => {
    const result = await gateway.invokeEngine({
      engineId: "payloadbuilder",
      fileId: "e2e-file-1",
      action: "payloadbuilder.echo",
      payload: { hello: "world" }
    });

    expect(result).toEqual({
      result: {
        fileId: "e2e-file-1",
        payload: { hello: "world" }
      }
    });
  }, 10_000);

  it.skip("cancels a never-started query", async () => {
    const cancelResult = await gateway.cancelQuery({
      queryExecutionId: "e2e-test-cancel-never-started",
    } satisfies QueryCancelParams);

    expect(cancelResult.accepted).toBe(true);
    expect(cancelResult.queryExecutionId).toBe("e2e-test-cancel-never-started");
  }, 10_000);

  it("accepts and executes a simple query", async () => {
    const result = await gateway.executeQuery({
      queryExecutionId: "e2e-test-exec-1",
      engineId: "payloadbuilder",
      text: "SELECT 1 AS col"
    } satisfies QueryExecuteParams);

    expect(result.accepted).toBe(true);
    expect(result.queryExecutionId).toBe("e2e-test-exec-1");

    const gatewayStatus = gateway.getStatus();
    expect(gatewayStatus.activeExecutionIds).toContain("e2e-test-exec-1");
  }, 30_000);

  it.skip("cancels a running query after execution completes", async () => {
    const execResult = await gateway.executeQuery({
      queryExecutionId: "e2e-test-cancel-target",
      engineId: "payloadbuilder",
      text: "SELECT 1"
    } satisfies QueryExecuteParams);
    expect(execResult.accepted).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const cancelResult = await gateway.cancelQuery({
      queryExecutionId: "e2e-test-cancel-target",
    } satisfies QueryCancelParams);

    expect(cancelResult.accepted).toBe(true);

    const status = gateway.getStatus();
    expect(status.activeExecutionIds).not.toContain("e2e-test-cancel-target");
  }, 30_000);

  it("accepts query but engine may not exist (backend validates)", async () => {
    const result = await gateway.executeQuery({
      queryExecutionId: "e2e-test-unknown-engine",
      engineId: "unknown-engine",
      text: "SELECT 1"
    } satisfies QueryExecuteParams);
    expect(result.accepted).toBe(true);
  }, 10_000);

  it("survives multiple sequential queries", async () => {
    for (let i = 1; i <= 3; i++) {
      const result = await gateway.executeQuery({
        queryExecutionId: `e2e-test-seq-${i}`,
        engineId: "payloadbuilder",
        text: "SELECT 1"
      } satisfies QueryExecuteParams);
      expect(result.accepted).toBe(true);
    }

    const status = gateway.getStatus();
    expect(status.recentExecutions.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("tracks query execution in recent executions", async () => {
    const status = gateway.getStatus();
    const lastExec = status.recentExecutions[0];
    expect(lastExec).toBeDefined();
    expect(lastExec?.queryExecutionId).toBeDefined();
    expect(lastExec?.engineId).toBeDefined();
  }, 10_000);
});
