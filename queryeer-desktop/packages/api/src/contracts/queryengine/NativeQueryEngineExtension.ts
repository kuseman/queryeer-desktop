import type { EngineInvokeParams } from "../backend/Types.js";
import type { QueryExecuteOptions } from "../backend/Types.js";
import type { Disposable } from "../editor/EditorApi.js";
import type { QueryEditorHeaderItemContribution } from "./QueryEditorHeaderExtension.js";
import type { QueryEditorStatusItemContribution } from "./QueryEditorStatusExtension.js";

export type NativeQueryEngineContribution = {
  engineId: string;
  mimeTypes: readonly string[];
};

export type NativeQueryEngineInvokeOptions = {
  silent?: boolean;
};

export type NativeQueryExecutionContext = {
  engineId: string;
  text: string;
  fileId: string;
  engineState?: unknown;
  options?: QueryExecuteOptions;
  targetOutputSessionId?: string;
  interactiveSecurity?: boolean;
};

export type NativeQueryExecutionContextProvider = (
  context: NativeQueryExecutionContext
) => { engineState?: unknown; options?: QueryExecuteOptions } | void;

export type NativeQueryEvent = {
  method: string;
  params: unknown;
};

export type NativeQueryEventListener = (
  event: NativeQueryEvent,
  context: NativeQueryExecutionContext
) => void;

export type NativeQueryEngineRegistry = {
  registerEngine: (contribution: NativeQueryEngineContribution) => Disposable;
  invoke: <TResult = unknown>(
    params: EngineInvokeParams,
    options?: NativeQueryEngineInvokeOptions
  ) => Promise<TResult>;
  registerExecutionContextProvider: (
    engineId: string,
    provider: NativeQueryExecutionContextProvider
  ) => Disposable;
  onQueryEvent: (engineId: string, listener: NativeQueryEventListener) => Disposable;
  registerEditorHeaderItem: (contribution: QueryEditorHeaderItemContribution) => Disposable;
  registerEditorStatusItem: (contribution: QueryEditorStatusItemContribution) => Disposable;
};
