import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { toDisposable } from "./disposables";

/** The contribution kinds whose registering plugin is recorded. */
export type ContributionKind =
  | "command"
  | "keybinding"
  | "menuItem"
  | "filesystem"
  | "editor"
  | "view"
  | "panel"
  | "statusItem"
  | "toolbarAction"
  | "welcome"
  | "settings"
  | "queryEngine";

export type ContributionOwners = {
  /** The plugin that registered the contribution, or undefined if it was registered outside a plugin context. */
  ownerOf: (kind: ContributionKind, id: string) => string | undefined;
};

/**
 * Records which plugin registered each contribution. The registries are shared between plugins, so each plugin's
 * context wraps them (see `attributeContext`) and reports the registrations it makes, including those made after
 * activation.
 */
export class ContributionOwnership implements ContributionOwners {
  private readonly owners = new Map<string, string>();

  public record(kind: ContributionKind, id: string, pluginId: string, registration: Disposable): Disposable {
    const key = `${kind}:${id}`;
    this.owners.set(key, pluginId);
    return toDisposable(() => {
      registration.dispose();
      if (this.owners.get(key) === pluginId) {
        this.owners.delete(key);
      }
    });
  }

  public ownerOf(kind: ContributionKind, id: string): string | undefined {
    return this.owners.get(`${kind}:${id}`);
  }
}

type AttributedContext = Pick<PluginContext, "commands" | "keybindings" | "menu" | "filesystems" | "layout" | "settings" | "queryEngines">;

/** Wraps the shared registries of a plugin context so the registrations they make are recorded for `pluginId`. */
export function attributeContext<T extends AttributedContext>(context: T, pluginId: string, ownership: ContributionOwnership): T {
  const own = (kind: ContributionKind, id: string, registration: Disposable) => ownership.record(kind, id, pluginId, registration);
  const { commands, keybindings, menu, filesystems, layout, settings, queryEngines } = context;
  return {
    ...context,
    commands: { ...commands, registerCommand: (command) => own("command", command.id, commands.registerCommand(command)) },
    keybindings: {
      ...keybindings,
      registerKeybinding: (binding) => own("keybinding", binding.id, keybindings.registerKeybinding(binding))
    },
    menu: { ...menu, registerMenuItem: (item) => own("menuItem", item.id, menu.registerMenuItem(item)) },
    filesystems: {
      ...filesystems,
      registerFileSystem: (filesystem) => own("filesystem", filesystem.id, filesystems.registerFileSystem(filesystem))
    },
    layout: {
      ...layout,
      registerEditor: (editor) => own("editor", editor.id, layout.registerEditor(editor)),
      registerView: (view) => own("view", view.id, layout.registerView(view)),
      registerPanel: (panel) => own("panel", panel.id, layout.registerPanel(panel)),
      registerStatusItem: (item) => own("statusItem", item.id, layout.registerStatusItem(item)),
      registerToolbarAction: (action) => own("toolbarAction", action.id, layout.registerToolbarAction(action)),
      registerWelcome: (welcome) => own("welcome", welcome.id, layout.registerWelcome(welcome))
    },
    settings: {
      ...settings,
      registerSettings: (contribution) => own("settings", contribution.moduleId, settings.registerSettings(contribution))
    },
    queryEngines: {
      ...queryEngines,
      registerEngine: (engine) => own("queryEngine", engine.engineId, queryEngines.registerEngine(engine))
    }
  };
}
