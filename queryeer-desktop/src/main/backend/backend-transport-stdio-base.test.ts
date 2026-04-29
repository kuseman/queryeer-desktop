import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StdioBackendTransportBase } from "./backend-transport-stdio-base.js";
import type { BackendTransportCallbacks } from "./backend-transport.js";

class TestStdioTransport extends StdioBackendTransportBase {
  public readonly mode = "prod-jar" as const;

  public constructor(
    callbacks: BackendTransportCallbacks,
    private readonly proc: ChildProcessWithoutNullStreams
  ) {
    super(callbacks);
  }

  protected async spawnBackendProcess(): Promise<ChildProcessWithoutNullStreams> {
    return this.proc;
  }
}

function createProcessStub(pid = 4242): ChildProcessWithoutNullStreams {
  const proc = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.defineProperty(proc, "pid", { value: pid, configurable: true });
  proc.stdin = new PassThrough() as ChildProcessWithoutNullStreams["stdin"];
  proc.stdout = new PassThrough() as ChildProcessWithoutNullStreams["stdout"];
  proc.stderr = new PassThrough() as ChildProcessWithoutNullStreams["stderr"];
  return proc;
}

describe("StdioBackendTransportBase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies died when stdout closes", async () => {
    const proc = createProcessStub();
    const onDied = vi.fn();
    const transport = new TestStdioTransport(
      {
        onEnvelope: vi.fn(),
        onDiagnostic: vi.fn(),
        onDied
      },
      proc
    );

    await transport.start();
    proc.stdout.emit("close");

    expect(onDied).toHaveBeenCalledTimes(1);
  });

  it("only notifies died once across stdout close and process exit", async () => {
    const proc = createProcessStub();
    const onDied = vi.fn();
    const transport = new TestStdioTransport(
      {
        onEnvelope: vi.fn(),
        onDiagnostic: vi.fn(),
        onDied
      },
      proc
    );

    await transport.start();
    proc.stdout.emit("end");
    proc.emit("exit", 1, null);

    expect(onDied).toHaveBeenCalledTimes(1);
  });
});
