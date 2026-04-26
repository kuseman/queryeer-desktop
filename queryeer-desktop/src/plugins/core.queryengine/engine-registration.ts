import type { PluginContext } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "./QueryEngineService";

type QueryEngineMimeRegistration = {
  engineId: string;
  mimeTypes: string[];
};

type QueryExecutableRegistration = {
  engineId: string;
  mimeTypes: string[];
};

const registrations: QueryExecutableRegistration[] = [];

export function getRegisteredQueryExecutableEngines(): QueryExecutableRegistration[] {
  return registrations.map((entry) => ({
    engineId: entry.engineId,
    mimeTypes: [...entry.mimeTypes]
  }));
}

export function registerQueryExecutableEngine(
  context: PluginContext,
  registration: QueryEngineMimeRegistration
): () => void {
  const mimeTypes = [...new Set(registration.mimeTypes)];
  const existing = registrations.find((entry) => entry.engineId === registration.engineId);
  if (existing) {
    existing.mimeTypes = [...new Set([...existing.mimeTypes, ...mimeTypes])];
  } else {
    registrations.push({
      engineId: registration.engineId,
      mimeTypes
    });
  }

  for (const mimeType of mimeTypes) {
    context.files.capabilities.registerCapabilities(mimeType, ["queryexecutable"]);
  }

  return getQueryEngineService().registerEngineResolver(
    ({ fileId }) => {
      if (!fileId) {
        return undefined;
      }
      const file = context.files.getFile(fileId);
      if (!file) {
        return undefined;
      }
      if (mimeTypes.includes(file.mimeType)) {
        return registration.engineId;
      }
      return undefined;
    },
    { id: `queryengine.${registration.engineId}.mime` }
  );
}
