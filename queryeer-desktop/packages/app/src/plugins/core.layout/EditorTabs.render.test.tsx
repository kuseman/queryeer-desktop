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
});
