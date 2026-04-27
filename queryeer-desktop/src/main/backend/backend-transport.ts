import type { BackendEnvelope } from "../../contracts/backend/index.js";
import type { BackendGatewayMode } from "../../contracts/backend/index.js";
import { MockJavaBackend } from "./mock-java-backend.js";

export type BackendTransport = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendEnvelope: (envelope: BackendEnvelope) => void;
  readonly mode: BackendGatewayMode;
};

export type TransportDiagnostic = {
  level: "debug" | "info" | "warn" | "error";
  source: "transport" | "backend" | "backend-console";
  message: string;
};

export type BackendTransportCallbacks = {
  onEnvelope: (envelope: BackendEnvelope) => void;
  onDiagnostic: (event: TransportDiagnostic) => void;
  /** Called when the underlying process exits unexpectedly (not due to stop()). */
  onDied: () => void;
};

export type BackendTransportFactory = {
  mode: BackendGatewayMode;
  create: (callbacks: BackendTransportCallbacks) => BackendTransport;
};

export class MockBackendTransport implements BackendTransport {
  public readonly mode = "mock-stdio" as const;
  private readonly backend: MockJavaBackend;

  public constructor(onEnvelope: (envelope: BackendEnvelope) => void) {
    this.backend = new MockJavaBackend(onEnvelope);
  }

  public async start(): Promise<void> {}

  public async stop(): Promise<void> {}

  public sendEnvelope(envelope: BackendEnvelope): void {
    this.backend.onEnvelope(envelope);
  }
}
