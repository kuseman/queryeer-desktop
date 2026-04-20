import {
  BACKEND_PROTOCOL_VERSION,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope
} from "./Envelope";
import type { BackendNotificationMethod, BackendRequestMethod } from "./Methods";
import type {
  NotificationParamsOf,
  RequestParamsOf,
  RequestResultOf
} from "./Types";

export function createRequestEnvelope<TMethod extends BackendRequestMethod>(
  id: string,
  method: TMethod,
  params: RequestParamsOf<TMethod>
): BackendRequestEnvelope<TMethod, RequestParamsOf<TMethod>> {
  return {
    protocolVersion: BACKEND_PROTOCOL_VERSION,
    type: "request",
    id,
    method,
    params
  };
}

export function createSuccessResponseEnvelope<TMethod extends BackendRequestMethod>(
  id: string,
  result: RequestResultOf<TMethod>
): BackendResponseEnvelope<RequestResultOf<TMethod>> {
  return {
    protocolVersion: BACKEND_PROTOCOL_VERSION,
    type: "response",
    id,
    result
  };
}

export function createNotificationEnvelope<TMethod extends BackendNotificationMethod>(
  method: TMethod,
  params: NotificationParamsOf<TMethod>
): BackendNotificationEnvelope<TMethod, NotificationParamsOf<TMethod>> {
  return {
    protocolVersion: BACKEND_PROTOCOL_VERSION,
    type: "notification",
    method,
    params
  };
}
