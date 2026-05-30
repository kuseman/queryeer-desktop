import { describe, it, expect } from "vitest";
import { ExtensionRegistry } from "./ExtensionRegistry";

describe("EditorRegistry via ExtensionRegistry", () => {
  it("returns null initially for active editor", () => {
    const ext = new ExtensionRegistry();
    const registry = ext.createEditorRegistry();
    expect(registry.getActiveEditor()).toBeNull();
  });

  it("notifies listeners on active editor change via host", () => {
    const ext = new ExtensionRegistry();
    const registry = ext.createEditorRegistry();
    const host = ext.getEditorRegistryHost();
    const changes: unknown[] = [];
    const unsub = registry.onActiveEditorChanged((editor) => {
      changes.push(editor);
    });

    const handle = { editorId: "test-editor", fileId: null };
    host.setActiveEditor(handle);
    host.setActiveEditor(null);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe(handle);
    expect(changes[1]).toBeNull();

    unsub.dispose();
  });

  it("stops notifying after unsubscribe", () => {
    const ext = new ExtensionRegistry();
    const registry = ext.createEditorRegistry();
    const host = ext.getEditorRegistryHost();
    let callCount = 0;
    const unsub = registry.onActiveEditorChanged(() => {
      callCount++;
    });

    host.setActiveEditor({ editorId: "a", fileId: null });
    unsub.dispose();
    host.setActiveEditor({ editorId: "b", fileId: null });

    expect(callCount).toBe(1);
  });

  it("getActiveEditor returns current handle", () => {
    const ext = new ExtensionRegistry();
    const registry = ext.createEditorRegistry();
    const host = ext.getEditorRegistryHost();

    const handle = { editorId: "test-editor", fileId: null };
    host.setActiveEditor(handle);
    expect(registry.getActiveEditor()).toBe(handle);
  });

  it("setActiveEditor to null clears active editor", () => {
    const ext = new ExtensionRegistry();
    const registry = ext.createEditorRegistry();
    const host = ext.getEditorRegistryHost();

    host.setActiveEditor({ editorId: "test-editor", fileId: null });
    host.setActiveEditor(null);
    expect(registry.getActiveEditor()).toBeNull();
  });
});