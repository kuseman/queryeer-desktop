import { describe, expect, it, vi } from "vitest";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import {
  registerTextEditorMimeTypes,
  resolveMonacoLanguageId,
  resolveTextEditorMimeType
} from "./mime-types";

describe("text editor mime type registrations", () => {
  it("resolves known file extensions", () => {
    expect(resolveTextEditorMimeType("sql")).toBe("application/sql");
    expect(resolveTextEditorMimeType("PLBSQL")).toBe("application/plbsql");
    expect(resolveTextEditorMimeType("unknown")).toBeUndefined();
  });

  it("resolves monaco language ids from mime types", () => {
    expect(resolveMonacoLanguageId("application/sql")).toBe("sql");
    expect(resolveMonacoLanguageId("text/markdown")).toBe("markdown");
    expect(resolveMonacoLanguageId("image/png")).toBe("plaintext");
  });

  it("registers resolver, capabilities and text categories", () => {
    const registerMimeResolver = vi.fn();
    const registerCapabilities = vi.fn();
    const registerContentCategory = vi.fn();

    const files = {
      registerMimeResolver,
      capabilities: {
        registerCapabilities,
        registerContentCategory,
        hasCapability: vi.fn(),
        getContentCategory: vi.fn()
      },
      mimeIcons: {
        registerMimeIcon: vi.fn(),
        getMimeIcon: vi.fn(),
        listMimeIcons: vi.fn(() => [])
      }
    } as unknown as FilesRegistry;

    registerTextEditorMimeTypes(files);

    expect(registerMimeResolver).toHaveBeenCalledTimes(1);
    expect(registerCapabilities).toHaveBeenCalledWith("application/sql", [
      "backupable",
      "editable",
      "viewable"
    ]);
    expect(registerContentCategory).toHaveBeenCalledWith("application/sql", "text");
  });
});
