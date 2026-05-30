import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry.js";
import type { MimeTypeRegistration } from "@queryeer/api/files/MimeTypeRegistration.js";

export type { MimeTypeRegistration };

export function createExtensionMimeResolver(
  registrations: readonly MimeTypeRegistration[]
): (extension: string | undefined) => string | undefined {
  const extensionToMimeType = new Map<string, string>();
  for (const registration of registrations) {
    for (const extension of registration.extensions) {
      extensionToMimeType.set(extension.toLowerCase(), registration.mimeType);
    }
  }

  return (extension) => {
    if (!extension) {
      return undefined;
    }
    return extensionToMimeType.get(extension.toLowerCase());
  };
}

export function registerMimeTypeBundle(
  files: FilesRegistry,
  registrations: readonly MimeTypeRegistration[],
  resolveMimeType: (extension: string | undefined) => string | undefined
): void {
  files.registerMimeResolver((_uri, hint) => resolveMimeType(hint?.extension));

  for (const registration of registrations) {
    files.capabilities.registerCapabilities(registration.mimeType, registration.capabilities);
    if (registration.label && files.capabilities.registerLabel) {
      files.capabilities.registerLabel(registration.mimeType, registration.label);
    }
    files.capabilities.registerContentCategory(registration.mimeType, registration.contentCategory);
  }
}
