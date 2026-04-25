import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SettingDefinition } from "../../contracts/extensions/SettingsExtension";
import { getCoreSettingsService } from "./service";
import "./settings-modal.css";

type TreeNode = {
  name: string;
  key: string;
  children: TreeNode[];
  settingIds: string[];
};

export function SettingsModalHost(): JSX.Element | null {
  const service = getCoreSettingsService();
  const [isOpen, setIsOpen] = useState(() => service?.isModalOpen() ?? false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!service) {
      return;
    }
    const unsubModal = service.subscribeModal(() => {
      setIsOpen(service.isModalOpen());
      setVersion((version) => version + 1);
      if (service.isModalOpen()) {
        service.refreshSchemaFromRegistry();
      }
    });
    const unsubValues = service.subscribe(() => {
      setVersion((version) => version + 1);
    });
    return () => {
      unsubModal();
      unsubValues();
    };
  }, [service]);

  const definitions = useMemo(() => {
    if (!service) {
      return [];
    }
    return service.listDefinitions(query);
  }, [query, service, isOpen]);

  const tree = useMemo(() => buildTree(definitions), [definitions]);
  const treeKeys = useMemo(() => collectTreeKeys(tree), [tree]);

  useEffect(() => {
    if (!isOpen || !service) {
      return;
    }
    if (!definitions.some((definition) => definition.id === selectedId)) {
      setSelectedId(definitions[0]?.id ?? null);
    }
  }, [definitions, selectedId, isOpen]);

  useEffect(() => {
    if (!isOpen || !service) {
      return;
    }
    setExpandedNodeKeys((previous) => {
      if (query.trim().length > 0) {
        return areSetsEqual(previous, treeKeys) ? previous : treeKeys;
      }
      if (previous.size === 0) {
        return treeKeys;
      }
      const next = new Set<string>();
      for (const key of previous) {
        if (treeKeys.has(key)) {
          next.add(key);
        }
      }
      return areSetsEqual(previous, next) ? previous : next;
    });
  }, [treeKeys, query, isOpen]);

  useEffect(() => {
    const settingsService = service;
    if (!isOpen || !settingsService) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      settingsService.closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, service]);

  if (!service || !isOpen) {
    return null;
  }

  const selected = definitions.find((definition) => definition.id === selectedId) ?? null;

  const toggleNode = (key: string): void => {
    setExpandedNodeKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="settings-modal-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-modal">
        <header className="settings-modal-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="settings-modal-close"
            onClick={() => service.closeModal()}
            aria-label="Close settings"
          >
            x
          </button>
        </header>

        <div className="settings-modal-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            className="settings-search-input"
          />
        </div>

        <div className="settings-modal-body">
          <aside className="settings-tree" aria-label="Settings tree">
            <TreeNodeView
              node={tree}
              onSelect={setSelectedId}
              selectedId={selectedId}
              expandedNodeKeys={expandedNodeKeys}
              onToggleNode={toggleNode}
            />
          </aside>

          <section className="settings-detail" aria-label="Setting details">
            {selected ? (
              <SettingEditor
                definition={selected}
                value={service.getValue(selected.id)}
                onChange={async (value) => {
                  const result = await service.setValue(selected.id, value);
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setError(null);
                }}
              />
            ) : (
              <p className="settings-empty">Select a setting to edit</p>
            )}
            {error && <p className="settings-error">{error}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function SettingEditor(props: {
  definition: SettingDefinition;
  value: unknown;
  onChange: (value: unknown) => Promise<void>;
}): JSX.Element {
  const { definition, value, onChange } = props;
  const [draft, setDraft] = useState(() => (typeof value === "string" ? value : JSON.stringify(value)));
  const service = getCoreSettingsService();

  useEffect(() => {
    if (definition.type === "json") {
      setDraft(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    }
  }, [definition.type, value]);

  const advanced = service?.renderAdvancedSetting(definition, Boolean(definition.isSecret), (next) => {
    void onChange(next);
  });
  if (advanced) {
    return (
      <article className="settings-card">
        <h3>{definition.title}</h3>
        <p className="settings-setting-id">{definition.id}</p>
        {definition.description && <p className="settings-description">{definition.description}</p>}
        {advanced}
      </article>
    );
  }

  return (
    <article className="settings-card">
      <h3>{definition.title}</h3>
      <p className="settings-setting-id">{definition.id}</p>
      {definition.description && <p className="settings-description">{definition.description}</p>}
      {definition.isSecret ? (
        <div className="settings-secret-placeholder">Secret storage is not enabled yet.</div>
      ) : (
        <>
          {definition.type === "boolean" && (
            <label className="settings-field-inline">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => void onChange(event.target.checked)}
              />
              <span>Enabled</span>
            </label>
          )}

          {definition.type === "string" && (
            <input
              type="text"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => void onChange(event.target.value)}
              className="settings-field-input"
            />
          )}

          {definition.type === "number" && (
            <input
              type="number"
              value={typeof value === "number" ? value : 0}
              min={definition.constraints?.min}
              max={definition.constraints?.max}
              onChange={(event) => void onChange(Number(event.target.value))}
              className="settings-field-input"
            />
          )}

          {definition.type === "enum" && (
            <select
              value={typeof value === "string" ? value : String(definition.defaultValue)}
              onChange={(event) => void onChange(event.target.value)}
              className="settings-field-input"
            >
              {(definition.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {definition.type === "json" && (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={8}
                className="settings-field-textarea"
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(draft);
                    void onChange(parsed);
                  } catch {
                    // ignored; validation feedback handled by service
                  }
                }}
                className="settings-apply-button"
              >
                Apply JSON
              </button>
            </>
          )}
        </>
      )}
    </article>
  );
}

function buildTree(definitions: SettingDefinition[]): TreeNode {
  const root: TreeNode = { name: "Settings", key: "root", children: [], settingIds: [] };
  for (const definition of definitions) {
    let current = root;
    for (const segment of definition.sectionPath) {
      let child = current.children.find((node) => node.name === segment);
      if (!child) {
        child = {
          name: segment,
          key: `${current.key}/${segment}`,
          children: [],
          settingIds: []
        };
        current.children.push(child);
      }
      current = child;
    }
    current.settingIds.push(definition.id);
  }
  return root;
}

function TreeNodeView(props: {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (settingId: string) => void;
  expandedNodeKeys: Set<string>;
  onToggleNode: (key: string) => void;
  depth?: number;
}): JSX.Element {
  const { node, selectedId, onSelect, expandedNodeKeys, onToggleNode, depth = 0 } = props;
  const service = getCoreSettingsService();
  const definitionsById = new Map(
    (service?.listDefinitions() ?? []).map((definition) => [definition.id, definition])
  );
  return (
    <ul className="settings-tree-list">
      {node.children
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => {
          const isExpanded = expandedNodeKeys.has(child.key);
          return (
            <li key={child.key} className="settings-tree-node">
              <button
                type="button"
                className="settings-tree-group"
                style={{ "--settings-depth": depth } as CSSProperties}
                onClick={() => onToggleNode(child.key)}
                aria-expanded={isExpanded}
              >
                <span className={`settings-tree-chevron${isExpanded ? " is-expanded" : ""}`}>
                  {'>'}
                </span>
                <span className="settings-tree-label">{child.name}</span>
              </button>
              {isExpanded && (
                <TreeNodeView
                  node={child}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expandedNodeKeys={expandedNodeKeys}
                  onToggleNode={onToggleNode}
                  depth={depth + 1}
                />
              )}
            </li>
          );
        })}
      {node.settingIds.sort().map((settingId) => {
        const definition = definitionsById.get(settingId);
        if (!definition) {
          return null;
        }
        return (
          <li key={settingId} className="settings-tree-leaf">
            <button
              type="button"
              className={`settings-tree-button${selectedId === settingId ? " is-selected" : ""}`}
              style={{ "--settings-depth": depth } as CSSProperties}
              onClick={() => onSelect(settingId)}
            >
              {definition.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function collectTreeKeys(root: TreeNode): Set<string> {
  const keys = new Set<string>();
  const stack = [...root.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    keys.add(node.key);
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return keys;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
