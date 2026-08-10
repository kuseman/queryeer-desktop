import type { MimeTypeRegistration } from "@queryeer/api/files/MimeTypeRegistration";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";

export const FOO_MIME_TYPES: MimeTypeRegistration[] = [
  {
    mimeType: "application/x-foo",
    extensions: ["foo"],
    contentCategory: "text",
    capabilities: ["viewable", "editable"]
  }
];

export function registerFooMimeTypes(files: FilesRegistry): void {
  files.registerMimeResolver((_uri, hint) => {
    if (hint?.extension === "foo") return "application/x-foo";
    return undefined;
  });
  files.capabilities.registerCapabilities("application/x-foo", ["viewable", "editable"]);
  files.capabilities.registerContentCategory("application/x-foo", "text");
  files.capabilities.registerPreferredExtension?.("application/x-foo", "foo");
  files.capabilities.registerLabel?.("application/x-foo", "X-Foo");
}
