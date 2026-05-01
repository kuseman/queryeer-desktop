import { describe, expect, it, vi } from "vitest";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import { registerImageEditorMimeTypes, resolveImageEditorMimeType } from "./mime-types";

describe("image editor mime type registrations", () => {
  it("resolves known image extensions", () => {
    expect(resolveImageEditorMimeType("png")).toBe("image/png");
    expect(resolveImageEditorMimeType("JPG")).toBe("image/jpeg");
    expect(resolveImageEditorMimeType("unknown")).toBeUndefined();
  });

  it("registers resolver, capabilities and image categories", () => {
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

    registerImageEditorMimeTypes(files);

    expect(registerMimeResolver).toHaveBeenCalledTimes(1);
    expect(registerCapabilities).toHaveBeenCalledWith("image/png", ["viewable"]);
    expect(registerContentCategory).toHaveBeenCalledWith("image/png", "image");
  });
});
