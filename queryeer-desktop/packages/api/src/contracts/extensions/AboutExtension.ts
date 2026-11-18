import type { Disposable } from "../editor/EditorApi.js";
export type PluginChangelogEntry = {
  pluginId: string;
  pluginName: string;
  version: string;
  changelog: string;
};

export type AboutExtension = {
  registerChangelog: (entry: PluginChangelogEntry) => Disposable;
};
