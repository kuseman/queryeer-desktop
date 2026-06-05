import { useState, useEffect, useMemo } from "react";
import type { OutputContext } from "@queryeer/api/queryengine/OutputExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getQueryEditorStatusItems } from "@queryeer/api/queryengine/QueryEditorStatusExtension";

type Props = {
  outputContext: OutputContext;
  file: FileEntity | undefined;
};

export function QueryEditorStatusBar({ outputContext, file }: Props): JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (outputContext.state !== "running" || outputContext.executionStartedAtMs == null) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [outputContext.state, outputContext.executionStartedAtMs]);

  const context = outputContext;
  const elapsedMs = context.state === "running" && context.executionStartedAtMs != null
    ? Math.max(0, nowMs - context.executionStartedAtMs)
    : (context.metrics?.durationMs ?? null);
  const rowCount = context.state === "completed"
    ? (context.metrics?.rowCount ?? context.fetchedRowCount)
    : context.fetchedRowCount;

  const statusItems = useMemo(() => getQueryEditorStatusItems(), []);
  const leftItems = statusItems.filter((i) => (i.alignment ?? "left") === "left");
  const rightItems = statusItems.filter((i) => i.alignment === "right");

  return (
    <div className="query-output-status-bar">
      <div className="query-output-status-bar-left">
        <span>State: {context.state}</span>
        <span>Rows fetched: {Math.max(0, rowCount).toLocaleString()}</span>
        <span>Elapsed: {elapsedMs != null ? `${elapsedMs}ms` : "-"}</span>
        {context.progress?.message && <span>{context.progress.message}</span>}
        {leftItems.map((item) => (
          <span key={item.id} className="query-output-status-item">
            {item.render({ fileId: file?.fileId ?? "", file, outputContext: context })}
          </span>
        ))}
      </div>
      <div className="query-output-status-bar-right">
        {rightItems.map((item) => (
          <span key={item.id} className="query-output-status-item">
            {item.render({ fileId: file?.fileId ?? "", file, outputContext: context })}
          </span>
        ))}
      </div>
    </div>
  );
}
