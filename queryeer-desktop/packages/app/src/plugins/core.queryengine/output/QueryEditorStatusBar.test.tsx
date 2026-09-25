import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_OUTPUT_CONTEXT } from "@queryeer/api/queryengine/OutputExtension";
import { QueryEditorStatusBar } from "./QueryEditorStatusBar";

describe("QueryEditorStatusBar schedules", () => {
  let element: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });

  afterEach(() => {
    act(() => root.unmount());
    element.remove();
    vi.useRealTimers();
  });

  it("shows the interval countdown and stops from the status bar", () => {
    const onStop = vi.fn();
    act(() => {
      root.render(
        <QueryEditorStatusBar
          outputContext={IDLE_OUTPUT_CONTEXT}
          file={undefined}
          schedule={{
            intervalSeconds: 5,
            paused: false,
            nextRunAtMs: Date.now() + 5_000,
            consecutiveInfrastructureFailures: 0
          }}
          onStopSchedule={onStop}
        />
      );
    });

    expect(element.textContent).toContain("Auto-run: every 5s | next in 5s");
    act(() => (element.querySelector(".query-output-schedule-stop") as HTMLButtonElement).click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows why a schedule is paused", () => {
    act(() => {
      root.render(
        <QueryEditorStatusBar
          outputContext={IDLE_OUTPUT_CONTEXT}
          file={undefined}
          schedule={{
            intervalSeconds: 5,
            paused: true,
            pauseReason: "Security vault is locked",
            consecutiveInfrastructureFailures: 0
          }}
        />
      );
    });

    expect(element.textContent).toContain("Auto-run paused: Security vault is locked");
  });
});
