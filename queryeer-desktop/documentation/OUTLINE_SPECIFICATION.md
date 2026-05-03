# Outline Extension Specification

## 1. Overview

Add a `core.outline` extension that provides a **secondary sidebar panel** showing a hierarchical outline of the active file's structure.

- **Visible only when** the active file's MIME type has a registered outline provider (`when: "outlineSupported"`).
- **Click-to-navigate**: clicking a symbol moves the caret to that position in the active editor.
- **Extensible**: editors register outline support via a new `OutlineRegistry` extension point in `PluginContext`.
- **Custom providers**: ships Regex/fallback parsers for JSON, XML, YAML, and SQL.
- **Supplementary providers**: additional providers can be stacked alongside the main provider per MIME type, merging results (e.g., custom pattern extraction).
- **Error nodes**: invalid content produces a parse-error symbol pointing to the failure location.

### Phase 1 (this spec)

- Outline view, store, providers, registry, context key, all wiring.
- Supplementary provider mechanism for stacking additional outline sources.
- Custom pattern provider that reads `@outline-pattern` directives from the first 20 lines.

### Phase 2 (deferred)

- Monaco `DocumentSymbolProvider` bridge (breadcrumb bar integration).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────┐
│  OutlineRegistry (contract)                      │
│  registerOutlineProvider(mimeType, provider)      │
│  registerSupplementaryOutlineProvider(mimeType,  │
│      provider)                                   │
│  hasProvider(mimeType) → boolean                  │
│  getProvider(mimeType)                            │
│  getSymbols(mimeType, content)                    │
│     → runs main provider + all supplementary      │
│     → merges results (dedup by id)               │
└───────────────┬──────────────────────────────────┘
                │
       ┌────────┴──────────────────┐
       ▼                           ▼
   core.outline               (future editors
   registers JSON,             or plugins
   XML, YAML, SQL              registering
   as main providers;          their own)
   custom-pattern as
   supplementary)
```

**Visibility flow**

```
ShellApp computes viewContext
  → outlineSupported = outlineRegistry.hasProvider(activeFileMimeType)
  → LayoutViewContribution when: "outlineSupported"
  → sidebar filter hides/shows the panel
```

**Reactivity flow**

```
Active file changes (FileMediator.onActiveFileChanged)
  → OutlineStore.clear() + OutlineView fetches new symbols

File content changes (TextEditorApi.onDidChangeModelContent)
  → OutlineView recomputes symbols (debounced 300 ms)
  → OutlineStore.setSymbols() → emit → re-render
```

**Navigation flow**

```
User clicks outline symbol
  → OutlineStore.setSelectedSymbolId(id)
  → TextEditorApi.setPosition(symbol.selectionRange.start)
  → TextEditorApi.revealPositionInCenter(position)
```

---

## 3. New Contract Types

### 3.1 `src/contracts/extensions/OutlineExtension.ts` (NEW)

```ts
import type { TextRange } from "../editor/EditorApi";

export type SymbolKind =
  | "File"
  | "Module"
  | "Namespace"
  | "Package"
  | "Class"
  | "Method"
  | "Property"
  | "Field"
  | "Constructor"
  | "Enum"
  | "Interface"
  | "Function"
  | "Variable"
  | "Constant"
  | "String"
  | "Number"
  | "Boolean"
  | "Array"
  | "Object"
  | "Key"
  | "Null"
  | "EnumMember"
  | "Struct"
  | "Event"
  | "Operator"
  | "TypeParameter";

export type OutlineSymbol = {
  id: string;
  name: string;
  detail?: string;
  kind: SymbolKind;
  tags?: string[];
  range: TextRange;
  selectionRange: TextRange;
  children?: OutlineSymbol[];
};

export type OutlineProvider = (
  content: string
) => OutlineSymbol[] | Promise<OutlineSymbol[]>;

export type OutlineProviderRegistration = {
  mimeType: string;
  provider: OutlineProvider;
};

export type OutlineRegistry = {
  /** Register the main outline provider for a MIME type. Overwrites any existing main provider. */
  registerOutlineProvider: (registration: OutlineProviderRegistration) => void;
  /** Register a supplementary provider that runs after the main provider for the same MIME type. Multiple supplementary providers are allowed per MIME type and run in registration order. */
  registerSupplementaryOutlineProvider: (registration: OutlineProviderRegistration) => void;
  hasProvider: (mimeType: string) => boolean;
  getProvider: (mimeType: string) => OutlineProvider | undefined;
  getSymbols: (mimeType: string, content: string) => Promise<OutlineSymbol[]>;
};
```

Design decisions:

- **Keyed by MIME type** (not Monaco language ID) — consistent with `FilesRegistry.capabilities`.
- **`OutlineSymbol.id`** uses stable path-based identifiers (e.g., `"json:database.users:5"`).
- **`OutlineProvider`** is a plain function — consistent with the project's type-only contract pattern.
- **`getSymbols`** is async to support future async providers.
- **Supplementary providers** allow multiple outline sources per MIME type. The main provider produces the base symbol tree; supplementary providers add extra symbols that are merged in. Deduplication is by `OutlineSymbol.id` — if a supplementary provider produces a symbol with the same `id` as one from the main provider, the supplementary one is discarded (main takes precedence).

---

## 4. New Files

### 4.1 `src/plugins/core.outline/module.ts`

```ts
import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreOutlinePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreOutlinePlugin.manifest,
  plugin: coreOutlinePlugin
};
```

### 4.2 `src/plugins/core.outline/plugin.tsx`

**Manifest:**

```ts
{
  id: "core.outline",
  name: "Core Outline",
  version: "0.1.0",
  kind: "core",
  providesCapabilities: ["outline.view"]
}
```

**`activate(context)`:**

1. Register outline providers for JSON, XML, YAML, SQL on `context.outline`.
2. Register the custom pattern supplementary provider for all text MIME types.
3. Register the sidebar view on `context.layout`.
3. Register the `core.outline.goToSymbol` command.
4. Create and wire up the `OutlineStore`.

**View contribution:**

```ts
{
  id: "core.outline.view",
  title: "Outline",
  defaultZone: "secondarySidebar",
  order: 10,
  canMoveZones: false,
  canCollapse: true,
  isOpen: false,
  when: "outlineSupported",
  render: () => <OutlineView store={store} ... />
}
```

### 4.3 `src/plugins/core.outline/OutlineView.tsx`

**Props:**

```ts
type OutlineViewProps = {
  store: OutlineStore;
  fileMediator: FileMediator;
  outlineRegistry: OutlineRegistry;
};
```

**Behaviour:**

- Subscribe to `store` and `fileMediator.onActiveFileChanged`.
- On active file change: clear store, get content from active editor, call `outlineRegistry.getSymbols(mimeType, content)`, store result.
- On content change (debounced 300 ms): re-fetch content, re-run `getSymbols`, update store.
- On symbol click: `store.setSelectedSymbolId(symbol.id)` then `editor.setPosition(pos)` + `editor.revealPositionInCenter(pos)`.
- No provider for active MIME type: return `null`.
- Empty content: render `.outline-empty` with "No symbols in file".
- Parse error: render a single error symbol node.

**Tree rendering** (recursive `OutlineSymbolNode`, mirrors `FolderTreeItem` pattern):

```
<div class="outline-symbol" [class is-selected]>
  <span class="outline-chevron">▶/▼</span>   <!-- only if children -->
  <span class="outline-symbol-kind">K</span>  <!-- kind badge -->
  <span class="outline-symbol-name">name</span>
  <span class="outline-symbol-detail">detail</span>
</div>
{isExpanded && children && (
  <div class="outline-children">
    {children.map(child => <OutlineSymbolNode ... />)}
  </div>
)}
```

### 4.4 `src/plugins/core.outline/OutlineStore.ts`

```ts
type OutlineStoreState = {
  symbols: OutlineSymbol[];
  selectedSymbolId: string | null;
  expandedSymbolIds: Set<string>;
  activeFileId: string | null;
  activeMimeType: string | null;
  isLoading: boolean;
  error: string | null;
};

class OutlineStore {
  getState(): OutlineStoreState;
  subscribe(listener: () => void): () => void;
  setSymbols(symbols: OutlineSymbol[]): void;
  setSelectedSymbolId(id: string | null): void;
  toggleExpanded(symbolId: string): void;
  setActiveFile(fileId: string | null, mimeType: string | null): void;
  setError(message: string | null): void;
  clear(): void;
}
```

Singleton: `getOutlineStore()` / `createOutlineStore()`.

### 4.5 `src/plugins/core.outline/outline.css`

| Class | Purpose |
|---|---|
| `.outline-view` | Flex column container, full height |
| `.outline-tree` | Scrollable tree area, `overflow: auto` |
| `.outline-symbol` | Tree item row, `display: flex`, `align-items: center`, `padding: 2px 8px`, `cursor: pointer` |
| `.outline-symbol:hover` | `background: var(--titlebar-hover)` |
| `.outline-symbol.is-selected` | `background: rgba(0, 120, 215, 0.25)` |
| `.outline-symbol-kind` | Small fixed-width badge for SymbolKind |
| `.outline-symbol-name` | `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1` |
| `.outline-symbol-detail` | `color: var(--text-1); margin-left: 4px; font-size: smaller` |
| `.outline-children` | `padding-left: 16px` |
| `.outline-chevron` | `width: 16px; font-size: 10px; transition: transform 0.1s` |
| `.outline-chevron.expanded` | `transform: rotate(90deg)` |
| `.outline-empty` | `padding: 16px; text-align: center; color: var(--text-1)` |
| `.outline-symbol.parse-error` | `color: var(--error, #f44747)` |

### 4.6 Outline Providers

All providers follow the `OutlineProvider` signature:

```ts
(content: string) => OutlineSymbol[]
```

On parse failure, providers return a single error node:

```ts
[{
  id: "{format}:error:{line}",
  name: "Parse Error",
  detail: "Unexpected token at line 5, column 12",
  kind: "Event",
  range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 1 },
  selectionRange: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 1 }
}]
```

#### 4.6.1 `src/plugins/core.outline/providers/json-outline-provider.ts`

Parses JSON content and produces an OutlineSymbol tree.

**Algorithm:**

1. Delegate to `JSON.parse()` for the AST.
2. On parse failure, extract line/column from `SyntaxError.message` and return an error node.
3. Walk the result recursively:
   - **Object keys** → `SymbolKind.Key`, `selectionRange` covers just the key name, `range` covers key + value.
   - **Nested objects** → `SymbolKind.Object` as children.
   - **Arrays** → `SymbolKind.Array`, children named `[0]`, `[1]`, etc.
   - **Primitive values** → appropriate kind (`"String"`, `"Number"`, `"Boolean"`, `"Null"`), no children.
4. Line/column tracking: map character offsets to line/column using a line-map computed from the original content.

**ID format:** `"json:{dotPath}:{startLineNumber}"`

**Examples:**

- Root key `database` → `id: "json:database:3"`
- Nested key `database.users` → `id: "json:database.users:7"`
- Array item `[0]` → `id: "json:servers.0:12"`

#### 4.6.2 `src/plugins/core.outline/providers/xml-outline-provider.ts`

Regex-based line-by-line XML parser.

**Algorithm:**

1. Process input line by line.
2. Match patterns using regex:
   - Opening tag: `<tagname(\s[^>]*)?>`
   - Closing tag: `</tagname>`
   - Self-closing tag: `<tagname(\s[^/]*)?/>`
   - Comment: `<!-- ... -->`
   - Processing instruction: `<? ... ?>`
3. Maintain a tag stack for nesting: push on open, pop on close.
4. Each element → `OutlineSymbol` with:
   - `kind: "Class"` (elements are structural in XML)
   - `range`: opening tag line to closing tag line
   - `selectionRange`: just the tag name (after `<`)
   - `detail`: concatenation of attributes
   - `children`: nested elements
5. On malformed XML (e.g., unclosed tag at EOF), return an error node.

**ID format:** `"xml:{depth}:{startLine}:{tagname}"`

**Example:**

```xml
<database>           → id: "xml:0:1:database", kind: Class
  <users>            → id: "xml:1:3:users",    kind: Class
    <user id="1"/>   → id: "xml:2:4:user",     kind: Class, detail: 'id="1"'
  </users>
</database>
```

#### 4.6.3 `src/plugins/core.outline/providers/yaml-outline-provider.ts`

Line-based YAML parser using indentation tracking.

**Algorithm:**

1. Process input line by line.
2. Match patterns:
   - Mapping key: `^(\s*)([\w][\w -]*)\s*:(?:\s|$)`
   - Sequence item: `^(\s*)- `
   - Document marker: `^---` or `^\.\.\.`
   - Comment lines: `^\s*#` (skipped in tree, not shown)
3. Track indentation level (detect from first indented line).
4. For each mapping key → `SymbolKind.Key`:
   - `selectionRange`: just the key name
   - `range`: from key line to just before the next sibling at the same or lower indent
   - `children`: nested keys/sequences
5. Sequence items → `SymbolKind.Array`, children named by index.
6. Document markers (`---`) → `SymbolKind.Module`.
7. On ambiguous indentation (inconsistent spaces), return an error node.

**ID format:** `"yaml:{indent}:{startLine}:{key}"`

**Example:**

```yaml
database:            → id: "yaml:0:1:database", kind: Key
  host: localhost     → id: "yaml:1:2:host",    kind: Key
  port: 5432          → id: "yaml:1:3:port",    kind: Key
  users:              → id: "yaml:1:4:users",   kind: Key
    - admin           → id: "yaml:2:5:0",       kind: Array
```

#### 4.6.4 `src/plugins/core.outline/providers/sql-outline-provider.ts`

Regex-based SQL statement parser.

**Algorithm:**

1. Process input (multi-line aware for statement detection).
2. Match statement-level patterns (case-insensitive):
   - `CREATE TABLE (\w+)` → `SymbolKind.Class`, name = table name, detail = "TABLE"
   - `CREATE VIEW (\w+)` → `SymbolKind.Interface`, name = view name, detail = "VIEW"
   - `CREATE INDEX (\w+)` → `SymbolKind.Property`, name = index name, detail = "INDEX"
   - `CREATE FUNCTION (\w+)` → `SymbolKind.Function`, name = function name, detail = "FUNCTION"
   - `CREATE PROCEDURE (\w+)` → `SymbolKind.Function`, name = procedure name, detail = "PROCEDURE"
   - `CREATE TRIGGER (\w+)` → `SymbolKind.Event`, name = trigger name, detail = "TRIGGER"
   - `SELECT ...` → `SymbolKind.Method`, name = "SELECT"
   - `INSERT INTO (\w+)` → `SymbolKind.Method`, name = "INSERT INTO table"
   - `UPDATE (\w+)` → `SymbolKind.Method`, name = "UPDATE table"
   - `DELETE FROM (\w+)` → `SymbolKind.Method`, name = "DELETE FROM table"
   - `WITH (\w+) AS` → `SymbolKind.Namespace`, name = CTE name, detail = "CTE"
3. `range`: from start of statement keyword to end of statement (`;` or next recognized keyword).
4. `selectionRange`: just the identifier name.
5. Nested structures:
   - CTE names (`WITH ... AS`) become parent nodes containing the subsequent `SELECT`/`INSERT` as children.
   - `BEGIN`/`END` blocks within functions/procedures appear as children.
6. On unparseable content, return a single error node.

**ID format:** `"sql:{startLine}:{keyword}"`

**Example:**

```sql
CREATE TABLE users (     → id: "sql:1:CREATE",  kind: Class,    name: "users",    detail: "TABLE"
  id INT PRIMARY KEY,
  name TEXT
);

CREATE FUNCTION get_user(  → id: "sql:6:CREATE", kind: Function, name: "get_user", detail: "FUNCTION"
  p_id INT
) RETURNS TABLE AS $$
  SELECT * FROM users      → id: "sql:9:SELECT", kind: Method,   name: "SELECT"
  WHERE id = p_id;
$$ LANGUAGE sql;
```

#### 4.6.5 `src/plugins/core.outline/providers/custom-pattern-provider.ts`

Supplementary provider that reads `@outline-pattern` directives from the first 20 lines and applies them to the full document.

**Purpose**: Allows users to define custom outline patterns as comments in the top of any text file. The provider runs as a **supplementary** provider alongside the main MIME-type provider, injecting additional symbols into the outline without replacing the native parse.

**Directive format** (in the first 20 lines of the file):

```
// @outline-pattern: /PATTERN/FLAGS/  KIND  [DETAIL]
// @outline-pattern: /function\s+(\w+)/  Function  custom function
// @outline-pattern: /class\s+(\w+)/  Class
```

Or for non-JS comment syntax:

```
# @outline-pattern: /PATTERN/FLAGS/  KIND  [DETAIL]
<!-- @outline-pattern: /PATTERN/FLAGS/  KIND  [DETAIL] -->
-- @outline-pattern: /PATTERN/FLAGS/  KIND  [DETAIL]  (SQL)
```

**Algorithm**:

1. Read the first 20 lines of `content`.
2. For each line, scan for the pattern `@outline-pattern:\s*/(.+)/([gimsuy]*)\s+(\w+)(?:\s+(.+))?$/`:
   - Group 1: regex pattern
   - Group 2: regex flags (e.g., `i` for case-insensitive)
   - Group 3: `SymbolKind` string (must match one of the `SymbolKind` union values)
   - Group 4 (optional): detail string
3. Collect all parsed directives.
4. If no directives found, return `[]` (no custom symbols for this file).
5. For each directive, apply the compiled `RegExp` to the **full** document content.
6. For each match:
   - `kind`: the `SymbolKind` from the directive
   - `name`: the first capture group if it exists, otherwise the full match
   - `detail`: the detail string from the directive (if provided)
   - `range`: the full match span (start line/column to end line/column)
   - `selectionRange`: the first capture group span if it exists, otherwise same as `range`
   - `id`: `"custom:{line}:{patternIndex}"` (stable across re-parses)
7. Return all match-derived `OutlineSymbol[]` as a flat list (no children).

**Key behaviors**:

- Custom pattern symbols are **flat** — they do not nest. They are merged at the root level alongside main provider symbols.
- If a custom pattern symbol has the same `id` as a main provider symbol, the main provider's symbol takes precedence (custom symbols are dedup-merged with `Array.filter`).
- Multiple directives in the same file are additive.
- Invalid regex patterns or unknown `SymbolKind` values are silently skipped (no error node).
- The provider is registered as **supplementary** for all text MIME types (`text/*`, `application/json`, `application/xml`, `application/yaml`, `application/sql`, `application/plbsql`).

**Examples**:

```js
// File: my-module.js
// @outline-pattern: /function\s+(\w+)/g  Function  exported function
// @outline-pattern: /class\s+(\w+)/g  Class

function foo() {}    → custom:1:0, kind: Function, name: "foo", detail: "exported function"
function bar() {}    → custom:2:0, kind: Function, name: "bar", detail: "exported function"
class Baz {}         → custom:1:1, kind: Class, name: "Baz"
```

```sql
-- File: queries.sql
-- @outline-pattern: /--\s*SECTION:\s*(.+)/g  Namespace

-- SECTION: User queries
SELECT * FROM users;  → custom:1:0, kind: Namespace, name: "User queries"
```

#### 4.6.6 `src/plugins/core.outline/providers/index.ts`

```ts
export { jsonOutlineProvider } from "./json-outline-provider";
export { xmlOutlineProvider } from "./xml-outline-provider";
export { yamlOutlineProvider } from "./yaml-outline-provider";
export { sqlOutlineProvider } from "./sql-outline-provider";
export { customPatternProvider } from "./custom-pattern-provider";
```

Registration in `plugin.tsx`:

```ts
context.outline.registerOutlineProvider({ mimeType: "application/json", provider: jsonOutlineProvider });
context.outline.registerOutlineProvider({ mimeType: "application/xml", provider: xmlOutlineProvider });
context.outline.registerOutlineProvider({ mimeType: "application/yaml", provider: yamlOutlineProvider });
context.outline.registerOutlineProvider({ mimeType: "application/sql", provider: sqlOutlineProvider });
context.outline.registerOutlineProvider({ mimeType: "application/plbsql", provider: sqlOutlineProvider });

// Custom pattern provider runs alongside the main provider for all text MIME types
const textMimeTypes = [
  "application/json", "application/xml", "application/yaml",
  "application/sql", "application/plbsql",
  "text/plain", "text/html", "text/css", "text/javascript", "text/typescript",
  "text/csv", "text/markdown"
];
for (const mimeType of textMimeTypes) {
  context.outline.registerSupplementaryOutlineProvider({ mimeType, provider: customPatternProvider });
}
```

---

## 5. Modified Files

### 5.1 `src/contracts/plugin/Plugin.ts`

**Change**: Add `outline: OutlineRegistry` to `PluginContext`.

```ts
import type { OutlineRegistry } from "../extensions/OutlineExtension";

export type PluginContext = {
  commands: CommandRegistry;
  filesystems: FileSystemRegistry;
  files: FilesRegistry;
  fileState: FileStateRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  layout: LayoutRegistry;
  menu: MenuRegistry;
  keybindings: KeybindingRegistry;
  dialog: DialogRegistry;
  tooltip: TooltipRegistry;
  settings: SettingsRegistry;
  quickcommand: QuickCommandRegistry;
  outline: OutlineRegistry;  // ← NEW
};
```

### 5.2 `src/core/plugin-runtime/ExtensionRegistry.ts`

**Change**: Add outline registry storage and `createOutlineRegistry()` factory method.

- Add `private outlineProviders: Map<string, OutlineProviderRegistration>` (main providers)
- Add `private supplementaryOutlineProviders: Map<string, OutlineProviderRegistration[]>` (supplementary providers, ordered list per MIME type)
- Add `createOutlineRegistry(): OutlineRegistry` — returns a facade:
  - `registerOutlineProvider()` → writes to main map, warns on overwrite
  - `registerSupplementaryOutlineProvider()` → appends to supplementary list for the MIME type
  - `hasProvider()` → checks main map
  - `getProvider()` → reads from main map
  - `getSymbols()` → runs main provider, then all supplementary providers in order, merges with dedup by `OutlineSymbol.id`
- Add `outline` section to `ExtensionSnapshot`

### 5.3 `src/core/plugin-runtime/PluginHost.ts`

**Change**: Wire `outline` registry into plugin context.

```ts
const context: PluginContext = {
  // ... existing fields ...
  outline: this.extensionRegistry.createOutlineRegistry(),
};
```

### 5.4 `src/renderer/shell/ShellApp.tsx`

**Change**: Add `outlineSupported` to view context computation.

```ts
const outlineSupported = activeFileForViewContext
  ? getOutlineRegistry().hasProvider(activeFileForViewContext.mimeType)
  : false;

return {
  hasOpenFiles: openFileIds.length > 0,
  hasActiveFile: activeFileForViewContext != null,
  activeFileMimeType: activeFileForViewContext?.mimeType,
  activeFileEditorId: activeFileForViewContext?.editorId,
  hasActiveQueryExecutableFile,
  outlineSupported  // ← NEW
};
```

`getOutlineRegistry()` is a module-level singleton accessor (like `getTextEditorRegistry()`). It is populated during plugin activation before ShellApp mounts, so no initialization ordering issue.

The memo dependency array remains the same — `activeFileMimeType` changes already trigger re-computation.

---

## 6. OutlineRegistry Implementation Details

```ts
createOutlineRegistry(): OutlineRegistry {
  const providers = this.outlineProviders;           // Map<string, OutlineProviderRegistration>
  const supplementary = this.supplementaryOutlineProviders;  // Map<string, OutlineProviderRegistration[]>

  const runProvider = async (
    provider: OutlineProvider,
    content: string
  ): Promise<OutlineSymbol[]> => {
    const result = provider(content);
    return Array.isArray(result) ? result : await result;
  };

  return {
    registerOutlineProvider: (registration) => {
      if (providers.has(registration.mimeType)) {
        console.warn(
          `Outline provider for '${registration.mimeType}' already registered; overwriting.`
        );
      }
      providers.set(registration.mimeType, registration);
    },

    registerSupplementaryOutlineProvider: (registration) => {
      const list = supplementary.get(registration.mimeType) ?? [];
      list.push(registration);
      supplementary.set(registration.mimeType, list);
    },

    hasProvider: (mimeType: string) => providers.has(mimeType),

    getProvider: (mimeType: string) => providers.get(mimeType)?.provider,

    getSymbols: async (mimeType: string, content: string) => {
      // 1. Run main provider
      const mainResult = providers.has(mimeType)
        ? await runProvider(providers.get(mimeType)!.provider, content).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            return [{
              id: `${mimeType}:error:0`,
              name: "Parse Error",
              detail: message,
              kind: "Event" as SymbolKind,
              range: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 },
              selectionRange: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 }
            }];
          })
        : [];

      // 2. Run supplementary providers
      const supps = supplementary.get(mimeType) ?? [];
      const suppResults: OutlineSymbol[] = [];
      for (const reg of supps) {
        try {
          const result = await runProvider(reg.provider, content);
          suppResults.push(...result);
        } catch {
          // Supplementary provider failures are silently ignored
          // (main provider errors are shown; supplementary errors are not)
        }
      }

      // 3. Merge: main symbols first, then supplementary symbols that don't collide on id
      const mainIds = new Set(mainResult.map((s: OutlineSymbol) => s.id));
      const merged = [
        ...mainResult,
        ...suppResults.filter((s: OutlineSymbol) => !mainIds.has(s.id))
      ];

      return merged;
    }
  };
}
```

### Merge semantics

- **Main provider symbols always win** on `id` collisions.
- **Supplementary provider symbols are appended** after main symbols, filtered by dedup on `id`.
- **Supplementary provider errors are silently discarded** — they should never break the outline view. Only the main provider's error node is shown.
- If no main provider exists for a MIME type but supplementary providers do exist, `hasProvider()` returns `false`. The `when: "outlineSupported"` context key requires a main provider. This means custom patterns alone (without a structural parser) **do not** enable the outline panel — they only augment an existing structural provider.

**Why this design?** Custom pattern directives are meant to overlay structural knowledge on top of an existing parser, not to replace it. If a user wants outline purely from custom patterns (e.g., in plain text files), a future enhancement could add a `registerOutlineProvider` for `text/plain` that delegates to the custom pattern logic.

---

## 7. OutlineView — Component Specification

### React component tree

```
OutlineView
  ├── (loading indicator when isLoading)
  ├── (empty state when symbols.length === 0 and no error)
  ├── (error state when error !== null)
  └── OutlineSymbolNode (recursive)
        ├── outline-symbol (row)
        │     ├── outline-chevron (▶/▼ if has children)
        │     ├── outline-symbol-kind (badge)
        │     ├── outline-symbol-name
        │     └── outline-symbol-detail
        └── outline-children (if expanded)
              └── OutlineSymbolNode (for each child)
```

### Subscriptions and effects

```tsx
// On mount: subscribe to store and file mediator
useEffect(() => {
  const unsub = store.subscribe(() => forceUpdate());
  const unsubFile = fileMediator.onActiveFileChanged(handleFileChange);
  return () => { unsub(); unsubFile(); };
}, []);

// On active file change: load outline
const handleFileChange = async (fileId: string | null) => {
  store.clear();
  if (!fileId) return;
  const file = filesRegistry.getFile(fileId);
  if (!file) return;
  store.setActiveFile(fileId, file.mimeType);
  if (!outlineRegistry.hasProvider(file.mimeType)) return;
  const editor = getTextEditorRegistry().getActiveEditor();
  const content = editor?.getContent() ?? "";
  store.setSymbols(await outlineRegistry.getSymbols(file.mimeType, content));
};

// On content change: recompute outline (debounced)
useEffect(() => {
  const editor = getTextEditorRegistry().getActiveEditor();
  if (!editor) return;
  const disposable = editor.onDidChangeModelContent(debounce(async () => {
    const content = editor.getContent();
    const mimeType = store.getState().activeMimeType;
    if (!mimeType) return;
    store.setSymbols(await outlineRegistry.getSymbols(mimeType, content));
  }, 300));
  return () => disposable.dispose();
}, [activeFileId]);
```

### Symbol click handler

```ts
const handleSymbolClick = (symbol: OutlineSymbol) => {
  store.setSelectedSymbolId(symbol.id);
  const editor = getTextEditorRegistry().getActiveEditor();
  if (!editor) return;
  editor.setPosition({
    lineNumber: symbol.selectionRange.startLineNumber,
    column: symbol.selectionRange.startColumn
  });
  editor.revealPositionInCenter({
    lineNumber: symbol.selectionRange.startLineNumber,
    column: symbol.selectionRange.startColumn
  });
};
```

---

## 8. Testing Plan

| File | Test Type | Description |
|---|---|---|
| `src/contracts/extensions/OutlineExtension.ts` | Type check | Verify types compile and are consistent with `EditorApi.TextRange` |
| `src/plugins/core.outline/providers/json-outline-provider.ts` | Unit | Valid JSON (flat, nested, arrays), invalid JSON (error node), empty input |
| `src/plugins/core.outline/providers/xml-outline-provider.ts` | Unit | Nested elements, self-closing tags, attributes, malformed XML (error node) |
| `src/plugins/core.outline/providers/yaml-outline-provider.ts` | Unit | Mappings, sequences, document markers, inconsistent indentation (error node) |
| `src/plugins/core.outline/providers/sql-outline-provider.ts` | Unit | CREATE TABLE/FUNCTION/PROCEDURE, SELECT, CTEs, multi-statement files |
| `src/plugins/core.outline/providers/custom-pattern-provider.ts` | Unit | Pattern directive parsing, regex matching, multiple directives, invalid regex, unknown SymbolKind, no directives, dedup with main provider |
| `src/plugins/core.outline/OutlineStore.ts` | Unit | Store lifecycle, setSymbols, setSelectedSymbolId, toggleExpanded, clear |
| `src/core/plugin-runtime/OutlineRegistry.test.ts` | Unit | registerOutlineProvider, registerSupplementaryOutlineProvider, hasProvider, getProvider, getSymbols (sync/async), merge with dedup, supplementary error handling, overwrite warning |
| `src/plugins/core.outline/OutlineView.tsx` | Integration | Render tree, symbol click navigation, empty state, error state |

Test file naming: co-located `{filename}.test.ts` / `{filename}.test.tsx`.

### Provider test pattern

Each provider test follows:

```ts
describe("jsonOutlineProvider", () => {
  it("returns symbols for flat object", () => { ... });
  it("returns symbols for nested objects", () => { ... });
  it("returns symbols for arrays", () => { ... });
  it("returns symbols for mixed content", () => { ... });
  it("returns error node for invalid JSON", () => { ... });
  it("returns empty array for empty string", () => { ... });
  it("generates stable path-based IDs", () => { ... });
  it("computes correct ranges and selectionRanges", () => { ... });
});

describe("customPatternProvider", () => {
  it("returns symbols for single @outline-pattern directive", () => { ... });
  it("returns symbols for multiple directives", () => { ... });
  it("uses first capture group as name when available", () => { ... });
  it("uses full match as name when no capture group", () => { ... });
  it("respects regex flags (case-insensitive, global)", () => { ... });
  it("skips invalid regex patterns silently", () => { ... });
  it("skips unknown SymbolKind values silently", () => { ... });
  it("returns empty array when no directives in first 20 lines", () => { ... });
  it("ignores directives after line 20", () => { ... });
  it("handles comment-style directives (//, #, --, <!--)", () => { ... });
});

describe("OutlineRegistry merge behavior", () => {
  it("merges supplementary symbols after main symbols", () => { ... });
  it("deduplicates by id (main provider wins)", () => { ... });
  it("silently discards supplementary provider errors", () => { ... });
  it("shows main provider error node on failure", () => { ... });
  it("returns empty array for MIME type with no providers", () => { ... });
});
```

---

## 9. Implementation Order

| Step | Description | Files |
|---|---|---|
| 1 | Contract types | `src/contracts/extensions/OutlineExtension.ts` |
| 2 | PluginContext update | `src/contracts/plugin/Plugin.ts` |
| 3 | OutlineRegistry implementation | `src/core/plugin-runtime/ExtensionRegistry.ts` |
| 4 | PluginHost wiring | `src/core/plugin-runtime/PluginHost.ts` |
| 5 | ShellApp view context | `src/renderer/shell/ShellApp.tsx` |
| 6 | OutlineStore | `src/plugins/core.outline/OutlineStore.ts` + tests |
| 7 | JSON outline provider | `src/plugins/core.outline/providers/json-outline-provider.ts` + tests |
| 8 | XML outline provider | `src/plugins/core.outline/providers/xml-outline-provider.ts` + tests |
| 9 | YAML outline provider | `src/plugins/core.outline/providers/yaml-outline-provider.ts` + tests |
| 10 | SQL outline provider | `src/plugins/core.outline/providers/sql-outline-provider.ts` + tests |
| 11 | Custom pattern provider | `src/plugins/core.outline/providers/custom-pattern-provider.ts` + tests |
| 12 | Provider barrel | `src/plugins/core.outline/providers/index.ts` |
| 13 | OutlineView component | `src/plugins/core.outline/OutlineView.tsx` + tests |
| 14 | Plugin registration | `src/plugins/core.outline/plugin.tsx` |
| 15 | CSS | `src/plugins/core.outline/outline.css` |
| 16 | Module entry | `src/plugins/core.outline/module.ts` |
| 17 | Integration testing | End-to-end: open JSON file → see outline → click key → navigate |

---

## 10. New Files Summary

| File | Purpose |
|---|---|
| `src/contracts/extensions/OutlineExtension.ts` | OutlineRegistry contract, OutlineSymbol, OutlineProvider types |
| `src/plugins/core.outline/module.ts` | Plugin module entry |
| `src/plugins/core.outline/plugin.tsx` | Plugin activation, view/command registration |
| `src/plugins/core.outline/OutlineView.tsx` | React tree component |
| `src/plugins/core.outline/OutlineStore.ts` | State management singleton |
| `src/plugins/core.outline/outline.css` | Component styling |
| `src/plugins/core.outline/providers/json-outline-provider.ts` | JSON outline parser |
| `src/plugins/core.outline/providers/xml-outline-provider.ts` | XML outline parser |
| `src/plugins/core.outline/providers/yaml-outline-provider.ts` | YAML outline parser |
| `src/plugins/core.outline/providers/sql-outline-provider.ts` | SQL outline parser |
| `src/plugins/core.outline/providers/custom-pattern-provider.ts` | Custom `@outline-pattern` directive parser (supplementary) |
| `src/plugins/core.outline/providers/index.ts` | Barrel export |

## 11. Modified Files Summary

| File | Change |
|---|---|
| `src/contracts/plugin/Plugin.ts` | Add `outline: OutlineRegistry` to `PluginContext` |
| `src/core/plugin-runtime/ExtensionRegistry.ts` | Add outline registry storage + `createOutlineRegistry()` factory |
| `src/core/plugin-runtime/PluginHost.ts` | Wire `outline` registry into plugin context |
| `src/renderer/shell/ShellApp.tsx` | Add `outlineSupported` to view context computation |

## 12. No Backend Changes

This is a **frontend-only feature**. No backend contract changes are required. `BACKEND_PROTOCOL.md` does not need updating.

---

## 13. Phase 2 — Monaco DocumentSymbolProvider Bridge (Deferred)

When implemented, this will:

1. Add `src/plugins/core.outline/monaco-outline-bridge.ts` — bridges our OutlineProviders to Monaco's `DocumentSymbolProvider` API.
2. Register `monaco.languages.registerDocumentSymbolProvider(languageId, provider)` for each MIME type that has an OutlineProvider.
3. Map our `OutlineSymbol[]` to Monaco's `DocumentSymbol[]` (recursive mapping, kind conversion from string `SymbolKind` to Monaco's numeric `SymbolKind` enum).
4. Dispose Monaco registrations on plugin deactivation.
5. Call `registerMonacoOutlineProviders()` from `core.editor` plugin activation (after Monaco loads).

This enables Monaco's breadcrumb bar and built-in outline features to use our outline data.