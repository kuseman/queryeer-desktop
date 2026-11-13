import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { EngineBinding } from "@queryeer/api/files/FileEntity";

type MimeOwnerRegistration = {
  engineId: string;
  mimeTypes: readonly string[];
};

const registrations: MimeOwnerRegistration[] = [];

export function registerQueryEngineMimeOwner(engineId: string, mimeTypes: readonly string[]): Disposable {
  const registration = { engineId, mimeTypes: [...new Set(mimeTypes)] };
  registrations.push(registration);
  return {
    dispose: () => {
      const index = registrations.indexOf(registration);
      if (index >= 0) {
        registrations.splice(index, 1);
      }
    }
  };
}

export function getQueryEngineMimeOwner(mimeType: string): string | undefined {
  return registrations.find((registration) => registration.mimeTypes.includes(mimeType))?.engineId;
}

export function normalizeEngineBinding(mimeType: string, binding: EngineBinding | undefined): EngineBinding | undefined {
  const owner = getQueryEngineMimeOwner(mimeType);
  return owner && binding?.engineId !== owner ? undefined : binding;
}
