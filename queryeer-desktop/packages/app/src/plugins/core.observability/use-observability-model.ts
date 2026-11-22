import { useMemo } from "react";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getRegisteredQueryExecutableEngines } from "../core.queryengine/engine-registration";
import { buildPluginRows, collectAttention, collectContributions } from "./model";
import { getRuntimeData } from "./runtime-data";
import { useObservabilityPolling } from "./use-observability-data";

/** What the editor and the sidebar menu show, re-read on every poll. */
export function useObservabilityModel(listFiles: () => FileEntity[]) {
  const { backendStatus, tick, refresh } = useObservabilityPolling();

  // The frontend state has no change events: re-read it on every poll
  const runtime = useMemo(() => getRuntimeData(), [tick]);
  const engines = useMemo(() => getRegisteredQueryExecutableEngines(), [tick]);
  const contributions = useMemo(() => (runtime ? collectContributions(runtime, engines) : []), [runtime, engines]);
  const rows = useMemo(() => (runtime ? buildPluginRows(runtime, backendStatus, contributions) : []), [runtime, backendStatus, contributions]);
  // Re-read on every poll: open files and their bindings have no change events here
  const fileMatches = useMemo(
    () => listFiles().map((file) => ({ file, ...getQueryEngineService().getEngineResolverDiagnostics(file.fileId) })),
    [tick]
  );
  const attention = useMemo(
    () => (runtime ? collectAttention(runtime, rows, backendStatus, fileMatches) : []),
    [runtime, rows, backendStatus, fileMatches]
  );

  return { backendStatus, refresh, runtime, engines, contributions, rows, fileMatches, attention };
}
