import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { AssistantToolContribution, AssistantToolInvocation, AssistantToolResult } from "../../contracts/assistant/Assistant";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { JDBC_NAV_DB_KEY, type JdbcSchemaObject, type JdbcSelectedDatabase } from "./jdbc-navigation-types";

type JdbcAssistantContext = {
  connectionId: string;
  database?: string;
};

type JdbcObjectMatch = {
  name: string;
  fullName?: string;
  kind: string;
  database?: string;
  schema?: string;
};

type JdbcObjectDetail = JdbcObjectMatch & {
  columns: Array<{ name: string; type?: unknown; nullable?: unknown; attributes: Record<string, unknown> }>;
  primaryKeys: Array<{ name?: string; column?: unknown; attributes: Record<string, unknown> }>;
  foreignKeys: Array<{ name?: string; column?: unknown; referencesTable?: unknown; referencesColumn?: unknown; attributes: Record<string, unknown> }>;
  indices: Array<{ name: string; columns: Array<{ name: string; ordinal?: unknown; sortOrder?: unknown; attributes: Record<string, unknown> }>; attributes: Record<string, unknown> }>;
  properties: Array<{ name: string; kind: string; attributes: Record<string, unknown> }>;
};

export function createJdbcAssistantTools(context: PluginContext): AssistantToolContribution[] {
  return [
    {
      id: "core.queryengine.jdbc.searchObjects",
      title: "Search JDBC Tables and Views",
      description: "Search cached JDBC schema for tables and views using a glob pattern. Use this before writing SQL that references unknown table/view names. The active SQL file determines the JDBC connection and selected database. Pattern supports * and ? and matches object name, schema.name, and snapshot fullName.",
      order: 30,
      when: "activeFile.mimeType == 'application/sql'",
      inputSchema: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string" },
          limit: { type: "number" }
        }
      },
      invoke: (request) => searchJdbcObjects(context, request)
    },
    {
      id: "core.queryengine.jdbc.getObjectDetails",
      title: "Get JDBC Table or View Details",
      description: "Return cached columns, primary keys, foreign keys, indices, and other metadata for one JDBC table or view. Use a result from core.queryengine.jdbc.searchObjects when possible. The active SQL file determines the JDBC connection and selected database. This tool reads only cached deep schema snapshots and does not query the live database.",
      order: 31,
      when: "activeFile.mimeType == 'application/sql'",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          schema: { type: "string" }
        }
      },
      invoke: (request) => getJdbcObjectDetails(context, request)
    }
  ];
}

async function searchJdbcObjects(context: PluginContext, request: AssistantToolInvocation): Promise<AssistantToolResult> {
  const parsed = parseSearchInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const jdbcContext = resolveJdbcContext(context, request);
  if (!jdbcContext.ok) {
    return { ok: false, message: jdbcContext.message };
  }

  const snapshot = await loadDeepSnapshot(jdbcContext.value.connectionId);
  const matcher = globMatcher(parsed.value.pattern);
  const allMatches = collectObjects(snapshot)
    .filter((match) => matchesDatabase(match, jdbcContext.value.database))
    .filter((match) => matchSearch(match, matcher));
  const limit = parsed.value.limit ?? 50;
  return {
    ok: true,
    message: allMatches.length === 0
      ? "No cached JDBC tables or views matched. Refresh the JDBC schema cache if this is unexpected."
      : `Found ${allMatches.length} JDBC table/view match${allMatches.length === 1 ? "" : "es"}.`,
    data: {
      connectionId: jdbcContext.value.connectionId,
      database: jdbcContext.value.database,
      matches: allMatches.slice(0, limit),
      truncated: allMatches.length > limit,
      total: allMatches.length
    }
  };
}

async function getJdbcObjectDetails(context: PluginContext, request: AssistantToolInvocation): Promise<AssistantToolResult> {
  const parsed = parseDetailInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const jdbcContext = resolveJdbcContext(context, request);
  if (!jdbcContext.ok) {
    return { ok: false, message: jdbcContext.message };
  }

  const snapshot = await loadDeepSnapshot(jdbcContext.value.connectionId);
  const matches = collectObjects(snapshot)
    .filter((match) => matchesDatabase(match, jdbcContext.value.database))
    .filter((match) => matchesDetail(match, parsed.value.name, parsed.value.schema));
  if (matches.length === 0) {
    return { ok: false, message: "No cached JDBC table or view matched. Search objects first or refresh the JDBC schema cache." };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: "Multiple JDBC objects matched. Retry with schema or a fully-qualified name.",
      data: { matches: matches.map(({ object: _object, ...match }) => match) }
    };
  }

  const match = matches[0]!;
  const children = match.object.children ?? [];
  return {
    ok: true,
    message: children.length === 0
      ? `No cached JDBC child metadata found for ${match.fullName ?? match.name}. Refresh the deep JDBC schema cache if columns or indices are needed.`
      : `Fetched cached JDBC details for ${match.fullName ?? match.name}.`,
    data: toObjectDetail(match, children)
  };
}

export async function loadDeepSnapshot(connectionId: string): Promise<JdbcSchemaObject[]> {
  const result = await getQueryEngineService().invoke(
    { engineId: "jdbc", action: "jdbc.schema.snapshot", payload: { connectionId, scope: "deep" } },
    { silent: true }
  );
  return Array.isArray(result) ? result.filter(isJdbcSchemaObject) : [];
}

function resolveJdbcContext(
  context: PluginContext,
  request: AssistantToolInvocation
): { ok: true; value: JdbcAssistantContext } | { ok: false; message: string } {
  const fileId = request.activeFileId;
  if (!fileId) {
    return { ok: false, message: "No active JDBC file. Activate a SQL file with a JDBC connection." };
  }
  const file = context.files.getFile(fileId);
  const connectionId = file?.engineBinding?.engineId === "jdbc" ? file.engineBinding.connectionId : undefined;
  if (!connectionId) {
    return { ok: false, message: "The active SQL file is not bound to a JDBC connection." };
  }
  const selected = readSelectedDatabase(context, fileId, connectionId);
  return { ok: true, value: { connectionId, database: selected } };
}

function readSelectedDatabase(context: PluginContext, fileId: string, connectionId: string): string | undefined {
  const raw = context.files.getEditorState(fileId, JDBC_NAV_DB_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const selected = raw as Partial<JdbcSelectedDatabase>;
  return selected.connectionId === connectionId && typeof selected.database === "string" ? selected.database : undefined;
}

type SearchInput = { pattern: string; limit?: number };
type DetailInput = { name: string; schema?: string };

function parseSearchInput(input: unknown): { ok: true; value: SearchInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Tool input must be an object" };
  const record = input as Record<string, unknown>;
  if (typeof record.pattern !== "string" || !record.pattern.trim()) return { ok: false, message: "Tool input requires pattern" };
  if (record.limit !== undefined && (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1)) return { ok: false, message: "limit must be a positive integer" };
  return { ok: true, value: { pattern: record.pattern, ...(record.limit ? { limit: Math.min(record.limit, 200) } : {}) } };
}

function parseDetailInput(input: unknown): { ok: true; value: DetailInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Tool input must be an object" };
  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return { ok: false, message: "Tool input requires name" };
  if (record.schema !== undefined && typeof record.schema !== "string") return { ok: false, message: "schema must be a string" };
  return { ok: true, value: { name: record.name, ...(record.schema ? { schema: record.schema } : {}) } };
}

export function collectObjects(snapshot: JdbcSchemaObject[]): Array<JdbcObjectMatch & { object: JdbcSchemaObject }> {
  const result: Array<JdbcObjectMatch & { object: JdbcSchemaObject }> = [];
  visitObjects(snapshot, {}, result);
  return result;
}

function visitObjects(nodes: JdbcSchemaObject[], path: { database?: string; schema?: string }, result: Array<JdbcObjectMatch & { object: JdbcSchemaObject }>): void {
  for (const node of nodes) {
    const nextPath = {
      database: stringAttr(node.attributes.catalog) ?? (node.kind === "database" ? node.name : path.database),
      schema: stringAttr(node.attributes.schema) ?? (node.kind === "schema" ? node.name : path.schema)
    };
    if (node.kind === "table" || node.kind === "view") {
      result.push({ name: node.name, kind: node.kind, fullName: node.fullName, database: nextPath.database, schema: nextPath.schema, object: node });
    }
    if (node.children?.length) {
      visitObjects(node.children, nextPath, result);
    }
  }
}

export function toObjectDetail(match: JdbcObjectMatch & { object: JdbcSchemaObject }, children: JdbcSchemaObject[]): JdbcObjectDetail {
  const detailChildren = detailMetadataChildren(children);
  return {
    name: match.name,
    fullName: match.fullName,
    kind: match.kind,
    database: match.database,
    schema: match.schema,
    columns: detailChildren.filter((child) => child.kind === "column").map((child) => ({
      name: child.name,
      type: child.attributes.type,
      nullable: child.attributes.nullable,
      attributes: child.attributes
    })),
    primaryKeys: primaryKeysFromChildren(detailChildren),
    foreignKeys: foreignKeysFromChildren(detailChildren),
    indices: detailChildren.filter((child) => child.kind === "index").map((child) => ({
      name: child.name,
      columns: indexColumnsFromIndex(child),
      attributes: child.attributes
    })),
    properties: detailChildren.filter((child) => child.kind !== "column" && child.kind !== "primary_key" && child.kind !== "foreign_key" && child.kind !== "index").map((child) => ({
      name: child.name,
      kind: child.kind,
      attributes: child.attributes
    }))
  };
}

function detailMetadataChildren(children: JdbcSchemaObject[]): JdbcSchemaObject[] {
  const result: JdbcSchemaObject[] = [];
  for (const child of children) {
    if ((child.kind === "columns_folder" || child.kind === "indexes_folder") && child.children?.length) {
      result.push(...child.children);
      continue;
    }
    result.push(child);
  }
  return result;
}

function indexColumnsFromIndex(index: JdbcSchemaObject): Array<{ name: string; ordinal?: unknown; sortOrder?: unknown; attributes: Record<string, unknown> }> {
  return (index.children ?? [])
    .filter((child) => child.kind === "index_column")
    .map((child) => ({
      name: child.name,
      ordinal: child.attributes.ordinal,
      sortOrder: child.attributes.sortOrder,
      attributes: child.attributes
    }));
}

function primaryKeysFromChildren(children: JdbcSchemaObject[]): Array<{ name?: string; column?: unknown; attributes: Record<string, unknown> }> {
  const explicit = children.filter((child) => child.kind === "primary_key").map((child) => ({
    name: child.name,
    column: child.attributes.column,
    attributes: child.attributes
  }));
  const columnFlags = children.filter((child) => child.kind === "column" && child.attributes.primaryKey === true).map((child) => ({
    column: child.name,
    attributes: child.attributes
  }));
  return [...explicit, ...columnFlags];
}

function foreignKeysFromChildren(children: JdbcSchemaObject[]): Array<{ name?: string; column?: unknown; referencesTable?: unknown; referencesColumn?: unknown; attributes: Record<string, unknown> }> {
  const explicit = children.filter((child) => child.kind === "foreign_key").map((child) => ({
    name: child.name,
    column: child.attributes.column,
    referencesTable: child.attributes.referencesTable,
    referencesColumn: child.attributes.referencesColumn,
    attributes: child.attributes
  }));
  const columnFlags = children.filter((child) => child.kind === "column" && child.attributes.foreignKey === true).map((child) => ({
    column: child.name,
    referencesTable: child.attributes.referencesTable,
    referencesColumn: child.attributes.referencesColumn,
    attributes: child.attributes
  }));
  return [...explicit, ...columnFlags];
}

function matchSearch(match: JdbcObjectMatch, matcher: (value: string) => boolean): boolean {
  return searchableObjectNames(match).some((value) => matcher(value));
}

export function searchableObjectNames(match: JdbcObjectMatch): string[] {
  return [match.name, match.fullName, schemaQualifiedName(match)].filter((value): value is string => value !== undefined && value.length > 0);
}

function matchesDetail(match: JdbcObjectMatch, name: string, schema?: string): boolean {
  const normalizedName = normalizeName(name);
  const parts = normalizedName.split(".").filter(Boolean);
  const expectedObject = parts.at(-1) ?? normalizedName;
  const expectedSchema = schema ? normalizeName(schema) : parts.length >= 2 ? parts.at(-2) : undefined;
  const expectedDatabase = parts.length >= 3 ? parts.at(-3) : undefined;
  return normalizeName(match.name) === expectedObject
    && (!expectedSchema || normalizeName(match.schema) === expectedSchema)
    && (!expectedDatabase || normalizeName(match.database) === expectedDatabase);
}

function matchesDatabase(match: JdbcObjectMatch, database?: string): boolean {
  return !database || normalizeName(match.database) === normalizeName(database);
}

function schemaQualifiedName(match: JdbcObjectMatch): string {
  return [match.schema, match.name].filter(Boolean).join(".");
}

function globMatcher(pattern: string): (value: string) => boolean {
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${escaped}$`, "i");
  return (value) => regex.test(value);
}

function normalizeName(value: unknown): string {
  return typeof value === "string"
    ? value.replaceAll("[", "").replaceAll("]", "").replace(/["`]/g, "").toLowerCase()
    : "";
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isJdbcSchemaObject(value: unknown): value is JdbcSchemaObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { kind?: unknown }).kind === "string");
}
