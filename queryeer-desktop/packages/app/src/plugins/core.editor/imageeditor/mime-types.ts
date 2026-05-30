import type {
  FilesRegistry,
  MimeCapability
} from "@queryeer/api/files/FilesRegistry";
import {
  createExtensionMimeResolver,
  registerMimeTypeBundle,
  type MimeTypeRegistration
} from "../../core.files/mime-registration";

const IMAGE_CAPABILITIES: MimeCapability[] = ["viewable"];

const IMAGE_EDITOR_MIME_TYPES: MimeTypeRegistration[] = [
  {
    mimeType: "image/png",
    extensions: ["png"],
    contentCategory: "image",
    capabilities: IMAGE_CAPABILITIES
  },
  {
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg"],
    contentCategory: "image",
    capabilities: IMAGE_CAPABILITIES
  },
  {
    mimeType: "image/gif",
    extensions: ["gif"],
    contentCategory: "image",
    capabilities: IMAGE_CAPABILITIES
  },
  {
    mimeType: "image/webp",
    extensions: ["webp"],
    contentCategory: "image",
    capabilities: IMAGE_CAPABILITIES
  },
  {
    mimeType: "image/svg+xml",
    extensions: ["svg"],
    contentCategory: "image",
    capabilities: IMAGE_CAPABILITIES
  }
];

const resolveMimeTypeByExtension = createExtensionMimeResolver(IMAGE_EDITOR_MIME_TYPES);

export function resolveImageEditorMimeType(extension: string | undefined): string | undefined {
  return resolveMimeTypeByExtension(extension);
}

export function registerImageEditorMimeTypes(files: FilesRegistry): void {
  registerMimeTypeBundle(files, IMAGE_EDITOR_MIME_TYPES, resolveImageEditorMimeType);
}
