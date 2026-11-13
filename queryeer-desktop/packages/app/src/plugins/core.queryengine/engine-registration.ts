import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type {
  NativeQueryEngineContribution,
  NativeQueryEngineRegistry
} from "@queryeer/api/queryengine/NativeQueryEngineExtension";
import { getQueryEngineService } from "./QueryEngineService";
import { registerQueryEditorStatusItem } from "./query-editor-status-registry";

type QueryExecutableRegistration = {
  engineId: string;
  mimeTypes: string[];
};

const registrations: QueryExecutableRegistration[] = [];
const registrationListeners = new Set<() => void>();
let registrationSnapshot: QueryExecutableRegistration[] = [];

export function getRegisteredQueryExecutableEngines(): QueryExecutableRegistration[] {
  return registrationSnapshot;
}

export function subscribeRegisteredQueryExecutableEngines(listener: () => void): () => void {
  registrationListeners.add(listener);
  return () => registrationListeners.delete(listener);
}

function emitRegistrationsChanged(): void {
  const merged = new Map<string, Set<string>>();
  for (const entry of registrations) {
    const mimeTypes = merged.get(entry.engineId) ?? new Set<string>();
    entry.mimeTypes.forEach((mimeType) => mimeTypes.add(mimeType));
    merged.set(entry.engineId, mimeTypes);
  }
  registrationSnapshot = [...merged].map(([engineId, mimeTypes]) => ({ engineId, mimeTypes: [...mimeTypes] }));
  for (const listener of registrationListeners) {
    listener();
  }
}

export function registerQueryExecutableEngine(
  files: FilesRegistry,
  registration: NativeQueryEngineContribution
): Disposable {
  const mimeTypes = [...new Set(registration.mimeTypes)];
  const entry = { engineId: registration.engineId, mimeTypes };
  registrations.push(entry);
  emitRegistrationsChanged();

  const capabilityRegistrations: Disposable[] = [];
  for (const mimeType of mimeTypes) {
    capabilityRegistrations.push(files.capabilities.registerCapabilities(mimeType, ["queryexecutable"]));
  }

  const unregisterResolver = getQueryEngineService().registerEngineResolver(
    ({ fileId }) => {
      if (!fileId) {
        return undefined;
      }
      const file = files.getFile(fileId);
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
  return {
    dispose: () => {
      unregisterResolver();
      capabilityRegistrations.forEach((capability) => capability.dispose());
      const index = registrations.indexOf(entry);
      if (index >= 0) {
        registrations.splice(index, 1);
        emitRegistrationsChanged();
      }
    }
  };
}

export function createNativeQueryEngineRegistry(files: FilesRegistry): NativeQueryEngineRegistry {
  return {
    registerEngine: (contribution) => registerQueryExecutableEngine(files, contribution),
    invoke: async <TResult>(params: Parameters<NativeQueryEngineRegistry["invoke"]>[0], options?: Parameters<NativeQueryEngineRegistry["invoke"]>[1]) => {
      return await getQueryEngineService().invoke(params, options) as TResult;
    },
    registerExecutionContextProvider: (engineId, provider) => {
      const unregister = getQueryEngineService().registerExecutionContextProvider((params) => {
        if (params.engineId !== engineId) {
          return undefined;
        }
        return provider({ ...params, engineId });
      });
      return { dispose: unregister };
    },
    onQueryEvent: (engineId, listener) => {
      const unregister = getQueryEngineService().onQueryEvent((event, context) => {
        if (context?.engineId === engineId) {
          listener(event, { ...context, engineId });
        }
      });
      return { dispose: unregister };
    },
    registerEditorStatusItem: registerQueryEditorStatusItem
  };
}
