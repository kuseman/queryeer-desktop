# Developing Queryeer Plugins

Queryeer is an extensible desktop application for data querying and exploration. Plugins can extend both the **frontend** (Electron + React + TypeScript) and the **backend** (Java 21+), or one side alone.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Plugin Manifest (`plugin.json`)](#2-plugin-manifest-pluginjson)
3. [Plugin Lifecycle](#3-plugin-lifecycle)
4. [Frontend-Only Plugins](#4-frontend-only-plugins)
5. [Backend Plugins](#5-backend-plugins)
6. [Full-Stack Plugins](#6-full-stack-plugins)
7. [Contribution Point Reference](#7-contribution-point-reference)
8. [Debugging & Testing](#8-debugging--testing)
9. [Distribution](#9-distribution)
10. [Current Limitations & Known Gaps](#10-current-limitations--known-gaps)

---

## 1. Architecture Overview

Queryeer runs in three co-operating processes:

```
┌────────────────────────────────────────────────────┐
│                   Electron Main                    │
│  • Discovers external plugins from filesystem      │
│  • Scans userData/plugins for plugin.json          │
│  • Manages application lifecycle, windows, menus   │
└────────────┬───────────────────────────┬───────────┘
             │ IPC (contextBridge)       │ Stdio (NDJSON)
    ┌────────▼──────────┐     ┌──────────▼──────────┐
    │   Renderer (Vite) │     │  Java Backend (JVM) │
    │                   │     │                     │
    │  • @queryeer/api  │     │  • backend-api      │
    │  • PluginContext  │     │  • BackendPlugin     │
    │  • Internal +     │     │  • Classloader       │
    │    external       │     │    isolation         │
    │    plugins via    │     │  • JDBC,             │
    │    dynamic import │     │    Payloadbuilder    │
    └───────────────────┘     └─────────────────────┘
```

| Layer | Technology | Plugin Interface |
|-------|-----------|-----------------|
| Renderer | TypeScript, React 18 | `Plugin` (`@queryeer/api`) |
| Backend | Java 21+, Maven | `BackendPlugin` (`backend-api`) |
| IPC | NDJSON over stdio | Contract types in `@queryeer/api` / `backend-contract` |

### The `@queryeer/api` Package

Frontend plugins depend on the [`@queryeer/api`](https://www.npmjs.com/package/@queryeer/api) TypeScript package, which provides all contract types:

```json
{
  "devDependencies": {
    "@queryeer/api": "^0.10.0"
  }
}
```

The API package exports types for:
- Plugin core: `Plugin`, `PluginContext`, `PluginManifest`, `PluginModule`
- All extension points: editors, layouts, menus, commands, keybindings, tooltips, settings, context menus, outline providers, quick commands, etc.
- All files, query engine, and workspace contracts
- Backend protocol types (envelope, gateway, methods)

---

## 2. Plugin Manifest (`plugin.json`)

Every plugin **must** have a `plugin.json` file at its root. The schema is versioned and validated:

```json
{
  "schemaVersion": 1,
  "id": "my.plugin.id",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What my plugin does",
  "dependencies": ["other.plugin.id"],
  "providesCapabilities": ["my.capability"],
  "requiredCapabilities": ["core.capability"],
  "backend": {
    "entrypointClass": "com.example.MyBackendPlugin",
    "classpath": {
      "root": ".",
      "include": ["target/classes", "@target/queryeer-plugin-deps.txt"]
    }
  },
  "frontend": {
    "entryModule": "./module.js",
    "moduleFormat": "esm",
    "apiVersion": "^0.10.0"
  },
  "packaging": {
    "layout": {
      "jarsDir": ".",
      "typescriptDir": "."
    }
  }
}
```

| Property | Required | Description |
|----------|----------|-------------|
| `schemaVersion` | **yes** | Must be `1` |
| `id` | **yes** | Unique plugin identifier (reverse-domain recommended) |
| `name` | **yes** | Human-readable name |
| `version` | **yes** | SemVer string |
| `description` | no | Brief description |
| `dependencies` | no | Array of plugin IDs this plugin depends on |
| `providesCapabilities` | no | Capabilities this plugin provides to others |
| `requiredCapabilities` | no | Capabilities this plugin needs from others |
| `backend` | see note | Backend target configuration (required if plugin has a Java side) |
| `frontend` | see note | Frontend target configuration (required if plugin has a TypeScript side) |
| `packaging` | no | Directory layout hints for the plugin directory structure |

> **Note:** At least one of `backend` or `frontend` must be present.

---

## 3. Plugin Lifecycle

```
Discovery → Manifest Validation → Dependency Resolution →
Capability Validation → Topological Sort → Activation
```

### 3.1 Discovery

**Frontend (renderer process):**
- Internal plugins are discovered via Vite's `import.meta.glob("./*/module.ts", { eager: true })` at build time.
- External plugins are discovered by the **Electron main process**, which scans the per-user managed plugins directory for plugin directories and `.zip` archives containing `plugin.json` with a `frontend.entryModule`.
- The renderer fetches external manifests via IPC (`window.appShell.getExternalFrontendPlugins()`), merges them with internal manifests, and loads external modules dynamically via `import()`.

**Backend (JVM process):**
- Always loads builtin plugins first, then scans the per-user managed plugins directory for external plugin directories and `.zip` archives containing `plugin.json`.
- Loads the manifest, resolves the backend entrypoint class, and creates an isolated `URLClassLoader` for the plugin's classpath.

### 3.2 Validation

Manifests are validated for required fields, duplicate IDs, and schema version. Builtin plugins take priority; external plugins with IDs that collide with builtin/internal plugins are rejected.

### 3.3 Dependency Resolution

Plugins are activated in dependency order using a topological sort (Kahn's algorithm). Dependencies are resolved by plugin ID. Circular dependencies are detected and rejected.

### 3.4 Activation

Each plugin's `activate(context)` method is called in dependency order. The `PluginContext` provides all registries (commands, layout, files, etc.). Plugins register their contributions during activation.

---

## 4. Frontend-Only Plugins

### 4.1 Prerequisites

- Node.js 18+
- TypeScript 5.x
- `@queryeer/api` as a dependency

### 4.2 Project Structure

```
my-frontend-plugin/
├── plugin.json          # Manifest
├── module.ts            # PluginModule entry point
├── plugin.tsx           # Plugin implementation (activate)
├── MyComponent.tsx      # React components
└── my-styles.css        # Styles (imported by module.ts)
```

### 4.3 `plugin.json`

```json
{
  "schemaVersion": 1,
  "id": "my.frontend.plugin",
  "name": "My Frontend Plugin",
  "version": "0.1.0",
  "frontend": {
    "entryModule": "./dist/module.js"
  }
}
```

### 4.4 `module.ts`

Every frontend plugin **must** export a named `const pluginModule: PluginModule`:

```typescript
import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { myPlugin } from "./plugin";
import "./my-styles.css";

export const pluginModule: PluginModule = {
  manifest: myPlugin.manifest,
  plugin: myPlugin
};
```

### 4.5 `plugin.tsx` — The Plugin Implementation

```typescript
import type { Plugin } from "@queryeer/api/plugin/Plugin";

export const myPlugin: Plugin = {
  manifest: {
    id: "my.frontend.plugin",
    name: "My Frontend Plugin",
    version: "0.1.0",
    kind: "feature",
    description: "My awesome frontend-only plugin"
  },
  activate: (context) => {
    // Register contributions using context.* registries
    // See Section 7 for the full list of available registries
  }
};
```

The `manifest` inside the plugin object uses the programmatic `PluginManifest` type (id, name, version, kind, dependencies, providesCapabilities, requiredCapabilities). The `kind` field distinguishes `"core"` (system-level) from `"feature"` (extension-level). External plugins should use `"feature"`.

### 4.6 Building

External frontend plugins **must be bundled** into a single self-contained ESM file because they are loaded at runtime via the browser's native module loader (which does not resolve `node_modules`). The recommended tool is [esbuild](https://esbuild.github.io/).

The `package.json` should include esbuild and a build script:

```json
{
  "type": "module",
  "scripts": {
    "build": "esbuild module.ts --bundle --format=esm --jsx=automatic --loader:.ts=ts --loader:.tsx=tsx --loader:.css=text --outfile=dist/plugin.js",
    "package": "npm run build && node -e \"require('fs').cpSync('plugin.json','dist/plugin.json')\"",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@queryeer/api": "^0.10.0",
    "@types/react": "^18.3.0",
    "esbuild": "^0.23.0",
    "react": "^18.3.1",
    "typescript": "^5.5.0"
  }
}
```

| Flag | Purpose |
|------|---------|
| `--bundle` | Inline all dependencies (including React) into a single file |
| `--format=esm` | Output ES module with named exports |
| `--jsx=automatic` | Use automatic JSX runtime (bundled, no external import needed) |
| `--loader:.css=text` | Inline CSS files as strings for runtime injection |

**CSS handling:** CSS is loaded via `import styles from "./styles.css"` with the text loader, then injected into the DOM at plugin activation:

```typescript
const STYLE_ID = "my-plugin-styles";
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styles;
  document.head.appendChild(style);
}
```

**Build output:** `dist/` will contain a subfolder named after the plugin directory (e.g., `dist/hello-world-panel/`) with `plugin.js` (self-contained bundle) and `plugin.json` (manifest with `entryModule: "./plugin.js"` adjusted for the deployable context). Copy that subfolder to Queryeer's per-user managed plugins directory and it works as-is.

### 4.7 Installation

Copy the plugin folder into Queryeer's per-user managed plugins directory:

```bash
# Windows (PowerShell)
copy-item -Recurse .\dist\hello-world-panel "$env:APPDATA\queryeer-desktop\plugins\hello-world-panel"
```

Plugin directory structure expected by the loader:

```
queryeer-plugins/
├── my-plugin/
│   ├── plugin.json        # Manifest (entryModule: "./dist/plugin.js")
│   └── dist/
│       ├── plugin.js      # Bundled ESM module
│       └── plugin.json    # Manifest copy (optional, for standalone dist/)
```

Plugins can also be packaged as `.zip` archives.

### 4.8 Step-by-Step: Creating and Testing a Frontend Plugin

```bash
# 1. Create plugin directory
mkdir my-plugin && cd my-plugin

# 2. Initialize with esbuild and @queryeer/api
npm init -y
npm install --save-dev @queryeer/api @types/react esbuild react typescript

# 3. Create plugin.json, module.ts, plugin.tsx (see examples in plugins-examples/)
# 4. Create CSS files with injection helpers

# 5. Build
npm run build          # → dist/plugin.js
npm run package        # → dist/ also gets plugin.json

# 6. Deploy
# Copy the entire plugin directory to Queryeer's managed plugins directory
copy-item -Recurse .\dist\ "$env:APPDATA\queryeer-desktop\plugins\my-plugin"

# 7. Launch Queryeer — the plugin is discovered and activated automatically
```

ZIP archives can also be placed directly in the same managed plugins directory.

---

## 5. Backend Plugins

### 5.1 Prerequisites

- JDK 21+
- Apache Maven 3.9+

### 5.2 Project Structure

```
my-backend-plugin/
├── plugin.json
├── pom.xml
└── src/main/java/com/example/
    └── MyBackendPlugin.java
```

### 5.3 `pom.xml`

Backend plugins depend on `backend-api` (provided scope) and pack their runtime dependencies:

```xml
<dependencies>
    <dependency>
        <groupId>com.queryeer.backend</groupId>
        <artifactId>backend-api</artifactId>
        <version>${queryeer.version}</version>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>com.queryeer.backend</groupId>
        <artifactId>backend-contract</artifactId>
        <version>${queryeer.version}</version>
        <scope>provided</scope>
    </dependency>
    <!-- Your runtime dependencies -->
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>my-lib</artifactId>
        <version>1.0.0</version>
    </dependency>
</dependencies>
```

Use the `maven-dependency-plugin` to generate a classpath file for the plugin loader:

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-dependency-plugin</artifactId>
            <executions>
                <execution>
                    <id>write-queryeer-plugin-deps</id>
                    <phase>generate-resources</phase>
                    <goals>
                        <goal>build-classpath</goal>
                    </goals>
                    <configuration>
                        <includeScope>runtime</includeScope>
                        <outputFile>
                            ${project.build.directory}/queryeer-plugin-deps.txt
                        </outputFile>
                    </configuration>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

### 5.4 Implementing `BackendPlugin`

```java
package com.example;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class MyBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        // Access services, register capabilities
        SomeService service = context.services().get(SomeService.class);
        context.logger().info("Activated my backend plugin");
    }

    @Override
    public void deactivate()
    {
        // Cleanup resources
    }
}
```

Alternatively, implement `BackendPluginFactory` for more control over instantiation:

```java
package com.example;

import com.queryeer.backend.api.BackendPluginFactory;
import com.queryeer.backend.api.PluginHostServices;

public final class MyPluginFactory implements BackendPluginFactory
{
    @Override
    public BackendPlugin create(PluginHostServices hostServices)
    {
        return new MyBackendPlugin(hostServices);
    }
}
```

### 5.5 `BackendPluginContext` Services

| Service | Accessor | Description |
|---------|----------|-------------|
| `ConfigService` | `context.config()` | Application configuration |
| `QueryEngineRegistry` | `context.queryEngines()` | Register/resolve query engines |
| `FileSessionHandlerRegistry` | `context.fileSessions()` | File session lifecycle |
| `EventBus` | `context.events()` | Publish/subscribe to events |
| `SchedulerService` | `context.scheduler()` | Scheduled task execution |
| `PayloadMapper` | `context.payloadMapper()` | JSON/object mapping |
| `PluginServiceRegistry` | `context.services()` | Cross-plugin service registry |
| `ChangelogRegistry` | `context.changelogs()` | Plugin changelogs |
| `Logger` | `context.logger()` | Plugin-scoped logger |

### 5.6 Building & Packaging

Backend plugins use the Maven `maven-dependency-plugin` to produce a classpath file listing runtime dependencies. The `pom.xml` must include:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-dependency-plugin</artifactId>
      <executions>
        <execution>
          <id>write-queryeer-plugin-deps</id>
          <phase>generate-resources</phase>
          <goals><goal>build-classpath</goal></goals>
          <configuration>
            <includeScope>runtime</includeScope>
            <outputFile>${project.build.directory}/queryeer-plugin-deps.txt</outputFile>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

Build:

```bash
cd backend
mvn clean package -DskipTests
```

This produces `target/classes/` (compiled plugin classes) and `target/queryeer-plugin-deps.txt` (classpath). The `plugin.json` references these in the classpath section:

```json
"classpath": {
    "root": "backend",
    "include": ["target/classes", "@target/queryeer-plugin-deps.txt"]
}
```

If the Maven module is not in a `backend/` subdirectory, adjust `root` accordingly.

### 5.7 Classloader Isolation

Each backend plugin runs in its own `URLClassLoader`. The parent classloader handles:
- `java.*`, `javax.*`, `jdk.*`, `sun.*`
- `com.queryeer.backend.api.*`
- `com.queryeer.backend.contract.*`
- Any additional parent-first prefixes contributed by runtime plugins

All other packages use **child-first** resolution, meaning plugin jars take priority over the application classpath.

---

## 6. Full-Stack Plugins

A full-stack plugin provides both a frontend and backend. The `plugin.json` includes both sections:

```json
{
  "schemaVersion": 1,
  "id": "my.fullstack.plugin",
  "name": "My Full-Stack Plugin",
  "version": "0.1.0",
  "backend": {
    "entrypointClass": "com.example.MyBackendPlugin",
    "classpath": { "root": ".", "include": ["target/classes", "@target/queryeer-plugin-deps.txt"] }
  },
  "frontend": {
    "entryModule": "./module.js"
  }
}
```

Backend and frontend communicate via the **NDJSON over stdio** protocol. The backend runtime status (`backend.runtimeStatus` notification) lets the frontend monitor backend plugin health.

Frontend plugins can use `context.editors.getActiveEditor()`, query engines, file sessions, and other services that bridge to the backend.

---

## 7. Contribution Point Reference

All contribution points are accessed through the `PluginContext` object passed to `activate()`.

### 7.1 Layout

| Method | Type | Description |
|--------|------|-------------|
| `layout.registerEditor(contribution)` | `LayoutEditorContribution` | Register a file editor |
| `layout.registerView(contribution)` | `LayoutViewContribution` | Register a sidebar view |
| `layout.registerToolbarAction(contribution)` | `LayoutToolbarContribution` | Register a toolbar button |
| `layout.registerStatusItem(contribution)` | `LayoutStatusItemContribution` | Register a status bar item |
| `layout.registerPanel(contribution)` | `LayoutPanelContribution` | Register a bottom panel |
| `layout.registerWelcome(contribution)` | `LayoutWelcomeContribution` | Register a welcome page |
| `layout.registerTabContextMenu(contribution)` | `TabContextMenuContribution` | Tab right-click menu |
| `layout.registerTabHeaderStyle(contribution)` | `TabHeaderStyleContribution` | Tab header styling |
| `layout.registerTabTitle(contribution)` | `TabTitleContribution` | Custom tab title |
| `layout.setShellDefaults(defaults)` | `LayoutShellDefaults` | Default shell layout |

### 7.2 Editor

| Method | Type | Description |
|--------|------|-------------|
| `editors.getActiveEditor()` | `EditorHandle \| null` | Get active editor handle |
| `editors.onActiveEditorChanged(cb)` | `Disposable` | Subscribe to editor changes |

### 7.3 Files & MIME

| Method | Type | Description |
|--------|------|-------------|
| `files.registerMimeResolver(fn)` | `MimeResolver` | Register MIME type resolver |
| `files.capabilities.registerCapabilities(mime, caps)` | `MimeCapability[]` | Set file capabilities |
| `files.capabilities.registerContentCategory(mime, cat)` | `ContentCategory` | Set content category |
| `files.mimeIcons.registerMimeIcon(contribution)` | `MimeIconContribution` | Register MIME type icon |
| `files.registerEditorResolver(fn)` | `EditorResolver` | Override editor resolution |
| `files.openFile(input)` | `FileOpenInput` | Programmatically open a file |
| `files.listFiles()` | `FileEntity[]` | List open files |
| `files.subscribe(fn)` | `FilesSubscriber` | Subscribe to file changes |

### 7.4 Commands & Keybindings

| Method | Type | Description |
|--------|------|-------------|
| `commands.registerCommand(cmd)` | `CommandHandler` | Register a command |
| `commands.executeCommand(id)` | `Promise<CommandExecutionResult>` | Execute a command |
| `keybindings.registerKeybinding(kb)` | `KeybindingContribution` | Register a keybinding |

### 7.5 Context Menus

| Method | Type | Description |
|--------|------|-------------|
| `contextMenu.registerProvider(p)` | `ContextMenuProvider` | Editor context menu |
| `tableOutputContextMenu.registerProvider(p)` | `TableOutputContextMenuProvider` | Table result context menu |
| `jdbcTreeContextMenu.registerContribution(c)` | `JdbcTreeContextMenuContribution` | JDBC tree context menu |

### 7.6 Tooltips

| Method | Type | Description |
|--------|------|-------------|
| `tooltip.registerTooltipSection(c)` | `TooltipSectionContribution` | File tab tooltip |

### 7.7 Settings

| Method | Type | Description |
|--------|------|-------------|
| `settings.registerSettings(s)` | `SettingDefinition[]` | Register settings |
| `settings.registerAdvancedRenderer(r)` | `AdvancedRenderer` | Custom settings UI |
| `settings.registerAdvancedValidator(v)` | `AdvancedValidator` | Settings validation |

### 7.8 Quick Commands (Command Palette)

| Method | Type | Description |
|--------|------|-------------|
| `quickcommand.registerProvider(p)` | `QuickCommandProvider` | Command palette items |

### 7.9 Outline

| Method | Type | Description |
|--------|------|-------------|
| `outline.registerOutlineProvider(r)` | `OutlineProviderRegistration` | Outline/symbol provider |
| `outline.registerSupplementaryOutlineProvider(r)` | `OutlineProviderRegistration` | Additional outline provider |

### 7.10 Notifications

| Method | Type | Description |
|--------|------|-------------|
| `notifications.notify(req)` | `NotificationRequest` | Show a notification |
| `notifications.list()` | `NotificationRecord[]` | List all notifications |
| `notifications.unreadCount()` | `number` | Unread count |
| `notifications.markRead(id)` | `void` | Mark notification as read |

### 7.11 Dialog

| Method | Type | Description |
|--------|------|-------------|
| `dialog.showMessage(opts)` | `Promise<DialogResult>` | Show message dialog |
| `dialog.showOpenDialog(opts)` | `Promise<OpenResult>` | Open file/folder dialog |
| `dialog.showSaveDialog(opts)` | `Promise<SaveResult>` | Save file dialog |

### 7.12 Menu

| Method | Type | Description |
|--------|------|-------------|
| `menu.registerMenuItem(item)` | `MenuItemContribution` | Native menu item |
| `menu.rebuildMenu()` | `Promise<void>` | Rebuild native menu |

### 7.13 About

| Method | Type | Description |
|--------|------|-------------|
| `about.registerChangelog(entry)` | `PluginChangelogEntry` | Plugin changelog entry |

### 7.14 Assistant (AI)

| Method | Type | Description |
|--------|------|-------------|
| `assistant.registerToolContribution(t)` | `AssistantToolContribution` | AI assistant tool |
| `assistant.registerContextContribution(c)` | `AssistantContextContribution` | AI assistant context |

---

## 8. Debugging & Testing

### 8.1 Frontend Debugging

- Open Chrome DevTools: **View → Toggle Developer Tools** (or `Ctrl+Shift+I`)
- Check the **Console** tab for plugin load errors and diagnostics
- The Vite dev server provides HMR for internal plugins during development
- Logging from plugins appears in the renderer console

### 8.1.1 Dev-Mode: Vite `fs.allow` for External Plugins

In **dev mode** (`npm run dev`), external plugin modules are loaded via the Vite dev server at `http://localhost:5173/@fs/<path>/plugin.js`. The Vite dev server restricts file access to paths in its `server.fs.allow` list.

The following directories are allowed by default:

- `queryeer-desktop/packages/app/` (renderer root)
- `queryeer-desktop/` (project root)
- `plugins/` (built-in plugins)
- Queryeer's default per-user managed plugins directory

If you move the per-user plugins directory outside Queryeer's default app-data location, dev-mode dynamic imports are not supported until a managed plugin serving protocol is added.

In **production mode** (`file://` protocol), this restriction does not apply.

### 8.1.2 Dev-Mode: React Module Resolution

In **dev mode**, the Vite dev server transforms external plugin modules loaded via `/@fs/`. If a plugin uses `--external:react --external:react-dom` in its esbuild build (see §9.1), the plugin output contains bare `import` specifiers:

```js
import { useCallback } from "react";
```

Vite resolves these to its pre-bundled dependencies — the **same React instance** used by the host.

### 8.1.3 Production Mode: Blob-URL Rewriting

In **production mode** (`file://`), bare specifiers cannot be resolved by the browser. The app handles this automatically:

1. The renderer exposes React via `globalThis.__queryeerExternals`
2. The plugin loader in `discovery.ts` fetches the plugin module text
3. Bare `import` statements for known modules (`react`, `react-dom/client`) are rewritten to `const { ... } = globalThis.__queryeerExternals["..."]`
4. The rewritten module is loaded from a `blob:` URL

No action is required from plugin authors — this works transparently.

### 8.1.4 Error Boundary — Plugin Crash Isolation

Plugin-provided React components are wrapped in `<PluginErrorBoundary>` at most render sites. If a plugin's render function throws:

- The error is caught and logged to the console
- Only that component's area shows a fallback UI (plugin name + error message)
- The rest of the app continues to work normally

Currently guarded render sites:

| Area | Component | Render call |
|------|-----------|-------------|
| Sidebar panels | `Sidebar.tsx` | `view.render()` |
| Editor pane | `EditorPane.tsx` | `activeEditor.render()` |
| Welcome screens | `EditorPane.tsx` | `welcome.render()` |
| Status bar items | `StatusBar.tsx` | `item.render()` |
| Bottom panel tabs | `ShellApp.tsx` | `tab.render()` |
| Query output views | `OutputPanel.tsx` | `contributor.render()` |

See §10.7 for render sites that are **not** yet guarded.

### 8.2 Backend Debugging

- Backend logs appear on stdout/stderr (the backend runs as a subprocess)
- Set the `LOG_LEVEL` environment variable to `DEBUG` for verbose output
- The `backend.runtimeStatus` notification provides backend plugin health in the frontend

### 8.3 Plugin Diagnostics

The bootstrap process collects `loadErrors` for any plugins that fail to load. These are surfaced in the application UI when diagnostics are enabled.

### 8.4 Testing Patterns

**Frontend unit test (Vitest):**

```typescript
import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

function createMockContext(): PluginContext {
  return {
    commands: { registerCommand: vi.fn(), executeCommand: vi.fn(), canExecuteCommand: vi.fn() },
    layout: {
      registerView: vi.fn(),
      registerEditor: vi.fn(),
      registerToolbarAction: vi.fn(),
      // ... mock all required registries
    },
    tooltip: { registerTooltipSection: vi.fn() },
    notifications: { notify: vi.fn(), list: vi.fn(), /* ... */ },
    // ...
  } as unknown as PluginContext;
}

describe("MyPlugin", () => {
  it("should register a view on activate", () => {
    const context = createMockContext();
    myPlugin.activate(context);
    expect(context.layout.registerView).toHaveBeenCalledOnce();
  });
});
```

**Backend unit test (JUnit 5):**

```java
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;

class MyBackendPluginTest
{
    @Test
    void testActivate()
    {
        var context = mock(BackendPluginContext.class);
        var descriptor = mock(PluginDescriptor.class);
        var plugin = new MyBackendPlugin();
        plugin.activate(context, descriptor);
        // Verify interactions
    }
}
```

---

## 9. Distribution

### Folder Layout

A plugin can be distributed as either a directory or a `.zip` archive:

```
plugins/
├── my-plugin/
│   ├── plugin.json
│   ├── plugin.js            # Compiled frontend entry (esbuild bundle)
│   ├── lib/                 # Backend jars
│   │   └── my-backend.jar
│   └── deps/                # Backend dependency jars
│       └── ...
└── my-other-plugin.zip      # Zipped plugin archive
```

**Tip:** After running `npm run package`, the output `dist/` contains a ready-to-deploy subfolder named after the plugin. Copy it directly:

```sh
cp -r dist/my-plugin "<queryeer-user-data>/plugins/my-plugin"
```

### Managed Plugin Directory

External plugins are installed per user under Queryeer's managed plugins directory. On Windows this is usually `%APPDATA%\queryeer-desktop\plugins`. Builtin plugins are platform components, are loaded separately, and are not user-manageable plugins.

Queryeer maintains `%APPDATA%\queryeer-desktop\settings\plugins-lock.json` next to the other settings files. The lockfile records discovered external plugin IDs, versions, source paths, enablement, restart requirements, and install integrity metadata (`sha256` archive hash + install timestamp).

Use **Tools -> Plugins** to open the Plugin Manager. The current UI lists external plugins only, shows missing/invalid entries, and toggles enablement for the next app restart. Builtin plugins are intentionally absent from this UI and cannot be disabled.

### Build Configuration

#### `package.json`

List `react`, `react-dom`, and `@queryeer/api` as **`peerDependencies`** — they are provided at runtime by the host app. Also list them in `devDependencies` for local type-checking and development:

```json
{
  "peerDependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@queryeer/api": "^0.10.0"
  },
  "devDependencies": {
    "@queryeer/api": "^0.10.0",
    "esbuild": "^0.23.0",
    "react": "^18.3.1",
    "typescript": "^5.5.0"
  }
}
```

Pure backend-plugins (no frontend code) can omit `react` and `react-dom`.

#### esbuild Arguments

Add `--external:react --external:react-dom` to the esbuild build command. This prevents React from being bundled into the plugin output. Instead, the plugin emits bare ESM `import` statements that the host resolves — ensuring both the host and all plugins share the **same React instance**.

```sh
esbuild module.ts --bundle --format=esm --jsx=automatic \
  --external:react --external:react-dom   \
  --loader:.ts=ts --loader:.tsx=tsx --loader:.css=text \
  --outfile=dist/plugin.js
```

**Why external?** If React is bundled into the plugin, the browser's native `import()` creates a separate React instance. React hooks (used internally by the host's reconciler) check a global dispatcher that only exists on the host's React, causing `Invalid hook call` errors. Sharing React via `--external` + the host's module resolution avoids this.

**CSS loader:** The `--loader:.css=text` flag causes esbuild to inline CSS files as JavaScript strings (the `injectStyles` helper injects them as `<style>` elements at activation time). CSS is data, not a module, so it does not need to be external.

### Plugin ID Conventions

Use reverse-domain notation for plugin IDs to avoid collisions:

- `com.example.myplugin`
- `my.company.queryeer.plugin`

---

## 10. Current Limitations & Known Gaps

### 10.1 ~~Payloadbuilder Catalog Registration~~ *(Resolved)*

Plugins can now register Payloadbuilder catalog contributions via `context.payloadbuilderCatalog.registerContribution(...)`. The `PayloadbuilderCatalogContribution` and `PayloadbuilderCatalogRegistry` types are exported from `@queryeer/api/queryengine/PayloadbuilderCatalogExtension`.

```typescript
import type { PayloadbuilderCatalogContribution } from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension";

context.payloadbuilderCatalog.registerContribution({
  catalogId: "my-plugin.catalog",
  title: "My Catalog",
  defaultAlias: "my_catalog",
  allowMultiple: false,
  renderPanel: (props) => <MyPanel {...props} />
});
```

See the `payloadbuilder-catalog` example in [`plugins-examples/payloadbuilder-catalog/`](./plugins-examples/payloadbuilder-catalog/) for a complete working example.

### 10.2 Frontend Plugin SDK

There is currently no dedicated plugin scaffolding tool (`create-queryeer-plugin`). Developers must manually set up their project structure.

### 10.3 Plugin Version Resolution

Version compatibility between plugins is not enforced beyond simple dependency ID checks. SemVer range resolution is not implemented.

### 10.4 Plugin Configuration UI

There is no dedicated UI for users to enable/disable plugins or view plugin metadata. Plugin status can be monitored via the `backend.runtimeStatus` notification.

### 10.5 Hot-Reload

External plugins are loaded once at startup. There is no watch mechanism to detect newly added or updated plugins at runtime.

### 10.6 Security

Plugins have full access to the backend API (file system, query execution, etc.). There is no plugin signing, integrity verification, or sandboxing beyond classloader isolation.

### 10.7 Unguarded Plugin Render Sites

The following plugin-provided render callbacks are **not** yet wrapped in `<PluginErrorBoundary>`:

| Area | File | Render call | Risk |
|------|------|-------------|------|
| Toolbar actions | `Toolbar.tsx` | `icon({ className })` | Crashes the toolbar row |
| MIME icons | `MenuBar.tsx`, `EditorTabs.tsx` | `<MimeIcon />` | Crashes menu bar / tab bar |
| Panel action icons | `Sidebar.tsx` | `{action.icon}` | Crashes that panel's header |
| Settings advanced renderers | `SettingsModalHost.tsx` | `advanced` (from `renderer.render(...)`) | Crashes the settings modal |
| Flow node configuration | `FlowContextView.tsx` | `renderConfiguration?.({...})` | Crashes the flow context sidebar |
| Toolbar select/menu callbacks | `Toolbar.tsx` | `isVisible()`, `getOptions()`, etc. | Crashes the toolbar |

A throw in any of these still takes down the surrounding UI area.

---

## Reference: Example Plugins

The [`plugins-examples/`](./plugins-examples/) directory in this repository contains complete, working example plugins:

| Example | Type | Build | Key Concepts |
|---------|------|-------|-------------|
| `hello-world-panel` | Frontend-only | `npm install && npm run package` → `dist/` | View registration, command, tooltip |
| `custom-editor` | Frontend-only | `npm install && npm run package` → `dist/` | MIME type, custom editor, context menu, outline, icons |
| `csv-exporter` | Frontend-only | `npm install && npm run package` → `dist/` | Table output context menu |
| `payloadbuilder-catalog` | Full-stack | `npm install && npm run package` (builds frontend + backend) → `dist/` | Payloadbuilder catalog, `BackendPlugin`, catalog panel |
| `jdbc-dialect` | Backend-only | `npm run package` (runs `mvn clean package`) → `dist/` | `BackendPlugin`, `JdbcDialect`, dialect registration, connection setup |

Each example's `npm run package` produces `dist/<plugin-folder>/` — copy that subfolder to Queryeer's managed plugins directory and restart Queryeer.

Refer to each example's source code and inline comments for detailed implementation guidance.
