import type { TableLinkAction, TableLinkActionContext, TableLinkActionContribution } from "../../contracts/queryengine/TableLinkActionExtension.js";

const contributions = new Map<string, TableLinkActionContribution>();

export function registerTableLinkActionContribution(contribution: TableLinkActionContribution): void {
  contributions.set(contribution.id, contribution);
}

export function resolveTableLinkAction(context: TableLinkActionContext): TableLinkAction | null {
  for (const contribution of contributions.values()) {
    const matched = contribution.match(context);
    if (matched) {
      return matched;
    }
  }
  return null;
}

export function inferPreviewMimeType(value: unknown): string {
  const text = valueToString(value).trim();
  if (text.length === 0) {
    return "text/plain";
  }
  if (tryFormatJson(text)) {
    return "application/json";
  }
  if (isLikelyXml(text)) {
    return "application/xml";
  }
  return "text/plain";
}

export function formatPreviewValue(value: unknown, mimeType: string): string {
  const text = valueToString(value);
  if (mimeType === "application/json") {
    const formatted = tryFormatJson(text);
    return formatted ?? text;
  }
  if (mimeType === "application/xml") {
    return prettyPrintXml(text);
  }
  return text;
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function tryFormatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function isLikelyXml(text: string): boolean {
  if (!text.startsWith("<") || !text.endsWith(">")) return false;
  return /^<\??[a-zA-Z_]/.test(text) || /^<[a-zA-Z_]/.test(text);
}

function prettyPrintXml(xml: string): string {
  const compact = xml.replace(/>\s+</g, "><").trim();
  const tokens = compact.replace(/></g, ">\n<").split("\n");
  let indent = 0;
  const lines: string[] = [];
  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token.startsWith("</")) {
      indent = Math.max(0, indent - 1);
    }
    lines.push(`${"  ".repeat(indent)}${token}`);
    if (token.startsWith("<") && !token.startsWith("</") && !token.endsWith("/>") && !token.includes("</")) {
      indent += 1;
    }
  }
  return lines.join("\n");
}

function createJsonAction(value: unknown): TableLinkAction | null {
  const text = valueToString(value).trim();
  if (!text.startsWith("{") && !text.startsWith("[")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const isObjectOrArray = typeof parsed === "object" && parsed !== null;
  if (!isObjectOrArray) {
    return null;
  }
  const formatted = JSON.stringify(parsed, null, 2);
  return {
    kind: "preview",
    title: "JSON Preview",
    value: formatted,
    mimeType: "application/json",
  };
}

function createXmlAction(value: unknown): TableLinkAction | null {
  const text = valueToString(value).trim();
  if (!isLikelyXml(text)) return null;
  return {
    kind: "preview",
    title: "XML Preview",
    value: prettyPrintXml(text),
    mimeType: "application/xml",
  };
}

function createHttpAction(value: unknown): TableLinkAction | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^https?:\/\/[\w.-]+(?::[0-9]+)?(?:\/.*)?$/i.test(text)) return null;
  return {
    kind: "external",
    title: "Open Link",
    value: text,
  };
}

registerTableLinkActionContribution({
  id: "core.queryengine.output.table.linkAction.http",
  match: ({ value }) => createHttpAction(value),
});

registerTableLinkActionContribution({
  id: "core.queryengine.output.table.linkAction.json",
  match: ({ value }) => createJsonAction(value),
});

registerTableLinkActionContribution({
  id: "core.queryengine.output.table.linkAction.xml",
  match: ({ value }) => createXmlAction(value),
});
