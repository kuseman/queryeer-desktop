import { describe, expect, it, vi } from "vitest";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import {
  registerTextEditorMimeTypes,
  registerMonacoLanguageIdForMimeType,
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

    const registration = registerMonacoLanguageIdForMimeType("application/x-test-flow", "qflow");
    expect(resolveMonacoLanguageId("application/x-test-flow")).toBe("qflow");
    registration.dispose();
    expect(resolveMonacoLanguageId("application/x-test-flow")).toBe("plaintext");

    expect(resolveMonacoLanguageId("image/png")).toBe("plaintext");
  });

  it("preserves newer language registrations when older registrations are disposed", () => {
    const first = registerMonacoLanguageIdForMimeType("application/x-stacked", "json");
    const second = registerMonacoLanguageIdForMimeType("application/x-stacked", "javascript");

    first.dispose();
    expect(resolveMonacoLanguageId("application/x-stacked")).toBe("javascript");
    second.dispose();
    expect(resolveMonacoLanguageId("application/x-stacked")).toBe("plaintext");
  });

  it("rejects blank language registrations", () => {
    expect(() => registerMonacoLanguageIdForMimeType("", "json")).toThrow("non-empty");
    expect(() => registerMonacoLanguageIdForMimeType("application/x-test", " ")).toThrow("non-empty");
  });

  it("registers resolver, capabilities and text categories", () => {
    const registerMimeResolver = vi.fn();
    const registerCapabilities = vi.fn();
    const registerLabel = vi.fn();
    const registerContentCategory = vi.fn();

    const files = {
      registerMimeResolver,
      capabilities: {
        registerCapabilities,
        registerLabel,
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        registerContentCategory,
        hasCapability: vi.fn(),
        listMimeTypesByCapability: vi.fn(() => []),
        listAllMimeTypes: vi.fn(() => []),
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
      "viewable",
      "creatable"
    ]);
    expect(registerContentCategory).toHaveBeenCalledWith("application/sql", "text");
    expect(registerLabel).not.toHaveBeenCalled();
  });
});
