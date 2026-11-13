import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_OUTPUT_CONTEXT } from "@queryeer/api/queryengine/OutputExtension";
import { QueryEditorStatusBar } from "./QueryEditorStatusBar";
import { registerQueryEditorStatusItem } from "../query-editor-status-registry";
import { registerQueryExecutableEngine } from "../engine-registration";
import { FileRegistry } from "../../../core/plugin-runtime/FileRegistry";

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

  it("renders status items registered after the component mounts", () => {
    act(() => {
      root.render(<QueryEditorStatusBar outputContext={IDLE_OUTPUT_CONTEXT} file={undefined} />);
    });
    expect(element.textContent).not.toContain("MongoDB status");

    act(() => {
      registerQueryEditorStatusItem({
        id: "test.mongodb.status-bar",
        alignment: "right",
        render: () => "MongoDB status"
      });
    });

    expect(element.querySelector(".query-output-status-bar-right")?.textContent).toContain("MongoDB status");
  });

  it("renders engine-scoped status items only for matching files", () => {
    const registration = registerQueryEditorStatusItem({
      id: "test.jdbc.status-bar",
      engineId: "jdbc",
      render: () => "JDBC status"
    });
    const file = {
      fileId: "file-1",
      version: 1,
      uri: "file:///query.sql",
      mimeType: "application/sql",
      engineBinding: { engineId: "mongodb" },
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync" as const,
      openedAt: new Date().toISOString()
    };

    act(() => root.render(<QueryEditorStatusBar outputContext={IDLE_OUTPUT_CONTEXT} file={file} />));
    expect(element.textContent).not.toContain("JDBC status");

    act(() => root.render(
      <QueryEditorStatusBar
        outputContext={IDLE_OUTPUT_CONTEXT}
        file={{ ...file, engineBinding: { engineId: "jdbc" } }}
      />
    ));
    expect(element.textContent).toContain("JDBC status");
    act(() => registration.dispose());
  });

  it("reacts when a MIME-based engine registration is disposed", () => {
    const files = new FileRegistry().createFilesRegistry();
    const engineRegistration = registerQueryExecutableEngine(files, {
      engineId: "mongodb",
      mimeTypes: ["application/mongodb"]
    });
    const statusRegistration = registerQueryEditorStatusItem({
      id: "test.mongodb.registration-status",
      engineId: "mongodb",
      render: () => "MongoDB registered"
    });
    const file = {
      fileId: "file-1",
      version: 1,
      uri: "file:///query.mongodb",
      mimeType: "application/mongodb",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync" as const,
      openedAt: new Date().toISOString()
    };

    act(() => root.render(<QueryEditorStatusBar outputContext={IDLE_OUTPUT_CONTEXT} file={file} />));
    expect(element.textContent).toContain("MongoDB registered");

    act(() => engineRegistration.dispose());
    expect(element.textContent).not.toContain("MongoDB registered");
    act(() => statusRegistration.dispose());
  });
});
