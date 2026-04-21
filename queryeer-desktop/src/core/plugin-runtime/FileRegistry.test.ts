import { describe, expect, it } from "vitest";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";
import { DEFAULT_MIME_TYPE } from "../../contracts/files/Resolvers";
import { FileRegistry } from "./FileRegistry";

function makeEditor(
  id: string,
  supportedMimeTypes?: string[]
): LayoutEditorContribution {
  return {
    id,
    title: id,
    supportedMimeTypes,
    render: () => null
  };
}

describe("FileRegistry mime classification", () => {
  it("returns the declared hint mime without consulting resolvers", () => {
    const registry = new FileRegistry().createFilesRegistry();
    registry.registerMimeResolver(() => "ignored/resolver");

    const mime = registry.classifyUri("foo.txt", { declared: "text/custom" });

    expect(mime).toBe("text/custom");
  });

  it("returns the first matching resolver result", () => {
    const registry = new FileRegistry().createFilesRegistry();
    registry.registerMimeResolver(() => undefined);
    registry.registerMimeResolver((_uri, hint) =>
      hint?.extension === "pb" ? "application/x-payloadbuilder" : undefined
    );
    registry.registerMimeResolver(() => "never-reached");

    const mime = registry.classifyUri("file:///queries/a.pb");

    expect(mime).toBe("application/x-payloadbuilder");
  });

  it("falls back to DEFAULT_MIME_TYPE when no resolver matches", () => {
    const registry = new FileRegistry().createFilesRegistry();
    registry.registerMimeResolver(() => undefined);

    const mime = registry.classifyUri("file:///unknown.bin");

    expect(mime).toBe(DEFAULT_MIME_TYPE);
  });

  it("passes the extracted extension to resolvers", () => {
    let observedExtension: string | undefined;
    const registry = new FileRegistry().createFilesRegistry();
    registry.registerMimeResolver((_uri, hint) => {
      observedExtension = hint?.extension;
      return undefined;
    });

    registry.classifyUri("C:/path/to/file.SQL");

    expect(observedExtension).toBe("sql");
  });
});

describe("FileRegistry editor resolution", () => {
  it("returns undefined when no resolver or editor matches", () => {
    const registry = new FileRegistry().createFilesRegistry();
    const file = registry.openFile({
      uri: "untitled:empty",
      mimeType: "text/plain"
    });

    expect(registry.resolveEditor(file)).toBeUndefined();
  });

  it("prefers explicit editor resolver over mime-type match", () => {
    const editors = [
      makeEditor("editor.by-mime", ["text/plain"]),
      makeEditor("editor.custom")
    ];
    const registry = new FileRegistry({
      getEditors: () => editors
    }).createFilesRegistry();
    registry.registerEditorResolver(() => "editor.custom");

    const file = registry.openFile({
      uri: "untitled:a",
      mimeType: "text/plain"
    });

    expect(registry.resolveEditor(file)).toBe("editor.custom");
  });

  it("falls back to supportedMimeTypes match on contributed editors", () => {
    const editors = [
      makeEditor("editor.generic"),
      makeEditor("editor.pb", ["application/x-payloadbuilder"])
    ];
    const registry = new FileRegistry({
      getEditors: () => editors
    }).createFilesRegistry();

    const file = registry.openFile({
      uri: "untitled:q",
      mimeType: "application/x-payloadbuilder"
    });

    expect(registry.resolveEditor(file)).toBe("editor.pb");
  });

  it("skips a resolver that returns undefined and tries the next", () => {
    const editors = [makeEditor("editor.fallback", ["text/plain"])];
    const registry = new FileRegistry({
      getEditors: () => editors
    }).createFilesRegistry();
    registry.registerEditorResolver(() => undefined);

    const file = registry.openFile({
      uri: "untitled:t",
      mimeType: "text/plain"
    });

    expect(registry.resolveEditor(file)).toBe("editor.fallback");
  });
});
