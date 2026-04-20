import type { BackendError } from "./ErrorCode";

export const BACKEND_PROTOCOL_VERSION = "1.0.0";

export type ProtocolVersion = typeof BACKEND_PROTOCOL_VERSION;

export type BackendEnvelopeType = "request" | "response" | "notification";

export type BackendRequestEnvelope<
  TMethod extends string = string,
  TParams = unknown
> = {
  protocolVersion: ProtocolVersion;
  type: "request";
  id: string;
  method: TMethod;
  params: TParams;
};

export type BackendResponseEnvelope<TResult = unknown> = {
  protocolVersion: ProtocolVersion;
  type: "response";
  id: string;
  result?: TResult;
  error?: BackendError;
};

export type BackendNotificationEnvelope<
  TMethod extends string = string,
  TParams = unknown
> = {
  protocolVersion: ProtocolVersion;
  type: "notification";
  method: TMethod;
  params: TParams;
};

export type BackendEnvelope =
  | BackendRequestEnvelope
  | BackendResponseEnvelope
  | BackendNotificationEnvelope;
