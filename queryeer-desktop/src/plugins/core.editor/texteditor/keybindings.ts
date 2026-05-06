import type { PluginContext } from "../../../contracts/plugin/Plugin";

export function registerTextEditorKeybindings(context: PluginContext): void {
  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.undo",
    commandId: "core.editor.text.undo",
    key: "CmdOrCtrl+Z",
    when: "editorFocus",
    scope: "editor",
    order: 10
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.redo",
    commandId: "core.editor.text.redo",
    key: "CmdOrCtrl+Shift+Z",
    when: "editorFocus",
    scope: "editor",
    order: 11
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.format",
    commandId: "core.editor.text.format",
    key: "Shift+Alt+F",
    when: "editorFocus",
    scope: "editor",
    order: 20
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.formatSelection",
    commandId: "core.editor.text.formatSelection",
    key: "CmdOrCtrl+K CmdOrCtrl+F",
    when: "editorFocus",
    scope: "editor",
    order: 21
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.find",
    commandId: "core.editor.text.find",
    key: "CmdOrCtrl+F",
    when: "editorFocus",
    scope: "editor",
    order: 30
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.findNext",
    commandId: "core.editor.text.findNext",
    key: "F3",
    when: "editorFocus",
    scope: "editor",
    order: 31
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.findPrevious",
    commandId: "core.editor.text.findPrevious",
    key: "Shift+F3",
    when: "editorFocus",
    scope: "editor",
    order: 32
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.closeFindWidget",
    commandId: "core.editor.text.closeFindWidget",
    key: "Escape",
    when: "editorFocus",
    scope: "editor",
    order: 33
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.goToDefinition",
    commandId: "core.editor.text.goToDefinition",
    key: "F12",
    when: "editorFocus",
    scope: "editor",
    order: 40
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.peekDefinition",
    commandId: "core.editor.text.peekDefinition",
    key: "Alt+F12",
    when: "editorFocus",
    scope: "editor",
    order: 41
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.goToTypeDefinition",
    commandId: "core.editor.text.goToTypeDefinition",
    key: "CmdOrCtrl+Shift+F12",
    when: "editorFocus",
    scope: "editor",
    order: 42
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.goToImplementation",
    commandId: "core.editor.text.goToImplementation",
    key: "CmdOrCtrl+F12",
    when: "editorFocus",
    scope: "editor",
    order: 43
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.peekImplementation",
    commandId: "core.editor.text.peekImplementation",
    key: "CmdOrCtrl+Shift+F12",
    when: "editorFocus",
    scope: "editor",
    order: 44
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.findReferences",
    commandId: "core.editor.text.findReferences",
    key: "Shift+F12",
    when: "editorFocus",
    scope: "editor",
    order: 45
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.toggleComment",
    commandId: "core.editor.text.toggleCommentLine",
    key: "CmdOrCtrl+/",
    when: "editorFocus",
    scope: "editor",
    order: 50
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.addComment",
    commandId: "core.editor.text.addCommentLine",
    key: "CmdOrCtrl+Alt+A",
    when: "editorFocus",
    scope: "editor",
    order: 51
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.removeComment",
    commandId: "core.editor.text.removeCommentLine",
    key: "CmdOrCtrl+Alt+U",
    when: "editorFocus",
    scope: "editor",
    order: 52
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.insertSnippet",
    commandId: "core.editor.text.insertSnippet",
    key: "CmdOrCtrl+Shift+Space",
    when: "editorFocus",
    scope: "editor",
    order: 60
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.selectAll",
    commandId: "core.editor.text.selectAll",
    key: "CmdOrCtrl+A",
    when: "editorFocus",
    scope: "editor",
    order: 70
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.copyLineUp",
    commandId: "core.editor.text.copyLineUp",
    key: "Alt+Shift+Up",
    when: "editorFocus",
    scope: "editor",
    order: 80
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.copyLineDown",
    commandId: "core.editor.text.copyLineDown",
    key: "Alt+Shift+Down",
    when: "editorFocus",
    scope: "editor",
    order: 81
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.moveLineUp",
    commandId: "core.editor.text.moveLineUp",
    key: "Alt+Up",
    when: "editorFocus",
    scope: "editor",
    order: 82
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.moveLineDown",
    commandId: "core.editor.text.moveLineDown",
    key: "Alt+Down",
    when: "editorFocus",
    scope: "editor",
    order: 83
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.deleteLine",
    commandId: "core.editor.text.deleteLine",
    key: "CmdOrCtrl+Shift+K",
    when: "editorFocus",
    scope: "editor",
    order: 90
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.joinLines",
    commandId: "core.editor.text.joinLines",
    key: "CmdOrCtrl+J",
    when: "editorFocus",
    scope: "editor",
    order: 100
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.sortAscending",
    commandId: "core.editor.text.sortLinesAscending",
    key: "CmdOrCtrl+Alt+Up",
    when: "editorFocus",
    scope: "editor",
    order: 110
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.sortDescending",
    commandId: "core.editor.text.sortLinesDescending",
    key: "CmdOrCtrl+Alt+Down",
    when: "editorFocus",
    scope: "editor",
    order: 111
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.trimWhitespace",
    commandId: "core.editor.text.trimTrailingWhitespace",
    key: "CmdOrCtrl+Alt+T",
    when: "editorFocus",
    scope: "editor",
    order: 120
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.indent",
    commandId: "core.editor.text.indent",
    key: "Tab",
    when: "editorFocus",
    scope: "editor",
    order: 130
  });

  context.keybindings.registerKeybinding({
    id: "core.editor.text.keybinding.outdent",
    commandId: "core.editor.text.outdent",
    key: "Shift+Tab",
    when: "editorFocus",
    scope: "editor",
    order: 131
  });
}