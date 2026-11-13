import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { IDLE_OUTPUT_CONTEXT } from "@queryeer/api/queryengine/OutputExtension";
import { QueryEditorHeader } from "./QueryEditorHeader";
import { registerQueryEditorHeaderItem } from "./query-editor-header-registry";
import { registerQueryExecutableEngine } from "./engine-registration";
import { FileRegistry } from "../../core/plugin-runtime/FileRegistry";

function makeFile(engineId?: string, mimeType = "application/sql"): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///query.sql",
    mimeType,
    ...(engineId ? { engineBinding: { engineId } } : {}),
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString()
  };
}

describe("QueryEditorHeader", () => {
  let element: HTMLDivElement;
  let root: Root;
  const registrations: Array<{ dispose: () => void }> = [];

  beforeEach(() => {
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });

  afterEach(() => {
    act(() => root.unmount());
    registrations.splice(0).forEach((registration) => registration.dispose());
    element.remove();
  });

  it("renders matching items in order and forwards the editor context", () => {
    const render = vi.fn(() => <label>Filter <input /></label>);
    registrations.push(
      registerQueryEditorHeaderItem({ id: "second", engineId: "mongodb", order: 20, render: () => "Limit" }),
      registerQueryEditorHeaderItem({ id: "first", engineId: "mongodb", order: 10, render }),
      registerQueryEditorHeaderItem({ id: "jdbc", engineId: "jdbc", render: () => "Schema" })
    );
    const file = makeFile("mongodb");

    act(() => root.render(
      <QueryEditorHeader
        outputContext={IDLE_OUTPUT_CONTEXT}
        file={file}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    ));

    expect(element.querySelector(".query-editor-header-items")?.textContent).toBe("Filter Limit");
    expect(render).toHaveBeenCalledWith({ fileId: "file-1", file, outputContext: IDLE_OUTPUT_CONTEXT });
  });

  it("omits the strip when all applicable items return no content", () => {
    registrations.push(registerQueryEditorHeaderItem({ id: "empty", render: () => null }));

    act(() => root.render(
      <QueryEditorHeader
        outputContext={IDLE_OUTPUT_CONTEXT}
        file={makeFile("mongodb")}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    ));

    expect(element.querySelector(".query-editor-header")).toBeNull();
  });

  it("keeps a toggle available while collapsed", () => {
    const onToggle = vi.fn();
    registrations.push(registerQueryEditorHeaderItem({ id: "query-bar", title: "Query", render: () => "Filter" }));

    act(() => root.render(
      <QueryEditorHeader
        outputContext={IDLE_OUTPUT_CONTEXT}
        file={makeFile("mongodb")}
        collapsed
        onToggleCollapsed={onToggle}
      />
    ));

    expect(element.querySelector(".query-editor-header-items")).toBeNull();
    expect(element.querySelector(".query-editor-header")?.hasAttribute("data-keybinding-scope")).toBe(false);
    expect(element.querySelector(".query-editor-header-title")?.textContent).toBe("Query");
    act(() => (element.querySelector(".query-editor-header-toggle") as HTMLButtonElement).click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("uses the MIME registration when the file has no engine binding", () => {
    const engineRegistration = registerQueryExecutableEngine(new FileRegistry().createFilesRegistry(), {
      engineId: "mongodb",
      mimeTypes: ["application/vnd.queryeer.mongodb"]
    });
    registrations.push(registerQueryEditorHeaderItem({
      id: "mongodb-query-bar",
      engineId: "mongodb",
      render: () => "Mongo query bar"
    }));

    try {
      act(() => root.render(
        <QueryEditorHeader
          outputContext={IDLE_OUTPUT_CONTEXT}
          file={makeFile(undefined, "application/vnd.queryeer.mongodb")}
          collapsed={false}
          onToggleCollapsed={() => {}}
        />
      ));

      expect(element.textContent).toContain("Mongo query bar");
    } finally {
      act(() => engineRegistration.dispose());
    }
  });

  it("removes a disposed header item", () => {
    const registration = registerQueryEditorHeaderItem({ id: "disposable", render: () => "Temporary" });
    registrations.push(registration);
    act(() => root.render(
      <QueryEditorHeader
        outputContext={IDLE_OUTPUT_CONTEXT}
        file={makeFile("mongodb")}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    ));
    expect(element.textContent).toContain("Temporary");

    act(() => registration.dispose());

    expect(element.querySelector(".query-editor-header")).toBeNull();
  });

  it("shows an error box when a contribution render throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    registrations.push(registerQueryEditorHeaderItem({
      id: "broken-query-bar",
      render: () => {
        throw new Error("Query bar failed");
      }
    }));

    try {
      act(() => root.render(
        <QueryEditorHeader
          outputContext={IDLE_OUTPUT_CONTEXT}
          file={makeFile("mongodb")}
          collapsed={false}
          onToggleCollapsed={() => {}}
        />
      ));

      expect(element.querySelector(".plugin-error-boundary-title")?.textContent).toBe("Plugin error: broken-query-bar");
      expect(element.querySelector(".plugin-error-boundary-message")?.textContent).toBe("Query bar failed");
    } finally {
      consoleError.mockRestore();
    }
  });
});
