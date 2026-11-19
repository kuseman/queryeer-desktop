# Developing Queryeer Plugins

Queryeer is an extensible desktop application for data querying and exploration. Plugins can extend both the **frontend** (Electron + React + TypeScript) and the **backend** (Java 25+), or one side alone.

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
11. [Upgrading Plugins to 0.20.0](#11-upgrading-plugins-to-0200)

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
| Backend | Java 25+, Maven | `BackendPlugin` (`backend-api`) |
| IPC | NDJSON over stdio | Contract types in `@queryeer/api` / `backend-contract` |

### The `@queryeer/api` Package

Frontend plugins depend on the [`@queryeer/api`](https://www.npmjs.com/package/@queryeer/api) TypeScript package, which provides all contract types:

```json
{
  "devDependencies": {
    "@queryeer/api": "^0.20.0"
  }
}
```

Use `^` plus the host's minor version (`^0.<minor>.0` for Queryeer 0.<minor>.x), both here and in the manifest's `frontend.apiVersion`. For 0.x versions npm's `^` stays within that minor version. The snippets in this guide and the example plugins are updated to the new version as part of each release.

The API package exports types for:
- Plugin core: `Plugin`, `PluginContext`, `PluginManifest`, `PluginModule`, and for external plugins `ExternalPlugin`, `ExternalPluginModule`, `ExternalPluginManifest`
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
    "apiVersion": "^0.20.0"
  },
  "packaging": {
    "layout": {
      "jarsDir": ".",
      "typescriptDir": "."
    }
  }
}
```

Backend plugins may use `backend.factoryClass` instead of `backend.entrypointClass`. The factory form is recommended when construction needs host services. When `backend.classpath` is present, both `root` and at least one `include` pattern are required; this matches backend manifest validation. The checked-in schema also describes trusted shared-runtime declarations used by builtin plugins. Runtime-only manifests are reserved for those builtins and are not an external plugin entrypoint. Compatibility fields such as `frontend.apiVersion` and `backend.minJavaVersion` are currently descriptive and are not yet enforced during discovery.

| Property | Required | Description |
|----------|----------|-------------|
| `schemaVersion` | **yes** | Must be `1` |
| `id` | **yes** | Unique plugin identifier (reverse-domain recommended) |
| `name` | **yes** | Human-readable name |
| `version` | **yes** | SemVer string |
| `description` | no | Brief description |
| `dependencies` | no | Plugins this plugin depends on: plugin IDs, or `{ "id": ..., "version": ... }` with a SemVer range (see 3.3) |
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

**Backend version ranges.** A dependency can name the versions it works with, as an npm-style SemVer range:

```json
"dependencies": [{ "id": "queryengine.jdbc", "version": "^0.20.0" }]
```

- Supported: `1.2.3`, `=`, `>`, `>=`, `<`, `<=`, `^`, `~`, wildcards (`1.x`, `*`), partial versions (`1.2`), hyphen ranges (`1.2.3 - 2.0.0`), comparators joined by spaces (and) and `||` (or).
- **Built-in plugins report the Queryeer backend version**, not the `version` in their manifest, so a range on a built-in such as `queryengine.jdbc` targets a Queryeer release. A development build (`0.20.0-SNAPSHOT`) counts as the release it becomes.
- **A development build doesn't enforce ranges.** When the dependency's version is a development build (it ends with `-SNAPSHOT`) and the range doesn't match, the plugin still loads, with a warning in the log and in its runtime status. Built-in plugins report `-SNAPSHOT` only when Queryeer runs from source, so a plugin built for the last release keeps loading while core works toward the next one, and the warning names the ranges to update. A released Queryeer enforces ranges on built-in plugins. The same applies to an external plugin installed as a `-SNAPSHOT` build: plugins that depend on it load with a warning. Only the range is relaxed: a missing dependency still skips the plugin.
- Other prereleases follow npm: `1.2.0-beta.1` satisfies a range only when the range names a prerelease of `1.2.0`.
- A plain ID accepts any version. An invalid range rejects the manifest.

**Skipped plugins.** The backend skips, with a reason shown in the runtime status, a plugin whose dependency is missing (`Missing dependency: <id>`), out of range (`Needs <id> <range>, but <version> is installed`) or itself skipped (`Dependency <id> was skipped`), and one whose required capability is only provided by skipped plugins. These checks are backend-only; the frontend resolves a plugin's dependencies from the `manifest` in its TypeScript plugin object.

### 3.3.1 Sharing Classes Between Backend Plugins

Each backend plugin has its own class loader. A plugin offers classes to others by exporting packages, and a plugin sees them only through a declared dependency:

```json
"backend": {
  "entrypointClass": "com.example.api.ApiPlugin",
  "exports": ["com.example.api."]
}
```

A plugin's class loader looks for a class in this order:

1. The JVM and Queryeer's API (`java.`, `com.queryeer.backend.api.`, `com.queryeer.backend.contract.`, …), from the parent.
2. Packages exported by a **direct** dependency, from that dependency's own jars. There is one copy of each exported class, so a service registered with `context.services()` by the exporter is found by its dependents. An export is not passed on: a plugin that needs another plugin's exports depends on it directly.
3. The plugin's own jars (`lib/`).
4. The shared parent: `libShared`, where Queryeer's driver service installs JDBC drivers.

Rules:

- **Compile against an exported API with `provided` scope and do not bundle it.** A bundled copy is ignored for the exported packages, but it wastes space and hides a missing dependency.
- **Declare the dependency.** Without it, the exported classes are not visible, and the error names the plugin to depend on: `com.example.api.Api: plugin com.example.api exports it, but my.plugin does not declare a dependency on com.example.api`.
- **Exports are package prefixes** of at least two parts ending in `.`, outside the JVM's and Queryeer's API packages. A plugin can only serve classes from its own jars.
- **Keep third-party types out of an exported API** where you can: a dependent that needs them must get them from the exporter too, which means exporting the library as well.
- **Mark an API library's implementation dependencies `<optional>true</optional>`** in its own POM. Maven has no "internal" scope; an optional dependency is the closest: dependents do not inherit it, so they cannot compile against its types by accident, while the library itself compiles and tests with it. The plugin that bundles the library declares those dependencies itself. Queryeer's SQL parser does this with tree-sitter:

  ```xml
  <!-- backend-lib-queryengine-sql-parser: tree-sitter is its implementation, not part of its API -->
  <dependency>
      <groupId>io.github.bonede</groupId>
      <artifactId>tree-sitter</artifactId>
      <version>${tree-sitter.version}</version>
      <optional>true</optional>
  </dependency>
  ```

  So a dialect that depends on `backend-lib-queryengine-sql-parser` with `provided` scope gets only the parser's own classes on its compile classpath; `queryengine.jdbc` bundles tree-sitter. A dialect whose tests run the parser adds tree-sitter with `test` scope.

The built-in JDBC engine (`queryengine.jdbc`) exports the JDBC foundation (`com.queryeer.backend.queryengine.jdbc.`) and the SQL parser (`com.queryeer.backend.queryengine.sql.parser.`). The parser's API takes SQL text, not parse trees: tree-sitter, which it uses inside, is not exported. A JDBC dialect depends on `queryengine.jdbc`:

```json
"dependencies": [{ "id": "queryengine.jdbc", "version": "^0.20.0" }]
```

### 3.4 Activation

Each plugin's `activate(context)` method is called in dependency order. The `PluginContext` provides all registries (commands, layout, files, etc.). Plugins register their contributions during activation.

---

## 4. Frontend-Only Plugins

### 4.1 Prerequisites

- Node.js 22+ to build the plugin (24 matches the Queryeer toolchain)
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

Every frontend plugin **must** export a named `const pluginModule: ExternalPluginModule`:

```typescript
import type { ExternalPluginModule } from "@queryeer/api/plugin/PluginModule";
import { myPlugin } from "./plugin";
import "./my-styles.css";

export const pluginModule: ExternalPluginModule = {
  manifest: myPlugin.manifest,
  plugin: myPlugin
};
```

### 4.5 `plugin.tsx` — The Plugin Implementation

```typescript
import type { ExternalPlugin } from "@queryeer/api/plugin/PluginModule";

export const myPlugin: ExternalPlugin = {
  manifest: {
    kind: "feature"
  },
  activate: (context) => {
    // Register contributions using context.* registries
    // See Section 7 for the full list of available registries
  }
};
```

The `manifest` inside the plugin object is an `ExternalPluginManifest`: `kind`, and the frontend `dependencies`, `providesCapabilities` and `requiredCapabilities`. The `kind` field distinguishes `"core"` (system-level) from `"feature"` (extension-level). External plugins should use `"feature"`.

The plugin's identity, `id`, `name`, `version` and `description`, is declared once, in `plugin.json`, and the host fills it into the manifest before activating the plugin. `ExternalPluginManifest` has no such fields. A plugin built for 0.19 still sets them in its frontend manifest; it loads, the values are ignored, and the console warns about any that differ from `plugin.json`. That includes the id: a plugin whose frontend id differs is now loaded under `plugin.json`'s id, so code in it that hard-codes the other id (metadata keys, `when` expressions) no longer matches. The frontend `dependencies` are frontend plugin ids such as `core.queryengine.jdbc`, not the backend ids with versions in `plugin.json`, so they stay here.

When the plugin needs its own id, for example as a settings `moduleId` or in `activeFile.metadata.<id>` keys, read it from `context.plugin` (`id`, `name`, `version`, `description`) in `activate` instead of hard-coding it again:

```typescript
activate: (context) => {
  const settingId = `${context.plugin.id}.connections`;
  // ...
}
```

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
    "@queryeer/api": "^0.20.0",
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

Plugin CSS may rely on these stable host theme variables: `--bg-0` through `--bg-3`, `--text-0` through `--text-3`, `--accent`, `--accent-muted`, `--focus-border`, `--border`, `--input-bg`, `--surface-1`, `--surface-overlay-weak`, `--surface-overlay-soft`, `--state-error`, `--state-error-soft`, `--state-warning`, `--success`, `--state-select-bg`, `--state-select-bg-hover`, `--ui-font-size-xs`, `--ui-font-size-sm`, `--ui-font-size-md`, `--ui-font-size-title`, `--font-mono`, and `--editor-font`. Host CSS class names are implementation details and are not a plugin API.

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

**Every `register*`, `subscribe` and `on*` method returns a `Disposable`** (since 0.20.0; before, most returned nothing, and the `subscribe` methods, `fileMediator.onActiveFileChanged` and the assistant's `register*Contribution` returned an unsubscribe function). **This breaks plugins built against 0.19 that call that function**: rebuild them against 0.20 and call `dispose()` instead. Keep the `Disposable`s and dispose them in `deactivate`:

```ts
import type { Disposable } from "@queryeer/api/editor/EditorApi";

const disposables: Disposable[] = [];

activate(context) {
  disposables.push(
    context.commands.registerCommand({ id: "my.plugin.run", title: "Run", handler: run }),
    context.settings.subscribe(onSettingsChanged)
  );
}

deactivate() {
  for (const disposable of disposables.splice(0)) disposable.dispose();
}
```

Disposing removes the registration, unless a later registration with the same id replaced it; then the later one stays. A listener stops being called. Disposing twice does nothing. Plugins are only deactivated when the app quits, so the UI isn't required to update when a contribution is removed: a view or toolbar button can stay visible until the next start.

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
| `editorLanguages.registerMimeType(mime, languageId)` | `Disposable` | Map a MIME type to a Monaco language |
| `editorLanguages.registerLanguage(definition)` | `Disposable` | Register a new Monaco language (Monarch tokenizer + optional brackets/comments/auto-closing configuration, no validation); map a MIME type to it with `registerMimeType` |

A plugin whose files don't fit an existing Monaco language (for example MongoDB shell syntax,
which `json` and `javascript` both flag as errors) registers its own language first:

```ts
const language = context.editorLanguages.registerLanguage({
  id: "mongodb",
  aliases: ["MongoDB"],
  monarch: {
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\b(db|find|aggregate|sort|limit)\b/, "keyword"],
        [/[{}()[\]]/, "@brackets"]
      ]
    }
  },
  configuration: {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: "\"", close: "\"" }]
  }
});
const mapping = context.editorLanguages.registerMimeType("application/x-mongodb", "mongodb");
// dispose both on deactivate
```

The id must not be a built-in Monaco language (`json`, `sql`, ...); such registrations are ignored
with a warning. Registering an id another plugin already registered throws. Monaco cannot remove a
language, so disposing a registration clears its tokenizer and configuration and frees the id for a
later `registerLanguage` call.

The definition is applied after Monaco loads, so `registerLanguage` returns a `Disposable` even when the
tokenizer is broken (a bad regex, a rule pointing at a missing state). Such errors, and the built-in id
warning above, only appear in the developer console (`[editorLanguages] ...`); check it when a language
doesn't highlight as expected.

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
| `whenExpressions.registerVariables(vars)` | `Disposable` | Context variables offered by when-expression autocompletion in settings, typically your `activeFile.metadata.<plugin id>.*` keys (`CtxVar`: `name`, `type`, `description`). Listed once per name, with the first registration's description |
| `whenExpressions.registerTemplates(templates)` | `Disposable` | Ready-made expressions offered in the when-expression editor (`WhenExpressionTemplate`: `name`, `when`, `description?`). Listed once per name and expression |

Both only help the user write expressions; they don't change how one evaluates. Disposing releases that call's registrations; an entry another plugin registered too stays listed until that plugin's registration is disposed as well.

### 7.5 Context Menus

| Method | Type | Description |
|--------|------|-------------|
| `contextMenu.registerProvider(p)` | `ContextMenuProvider` | Editor context menu |
| `tableOutputContextMenu.registerProvider(p)` | `TableOutputContextMenuProvider` | Table result context menu |
| `jdbcTreeContextMenu.registerContribution(c)` | `JdbcTreeContextMenuContribution` | JDBC tree context menu |

A table result provider's `getItems(context)` receives the selection (`selection`, `cellValuesByRow`), the result set's `columns` and `resultSetIndex`, and the grid's `fileId` plus the file's bound `engineId` when it has one. Act on `context.fileId` rather than the active file: with split editors, or when focus is elsewhere, the active file can be a different one. Filter on `context.engineId` to add items only for your engine's results. Provider and item `when` expressions see the same values as `tableSelection.fileId` and `tableSelection.engineId` (e.g. `when: "tableSelection.engineId == 'mongodb'"`); `activeFile.*` in a table menu `when` refers to the active file, not the grid's.

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
| `settings.getValue<T>(id)` | `T \| undefined` | Read the current effective value without resolving secrets; returns `undefined` until the settings service is ready |
| `settings.getAllValues()` | `Readonly<Record<string, unknown>>` | Snapshot all effective values |
| `settings.subscribe(cb)` | `Disposable` | Subscribe to effective-value changes |
| `settings.open(id?)` | `void` | Open Settings, optionally selecting a specific setting ID |

Use `context.components.PasswordFieldInput` in advanced settings renderers for credentials. The component stores plaintext through the host vault and reports only a `SecretRefValue` to the plugin.

Use `context.components.CollectionSettingsListEditor` for host-styled add, clone, delete, selection, validation markers, read-only behavior, and a caller-rendered detail pane. `context.components.useCollectionSettingsPersistence` provides `persistNow` and debounced persistence helpers; the latest pending debounced value is flushed when the component unmounts.

The settings service may still be initializing while a plugin's `activate` function runs. Plugins that need a setting during activation should register `settings.subscribe` first and read the value from the callback; the callback runs when settings become ready and on later changes. Settings contributions registered after initialization are refreshed and hydrated automatically.

### 7.8 Native Query Engines

Frontend plugins can bind MIME types to a backend query engine registered under the same engine ID:

```tsx
const engineRegistration = context.queryEngines.registerEngine({
  engineId: "mongodb",
  mimeTypes: ["application/vnd.queryeer.mongodb"]
});

const databases = await context.queryEngines.invoke<string[]>({
  engineId: "mongodb",
  action: "mongodb.databases"
}, { silent: true });

context.queryEngines.registerEditorHeaderItem({
  id: "com.example.mongodb.queryBar",
  engineId: "mongodb",
  title: "Query",
  render: ({ fileId }) => <QueryBar fileId={fileId} />
});

context.queryEngines.registerEditorStatusItem({
  id: "com.example.mongodb.connection",
  engineId: "mongodb",
  alignment: "right",
  render: ({ file }) => <span>{file?.engineBinding?.connectionId ?? "Not connected"}</span>
});

context.queryEngines.registerExecutionContextProvider("mongodb", ({ fileId }) => ({
  engineState: { connectionId: context.files.getFile(fileId)?.engineBinding?.connectionId }
}));

context.queryEngines.onQueryEvent("mongodb", (event, execution) => {
  if (event.method === "queryengine.completed") {
    const { engineState } = event.params as { engineState?: unknown };
    // Persist completed engine state for execution.fileId when needed.
  }
});
```

Editor header items render in an engine-scoped, wrapping strip above the text editor. Return `null` when an item does not apply to the current file; the strip is omitted when no items render content. Users can collapse the strip independently for each file. An item's optional `title` is shown while the strip is collapsed. Host keybindings continue to work inside header controls. A plugin control that needs to own its keys can opt out locally with `data-keybinding-scope="input"`; apply it only to the smallest control subtree that needs the override. Popups may be portalled to `document.body` (e.g. to escape the text pane's `overflow: hidden`); the editor group does not take focus on mousedown inside them, so plain elements such as `div` list options work without `preventDefault()` workarounds.

To open a new query tab with generated text and optionally run it, seed the file with `initialContent` and request the run with `queryEngines.execute`:

```ts
const file = await context.fileMediator.createUntitledFile({
  mimeType: "application/vnd.queryeer.mongodb",
  extension: "mongo",
  title: "orders",
  initialContent: text
});
await context.fileMediator.bindEngine(file.fileId, "mongodb", connectionId);
context.files.setEditorState(file.fileId, "mongodb.database", { connectionId, database });
context.queryEngines.execute({ fileId: file.fileId, text });
```

`initialContent` is applied when the file's editor model is created and leaves the file dirty, so it does not depend on the tab being active. `queryEngines.execute` runs the file now if its query editor shows it, otherwise as soon as the editor switches to it; there is no need to wait for the tab to mount. Pass `text` for a file you just created, since the editor content may not be loaded when the run starts; without `text` the file's current content (or selection) is run. Only one run request is pending at a time, so a later request replaces one that no editor has picked up yet. A request that no editor picks up within 10 seconds (the file isn't shown, sits in an inactive editor group, or was closed) is dropped rather than run later. If the editor is still starting another run when it switches to the file, the request waits and runs once that start finishes; the 10 seconds don't apply while it waits (e.g. on a vault unlock prompt), and restart if the user leaves the file before the request runs. Expired requests are logged with `console.debug`. Bind the engine and set editor state before calling `execute`, since the execution-context provider reads them when the run starts.

A MIME type claimed through `queryEngines.registerEngine` is owned by that engine. `fileMediator.bindEngine` rejects attempts to bind a file with that MIME type to another engine; MIME types not claimed by an engine remain freely bindable.

Execution-context providers and query-event listeners are filtered by the supplied engine ID, so a contribution only observes and decorates that engine's executions. Providers may return `engineState`, query `options`, or both. Returned `options` replace the existing options object, so spread `context.options` when returning options to preserve values such as `maxRows` and `timeoutMs`. The provider also decorates `queryEngines.invoke` calls that include a `fileId` and object payload without an explicit `engineState`. `queryEngines.invoke` resolves to exactly what the backend provider's `QueryEngineProvider.invoke(fileId, action, payload)` returns, serialized as JSON (`undefined` when it returns `null`). The promise rejects with an `Error` when the provider throws (with its message) or when the backend isn't running. When a secret is needed and the vault is locked, it asks the user to unlock it and retries; with `{ silent: true }` it doesn't ask, and rejects unless the vault can be unlocked without asking. Tests or tools that talk the stdio protocol directly see the same value one level deeper: the `queryengine.invoke` response is `{ "result": { "result": <value> } }`. External plugins are loaded once at startup and are not hot-reloaded.

### 7.9 Quick Commands (Command Palette)

| Method | Type | Description |
|--------|------|-------------|
| `quickcommand.registerProvider(p)` | `QuickCommandProvider` | Command palette items |

### 7.10 Outline

| Method | Type | Description |
|--------|------|-------------|
| `outline.registerOutlineProvider(r)` | `OutlineProviderRegistration` | Outline/symbol provider |
| `outline.registerSupplementaryOutlineProvider(r)` | `OutlineProviderRegistration` | Additional outline provider |

### 7.11 Notifications

| Method | Type | Description |
|--------|------|-------------|
| `notifications.notify(req)` | `NotificationRequest` | Show a notification |
| `notifications.list()` | `NotificationRecord[]` | List all notifications |
| `notifications.unreadCount()` | `number` | Unread count |
| `notifications.markRead(id)` | `void` | Mark notification as read |

### 7.12 JDBC Drivers

JDBC dialect frontend plugins can register driver metadata through `jdbcDrivers.registerDriver(contribution)`. The common JDBC settings UI handles status, periodic update checks, notifications, and managed installation. The plugin host records the activating plugin as the contribution owner.

The primary artifact uses Maven Central coordinates. Contributions may add typed, platform-constrained native companion archive declarations. Set `versionLockedToDriver: true` when an applicable companion must share the primary driver's lifecycle and derived release version; the UI keeps separate status rows but exposes one package action. Core manages any plugin's driver, after the user confirms its first install: until then its status has `approvalRequired: true`, and the settings UI shows an approval dialog with the plugin, the Maven coordinates, the companions' sources and the `downloadPageUrl`, so set that to the driver's licence or download page. Changing what the declaration downloads asks again. Builtin PostgreSQL, SQL Server, and SQLite contributions need no confirmation, and the main process replaces their metadata with canonical descriptors. For approved providers, duplicate runtime files are moved to recoverable provider-specific `disabled` folders before Java starts; retained version sets are exposed through `JdbcDriverStatus.disabledSets` and can be restored through the common settings UI. A native companion installs under its archive entry's file name. See [`documentation/JDBC_DRIVER_MANAGEMENT.md`](./documentation/JDBC_DRIVER_MANAGEMENT.md).

### 7.12.1 JDBC Dialects

A JDBC dialect is mostly backend: a `JdbcDialect` registered with the JDBC engine's `JdbcRuntimeService` (§3.3.1), which lists it in JDBC settings and builds its URL.

**Connection form from the backend.** Override `JdbcDialect.connectionSetup()` to return the form's fields (`JdbcConnectionSetupDefinition`). The JDBC settings editor renders the form from them, so a dialect needs no frontend code for it:

```java
@Override
public Optional<JdbcConnectionSetupDefinition> connectionSetup()
{
    return Optional.of(new JdbcConnectionSetupDefinition(List.of(
            new JdbcConnectionFieldDefinition("host", "Host", JdbcConnectionFieldType.TEXT, true, null, List.of(), null, null),
            new JdbcConnectionFieldDefinition("port", "Port", JdbcConnectionFieldType.NUMBER, false, null, List.of(), 3306, null),
            new JdbcConnectionFieldDefinition("username", "Username", JdbcConnectionFieldType.TEXT, true, null, List.of(), null, null),
            new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, false, null, List.of(), null, null))));
}
```

- Field ids are the keys of the connection's properties, which `buildUrl(properties)` and `openSessionConnection` read (`username`, `password`).
- Types: `TEXT`, `NUMBER`, `SECRET` (stored as the connection's password in the security vault, not in its properties), `BOOLEAN`, `SELECT` (with options), `FOLDER_PATH` and `FILE_PATH` (with a browse button that picks a folder or a file).
- A field's default is shown, and saved with the connection when the form is rendered from the fields.
- `visibleWhen` shows a field only when every field it names has one of the listed values; a field's default counts when it has no value. For example, a username for two of four authentication types: `Map.of("authType", List.of("SQL_SERVER_AUTH", "WINDOWS_NTLM_AUTH"))`.
- The backend runs on the user's machine, so `connectionSetup()` can leave out what doesn't apply to its platform, such as a Windows-only option. A stored value that is no longer offered still shows in its `SELECT`.
- Derived from the fields: a required, visible, non-secret field that is empty marks the connection invalid; the connection's subtitle is `host:port/database` when there is a `host` field, else the first required field's value.
- Without `connectionSetup()`, the dialect gets the generic JDBC URL, username and password form.

**Frontend additions** (`context.jdbcDialects.registerDialect`, returns a `Disposable`), only for what the fields cannot describe:

| Field | Description |
|-------|-------------|
| `dialectId` | The backend dialect's id |
| `ConnectionForm` | A hand-written form replacing the one rendered from the fields (`JdbcDialectConnectionFormProps`); provide `subtitle` and `validate` with it |
| `subtitle(properties)` | The connection's line in the connections list |
| `validate(properties)` | Problems; any problem marks the connection invalid |
| `supportsQueryPlan` | The backend dialect implements `queryPlanExecutor()`. Turns on Estimated Plan and the Actual Plan toggle for the dialect's files; core then runs the query with the intent `plan.estimated` or `plan.actual` and asks for a plan graph (`{ capability: "plan", kind: "graph" }`), and the backend routes it to `queryPlanExecutor()` |

Of the built-in dialects, PostgreSQL and SQL Server use the fields only (SQL Server's in `SqlServerConnectionSetup`, with `visibleWhen` and a Windows-only option); SQLite (file picker) has a hand-written form.

### 7.12.2 Action templates

Users define their own query actions in settings: **Tree Actions** run on a node in the SQL Databases tree, **Symbol Actions** on a symbol under the cursor in the editor. A plugin offers ready-made ones as templates; the user creates an action from a template, and nothing runs until they do.

| Method | Returns | Description |
|--------|---------|-------------|
| `jdbcTreeActions.registerTemplate(template)` | `Disposable` | `TreeActionTemplateContribution`: `id`, `title`, `description?`, `order?`, `action` (`label`, `when`, `query`, `mode`: `"execute"` or `"render"`, `outputTarget`: `"output"`, `"clipboard"`, `"newQuery"` or `"newQueryAndExecute"`, `outputId?`, `order?`) |
| `symbolActions.registerTemplate(template)` | `Disposable` | `SymbolActionTemplateContribution`: `id`, `title`, `description?`, `order?`, `action` (`label`, `when`, `query`, `order?`; `outputId?` can be set but symbol actions don't use it yet) |

A later template with the same `id` replaces an earlier one, and disposing a replaced registration does nothing. `${…}` in a query is replaced with the expression's value. What the expressions can read:

- **Tree action:** `when` and `query` see the command context (§7.4, so `activeFile` too) plus the clicked node as `node`: `kind`, `name`, `fullName`, `nodeType`, `connectionId`, `dialectId` and `attributes` (e.g. `node.attributes.catalog`, the node's database).
- **Symbol action:** `when` sees the command context plus `symbol`: `kind`, `name`, `fullName`, `detail` and `attributes`. The `query` sees **only** `symbol`, not `activeFile`. The query runs in the file, so it can use the file's current database through SQL (e.g. MySQL's `DATABASE()`).

```ts
context.jdbcTreeActions.registerTemplate({
  id: "com.example.jdbc.treeAction.selectTop100",
  title: "Example: Select Top 100 Rows",
  action: {
    label: "Select Top 100 Rows",
    when: "node.dialectId == 'example' && (node.kind == 'table' || node.kind == 'view')",
    query: "select * from ${node.fullName} limit 100",
    mode: "execute",
    outputTarget: "output"
  }
});
```

### 7.13 Dialog

| Method | Type | Description |
|--------|------|-------------|
| `dialog.showMessage(opts)` | `Promise<DialogResult>` | Show message dialog |
| `dialog.showOpenDialog(opts)` | `Promise<OpenResult>` | Open file/folder dialog |
| `dialog.showSaveDialog(opts)` | `Promise<SaveResult>` | Save file dialog |

### 7.14 Menu

| Method | Type | Description |
|--------|------|-------------|
| `menu.registerMenuItem(item)` | `MenuItemContribution` | Native menu item |
| `menu.rebuildMenu()` | `Promise<void>` | Rebuild native menu |

### 7.15 About

| Method | Type | Description |
|--------|------|-------------|
| `about.registerChangelog(entry)` | `PluginChangelogEntry` | Plugin changelog entry |

### 7.16 Assistant (AI)

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
- each folder in `QUERYEER_DEV_PLUGINS` (§8.4), and its real path when it is a link

If you move the per-user plugins directory outside Queryeer's default app-data location, dev-mode dynamic imports are not supported until a managed plugin serving protocol is added.

In **production mode** (`file://` protocol), this restriction does not apply.

### 8.1.2 Dev-Mode: React Module Resolution

In **dev mode**, the Vite dev server transforms external plugin modules loaded via `/@fs/`. If a plugin uses `--external:react --external:react-dom` in its esbuild build (see §9.1), the plugin output contains bare `import` specifiers:

```js
import { useCallback } from "react";
```

Vite resolves these to its pre-bundled dependencies — the **same React instance** used by the host.

### 8.1.3 Production Mode: Import Map

In **production mode** (`file://`), bare specifiers cannot be resolved by the browser because the module is loaded directly via `import("file:///...")` — it does not go through Vite's transform pipeline. The app handles this with a browser-native **import map** injected into the HTML at build time.

The build generates separate entry chunks for each shared library (`external-react.js`, `external-react-dom.js`, etc.) that re-export the host's React instances. The import map tells the browser how to resolve bare specifiers to these chunks:

```html
<script type="importmap">
{
  "imports": {
    "react":                 "./assets/external-react.js",
    "react/jsx-runtime":     "./assets/external-react-jsx-runtime.js",
    "react-dom":             "./assets/external-react-dom.js",
    "react-dom/client":      "./assets/external-react-dom-client.js"
  }
}
</script>
```

When a plugin module contains `import { createRoot } from "react-dom/client"`, the browser resolves it to `./assets/external-react-dom-client.js`, which re-exports `createRoot` and `hydrateRoot` from the host's `react-dom/client`.

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

### 8.4 The development loop: developer plugin folders and Restart Backend and Reload

Since 0.20.0, Queryeer loads plugins in place from your build output, and restarts its backend without quitting.

**Developer plugin folders.** Set `QUERYEER_DEV_PLUGINS` to plugin folders before starting Queryeer (or `npm run dev` in core). Separate them like `PATH`: `;` on Windows, `:` elsewhere. Each folder is one plugin, laid out like an installed one: `plugin.json`, `lib/*.jar`, the frontend bundle.

```powershell
$env:QUERYEER_DEV_PLUGINS = "C:\src\my-plugins\plugins\mysql\dist\com.queryeer.mysql-0.1.0"
& "C:\Program Files\Queryeer\Queryeer.exe"
```

- They aren't installed and aren't in the lockfile. They are always enabled, and they replace an installed plugin with the same `plugin.json` id, so you can keep the released version installed. The whole installed plugin is replaced, frontend and backend, even when the folder has only one of the two.
- A folder isn't loaded, on either side, when its id starts with `core.` or `queryengine.` (built-in plugins can't be replaced), when an earlier folder has the same id, or when `plugin.json` names a frontend module that doesn't exist yet. **Tools → Plugins** lists the folders under "Developer plugin folders", with the reason for each one that isn't loaded.
- If a folder's backend fails to load (for example a half-written build), the backend logs why and starts without it; the installed plugin with that id stays replaced.
- Safe mode (`--safe-mode`) skips them, like other external plugins.
- The frontend is imported from the folder itself. The backend loads a copy that Queryeer makes on every backend start, under `dev-plugin-copies` in Queryeer's app-data folder. The JVM keeps the jars it loaded open, and on Windows that locks them; because it loads copies, your build can overwrite the folder while Queryeer runs. Linked files are copied as files.

**Restart Backend and Reload** (command `core.backend.restartAndReload`; Tools → Dev → Restart Backend and Reload, the command palette, or the status bar item shown while developer plugin folders are set) stops the backend, applies pending JDBC driver changes, copies the developer folders again, starts the backend, and then reloads the window. Plugin discovery runs again on both sides, so a plugin's frontend and backend come from the same build. It is refused while queries run, with a notification saying so.

In dev mode (`npm run dev` in core), Vite watches the modules it serves, so rebuilding a frontend can reload the window by itself before you restart the backend. Run **Restart Backend and Reload** after a rebuild that touched the backend.

| Change | How to pick it up |
|---|---|
| Frontend only | Rebuild, then **Reload Window** |
| Backend, or both | Rebuild, then **Restart Backend and Reload** |
| `plugin.json` | **Restart Backend and Reload** |
| The list of folders in `QUERYEER_DEV_PLUGINS` | Restart Queryeer |

### 8.5 Testing Patterns

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
    "@queryeer/api": "^0.20.0"
  },
  "devDependencies": {
    "@queryeer/api": "^0.20.0",
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

The Plugin Manager shows installed external plugin metadata and supports local ZIP installation, enable/disable, and uninstall. Changes that affect loaded code are applied after restart. Backend activation status is also available through the `backend.runtimeStatus` notification.

### 10.5 Hot-Reload

External plugins are loaded when the window loads (frontend) and when the backend starts (backend). Nothing watches their files: after a rebuild, run **Reload Window** or **Restart Backend and Reload** (§8.4).

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

## 11. Upgrading Plugins to 0.20.0

0.20.0 changes the plugin API in ways that can break a plugin built for 0.19. Check each item against your plugin.

### 11.1 Subscriptions return a `Disposable`, not a function

These used to return an unsubscribe function and now return a `Disposable`:

- `files.subscribe`
- `fileMediator.onActiveFileChanged`
- `notifications.subscribe`
- `jdbcDrivers.subscribe`
- `settings.subscribe`
- `assistant.registerContextContribution` and `assistant.registerToolContribution`

Code that calls the result as a function now throws `TypeError: ... is not a function`. Call `dispose()` instead:

```ts
// 0.19
const unsubscribe = context.files.subscribe(listener);
unsubscribe();

// 0.20
const subscription = context.files.subscribe(listener);
subscription.dispose();
```

Every other `register*` and `on*` on `PluginContext` now returns a `Disposable` too. They used to return nothing, so existing code keeps working.

### 11.2 A plugin's identity comes only from `plugin.json`

An external plugin's `id`, `name`, `version` and `description` are read from `plugin.json`. The same fields in the frontend module's `manifest` are ignored; a plugin that still sets them loads, with a warning in the console when they differ from `plugin.json`.

- Type the module as `ExternalPluginModule` (§4.4) and leave the identity out of its manifest.
- Read the identity from `context.plugin` in `activate` instead of repeating it, e.g. for a settings `moduleId`.
- If your module's `id` differed from `plugin.json`'s, anything keyed by the module's id (settings, `activeFile.metadata.<id>`) now uses `plugin.json`'s id.

### 11.3 Backend: the JDBC foundation and the SQL parser come from `queryengine.jdbc`

The built-in plugins `queryengine.runtime.jdbc-foundation` and `queryengine.runtime.sql-parser` are gone, and their classes are no longer on the shared class path. `queryengine.jdbc` exports them instead (§3.3.1):

- A backend plugin that uses `com.queryeer.backend.queryengine.jdbc.` or `com.queryeer.backend.queryengine.sql.parser.` classes must declare a dependency on `queryengine.jdbc`, e.g. `{ "id": "queryengine.jdbc", "version": "^0.20.0" }`. Without it, loading those classes fails with an error that names the plugin to depend on.
- A plugin that lists one of the removed ids as a dependency is skipped ("Missing dependency").
- Compile against the foundation and the parser with `provided` scope; don't bundle them.
- tree-sitter is no longer shared. The parser's API takes SQL text, not parse trees.

### 11.4 Stricter `plugin.json` validation in the backend

`dependencies` entries are either an id or `{ "id", "version" }` with an npm SemVer range (§3.3). The backend refuses a manifest with:

- the same dependency listed twice
- an object entry without an `id`
- a version range it can't parse
- an invalid `backend.exports` entry (§3.3.1)

A refused plugin is skipped, and the others still load. It is logged as an error and listed as failed, with the reason, in Observability (click the backend status in the status bar). A plugin is also skipped now when one of its dependencies was skipped, or when it is in a dependency cycle (including depending on itself).

### 11.5 JDBC drivers contributed by a plugin

A plugin's managed driver (`context.jdbcDrivers.registerDriver`, §7.12) is installed only after the user approves it. The host asks before the first install, and again when the plugin changes what it declares. A native companion's archive entry template must contain `{releaseVersion}`, and a driver class that another contribution already declares is refused.

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
