import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const backendRoot = join(repoRoot, "queryeer-backend");
const parentPomPath = join(backendRoot, "pom.xml");

let cached = null;

/**
 * @param {string} filePath
 */
function readPom(filePath) {
  const xml = readFileSync(filePath, "utf8");
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: (msg) => {
        throw new Error(`Fatal XML error in ${filePath}: ${msg}`);
      }
    }
  }).parseFromString(xml, "application/xml");
  if (!doc || !doc.documentElement) {
    throw new Error(`Failed to parse pom at ${filePath}`);
  }
  return doc.documentElement;
}

/**
 * @param {any} node
 * @returns {Element[]}
 */
function childElements(node, tagName) {
  const out = [];
  if (!node || !node.childNodes) {
    return out;
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c && c.nodeType === 1 && (!tagName || c.tagName === tagName)) {
      out.push(c);
    }
  }
  return out;
}

/**
 * Reads direct-child text content for a tag, or a named <properties> child.
 * @param {Element} parent
 * @param {string} childTag
 * @param {string} [propertyName]
 */
function readString(parent, childTag, propertyName) {
  if (propertyName) {
    const props = childElements(parent, "properties")
      .find((p) => childElements(p, propertyName).length > 0);
    if (props) {
      const node = childElements(props, propertyName)[0];
      if (node && node.textContent) {
        return node.textContent.trim();
      }
    }
    return undefined;
  }
  const direct = childElements(parent, childTag)[0];
  if (direct && direct.textContent) {
    return direct.textContent.trim();
  }
  return undefined;
}

function loadCatalog() {
  const parent = readPom(parentPomPath);
  const moduleDirs = childElements(parent, "modules").flatMap((m) => childElements(m, "module"))
    .map((m) => m.textContent.trim());

  /** @type {Array<{ artifactId: string, pluginId: string, moduleDir: string }>} */
  const builtinModules = [];

  for (const moduleDir of moduleDirs) {
    const modulePomPath = join(backendRoot, moduleDir, "pom.xml");
    const moduleDoc = readPom(modulePomPath);
    const artifactId = readString(moduleDoc, "artifactId");
    if (!artifactId) {
      throw new Error(`Module ${moduleDir} is missing <artifactId>`);
    }
    const pluginId = readString(moduleDoc, "artifactId", "queryeer.plugin.id");
    if (pluginId) {
      builtinModules.push({ artifactId, pluginId, moduleDir });
    }
  }

  return {
    backendRoot,
    modulesByPluginId: new Map(builtinModules.map((m) => [m.pluginId, m.artifactId]))
  };
}

function ensureLoaded() {
  if (!cached) {
    cached = loadCatalog();
  }
  return cached;
}

export function getModulesByPluginId() {
  return new Map(ensureLoaded().modulesByPluginId);
}

export function getBackendRoot() {
  return ensureLoaded().backendRoot;
}
