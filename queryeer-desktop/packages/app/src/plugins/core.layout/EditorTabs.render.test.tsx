import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { EditorTabs } from "./EditorTabs";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///tmp/report.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("EditorTabs rendering", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { React: typeof React }).React = React;
    rootElement = document.createElement("div");
    document.body.append(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("renders maximize as an accessible icon-only control", () => {
    const onToggleMaximizeGroup = vi.fn();

    act(() => {
      root.render(
        <EditorTabs
          openFiles={[makeFile()]}
          activeFileId="file-1"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          canMaximizeGroup
          onToggleMaximizeGroup={onToggleMaximizeGroup}
        />
      );
    });

    const button = rootElement.querySelector("button.shell-editor-group-maximize") as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("Maximize editor group");
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.shell-editor-group-maximize-icon")).toBeTruthy();

    act(() => {
      button.click();
    });

    expect(onToggleMaximizeGroup).toHaveBeenCalledTimes(1);
  });

  it("renders the maximize control outside the scrollable tab list", () => {
    act(() => {
      root.render(
        <EditorTabs
          openFiles={[makeFile()]}
          activeFileId="file-1"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          canMaximizeGroup
          onToggleMaximizeGroup={vi.fn()}
        />
      );
    });

    const tabList = rootElement.querySelector(".shell-editor-tabs-list");
    const actions = rootElement.querySelector(".shell-editor-tabs-actions");
    const button = rootElement.querySelector("button.shell-editor-group-maximize");

    expect(tabList).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(actions?.contains(button)).toBe(true);
    expect(tabList?.contains(button)).toBe(false);
  });

  it("renders restore as an accessible pressed icon-only control", () => {
    act(() => {
      root.render(
        <EditorTabs
          openFiles={[makeFile()]}
          activeFileId="file-1"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          canMaximizeGroup
          isGroupMaximized
          onToggleMaximizeGroup={vi.fn()}
        />
      );
    });

    const button = rootElement.querySelector("button.shell-editor-group-maximize") as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("Restore editor groups");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.shell-editor-group-maximize-icon")).toBeTruthy();
  });

  it("renders a contributed tab status icon with accessible text", () => {
    const StatusIcon = ({ className }: { className?: string }) => <svg className={className} data-testid="scheduled" />;

    act(() => {
      root.render(
        <EditorTabs
          openFiles={[makeFile()]}
          activeFileId="file-1"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          tabHeaderStyleContributions={[{
            id: "scheduled",
            render: () => ({ statusIcon: StatusIcon, statusIconTitle: "Executing every 5 seconds" })
          }]}
        />
      );
    });

    const icon = rootElement.querySelector(".shell-editor-tab-status-icon");
    expect(icon?.getAttribute("aria-label")).toBe("Executing every 5 seconds");
    expect(icon?.getAttribute("title")).toBeNull();
    expect(icon?.querySelector("[data-testid='scheduled']")).toBeTruthy();
  });

  it("passes the editor group to shared tab tooltip contributions", () => {
    const renderTooltip = vi.fn(({ editorGroupId }: { editorGroupId?: string }) => ({
      label: "Recurring execution",
      value: `Every 5 seconds in ${editorGroupId}`
    }));

    act(() => {
      root.render(
        <EditorTabs
          openFiles={[makeFile()]}
          activeFileId="file-1"
          editorGroupId="left"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          tooltipContributions={[{ id: "schedule", order: 20, render: renderTooltip }]}
        />
      );
    });

    act(() => {
      rootElement.querySelector(".shell-editor-tab")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(renderTooltip).toHaveBeenCalledWith(expect.objectContaining({ editorGroupId: "left" }));
    expect(rootElement.querySelector(".shell-tab-tooltip")?.textContent).toContain("Every 5 seconds in left");
  });
});
