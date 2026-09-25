import { useState, useEffect, useMemo } from "react";
import type { OutputContext } from "@queryeer/api/queryengine/OutputExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { QueryScheduleState } from "@queryeer/api/queryengine/QueryEngineTypes.js";
import { getQueryEditorStatusItems } from "@queryeer/api/queryengine/QueryEditorStatusExtension";

type Props = {
  outputContext: OutputContext;
  file: FileEntity | undefined;
  schedule?: QueryScheduleState | null;
  onStopSchedule?: () => void;
};

export function QueryEditorStatusBar({ outputContext, file, schedule, onStopSchedule }: Props): JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if ((outputContext.state !== "running" || outputContext.executionStartedAtMs == null) && !schedule) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [outputContext.state, outputContext.executionStartedAtMs, schedule]);

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
  const nextRunSeconds = schedule?.nextRunAtMs !== undefined
    ? Math.max(0, Math.ceil((schedule.nextRunAtMs - nowMs) / 1000))
    : null;

  return (
    <div className="query-output-status-bar">
      <div className="query-output-status-bar-left">
        <span>State: {context.state}</span>
        <span>Rows fetched: {Math.max(0, rowCount).toLocaleString()}</span>
        <span>Elapsed: {elapsedMs != null ? `${elapsedMs}ms` : "-"}</span>
        {context.progress?.message && <span>{context.progress.message}</span>}
        {schedule ? (
          <span className={`query-output-schedule-status ${schedule.paused ? "is-paused" : ""}`.trim()}>
            {schedule.paused
              ? `Auto-run paused: ${schedule.pauseReason ?? "paused"}`
              : context.state === "running"
                ? `Auto-run: every ${schedule.intervalSeconds}s | running`
                : `Auto-run: every ${schedule.intervalSeconds}s | next in ${nextRunSeconds ?? schedule.intervalSeconds}s`}
            {onStopSchedule ? (
              <button type="button" className="query-output-schedule-stop" onClick={onStopSchedule}>Stop</button>
            ) : null}
          </span>
        ) : null}
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
