import type { ContentCategory, MimeCapability } from "./FilesRegistry.js";

export type MimeTypeRegistration = {
  mimeType: string;
  label?: string;
  extensions: string[];
  contentCategory: ContentCategory;
  capabilities: MimeCapability[];
};
