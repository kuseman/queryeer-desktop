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

export type NativeQueryExecuteRequest = {
  /** The query file to run. Its query editor runs it now if mounted, otherwise as soon as it shows the file. */
  fileId: string;
  /**
   * Text to run instead of the editor's content or selection. Pass it when the file was just
   * created, since the editor content may not be loaded yet when the run starts.
   */
  text?: string;
};

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
  /**
   * Requests a run of a query file, like the Execute Query command but aimed at `fileId`
   * instead of the active editor. Only one request is pending at a time; a later request
   * (from any source) replaces one whose editor has not picked it up yet.
   */
  execute: (request: NativeQueryExecuteRequest) => void;
};
