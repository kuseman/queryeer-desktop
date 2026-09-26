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

class TestDataTransfer {
  dropEffect = "none";
  effectAllowed = "uninitialized";
  private readonly data = new Map<string, string>();

  get types(): string[] {
    return [...this.data.keys()];
  }

  getData(type: string): string {
    return this.data.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.data.set(type, value);
  }
}

function dispatchDrag(
  element: Element,
  type: string,
  dataTransfer: TestDataTransfer,
  clientX = 0
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX }
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
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

  it("writes the source group and file to the tab drag payload", () => {
    const dataTransfer = new TestDataTransfer();

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
          onMoveFile={vi.fn()}
        />
      );
    });

    const tab = rootElement.querySelector(".shell-editor-tab") as HTMLDivElement;
    dispatchDrag(tab, "dragstart", dataTransfer);

    expect(tab.draggable).toBe(true);
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(JSON.parse(dataTransfer.getData("application/x-queryeer-editor-tab"))).toEqual({
      editorGroupId: "left",
      fileId: "file-1"
    });
    expect(tab.classList.contains("is-dragging")).toBe(true);
  });

  it("drops before or after a tab based on its horizontal midpoint", () => {
    const onMoveFile = vi.fn();
    const files = [
      makeFile({ fileId: "target-1", uri: "file:///tmp/one.sql" }),
      makeFile({ fileId: "target-2", uri: "file:///tmp/two.sql" })
    ];

    act(() => {
      root.render(
        <EditorTabs
          openFiles={files}
          activeFileId="target-1"
          editorGroupId="right"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          onMoveFile={onMoveFile}
        />
      );
    });

    const secondTab = rootElement.querySelector("[data-file-id='target-2']") as HTMLDivElement;
    vi.spyOn(secondTab, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 200,
      width: 100,
      top: 0,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => ({})
    });

    const beforeTransfer = new TestDataTransfer();
    beforeTransfer.setData("application/x-queryeer-editor-tab", JSON.stringify({ editorGroupId: "left", fileId: "source" }));
    dispatchDrag(secondTab, "dragover", beforeTransfer, 120);
    expect(secondTab.classList.contains("is-drop-before")).toBe(true);
    dispatchDrag(secondTab, "drop", beforeTransfer, 120);
    expect(onMoveFile).toHaveBeenLastCalledWith("left", "source", "right", 1);

    const afterTransfer = new TestDataTransfer();
    afterTransfer.setData("application/x-queryeer-editor-tab", JSON.stringify({ editorGroupId: "left", fileId: "source" }));
    dispatchDrag(secondTab, "dragover", afterTransfer, 180);
    expect(secondTab.classList.contains("is-drop-after")).toBe(true);
    dispatchDrag(secondTab, "drop", afterTransfer, 180);
    expect(onMoveFile).toHaveBeenLastCalledWith("left", "source", "right", 2);
  });

  it("drops into trailing strip space at the end and clears drag feedback", () => {
    const onMoveFile = vi.fn();
    act(() => {
      root.render(
        <EditorTabs
          openFiles={[
            makeFile({ fileId: "target-1", uri: "file:///tmp/one.sql" }),
            makeFile({ fileId: "target-2", uri: "file:///tmp/two.sql" })
          ]}
          activeFileId="target-1"
          editorGroupId="right"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          onMoveFile={onMoveFile}
        />
      );
    });

    const list = rootElement.querySelector(".shell-editor-tabs-list") as HTMLDivElement;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData("application/x-queryeer-editor-tab", JSON.stringify({ editorGroupId: "left", fileId: "source" }));

    dispatchDrag(list, "dragover", dataTransfer, 500);
    expect(list.classList.contains("is-drag-over")).toBe(true);
    expect(rootElement.querySelector("[data-file-id='target-2']")?.classList.contains("is-drop-after")).toBe(true);
    dispatchDrag(list, "drop", dataTransfer, 500);

    expect(onMoveFile).toHaveBeenCalledWith("left", "source", "right", 2);
    expect(list.classList.contains("is-drag-over")).toBe(false);
    expect(rootElement.querySelector(".is-drop-after")).toBeNull();
  });

  it("allows tabs to be selected after a drop without waiting for dragend", () => {
    const onSelectFile = vi.fn();
    act(() => {
      root.render(
        <EditorTabs
          openFiles={[
            makeFile({ fileId: "file-1", uri: "file:///tmp/one.sql" }),
            makeFile({ fileId: "file-2", uri: "file:///tmp/two.sql" })
          ]}
          activeFileId="file-1"
          editorGroupId="main"
          editorsById={new Map()}
          tabsRef={createRef<HTMLDivElement>()}
          onSelectFile={onSelectFile}
          onCloseFile={vi.fn()}
          onMoveFile={vi.fn()}
        />
      );
    });

    const firstTab = rootElement.querySelector("[data-file-id='file-1']") as HTMLDivElement;
    const secondTab = rootElement.querySelector("[data-file-id='file-2']") as HTMLDivElement;
    const dataTransfer = new TestDataTransfer();
    dispatchDrag(firstTab, "dragstart", dataTransfer);
    dispatchDrag(secondTab, "dragover", dataTransfer, 0);
    dispatchDrag(secondTab, "drop", dataTransfer, 0);

    act(() => {
      (secondTab.querySelector(".shell-editor-tab-button") as HTMLDivElement).click();
    });

    expect(onSelectFile).toHaveBeenCalledWith("file-2");
  });
});
