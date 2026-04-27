import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SettingDefinition } from "../../contracts/extensions/SettingsExtension";
import { PasswordFieldInput } from "./PasswordFieldInput";
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
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryInput);
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [queryInput]);

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
    if (definitions.length === 0) {
      if (selectedNodeKey !== null) {
        setSelectedNodeKey(null);
      }
      return;
    }

    if (selectedNodeKey && !findTreeNodeByKey(tree, selectedNodeKey)) {
      setSelectedNodeKey(null);
      return;
    }

    if (!selectedNodeKey) {
      const firstNodeKey = findFirstNodeWithSettings(tree)?.key ?? tree.children[0]?.key ?? null;
      if (firstNodeKey) {
        setSelectedNodeKey(firstNodeKey);
      }
    }
  }, [definitions, selectedNodeKey, tree, isOpen, service]);

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

  const selectedNode = selectedNodeKey ? findTreeNodeByKey(tree, selectedNodeKey) : null;
  const groupedDefinitions = (selectedNode?.settingIds ?? [])
    .map((settingId) => definitions.find((definition) => definition.id === settingId))
    .filter((definition): definition is SettingDefinition => Boolean(definition));

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
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search settings"
            className="settings-search-input"
          />
        </div>

        <div className="settings-modal-body">
          <aside className="settings-tree" aria-label="Settings tree">
            <TreeNodeView
              node={tree}
              onSelectNode={(nodeKey) => {
                setSelectedNodeKey(nodeKey);
              }}
              selectedNodeKey={selectedNodeKey}
              expandedNodeKeys={expandedNodeKeys}
              onToggleNode={toggleNode}
            />
          </aside>

          <section className="settings-detail" aria-label="Setting details">
            {groupedDefinitions.length > 0 ? (
              <div className="settings-group-list">
                {groupedDefinitions.map((definition) => (
                  <SettingEditor
                    key={definition.id}
                    definition={definition}
                    value={service.getValue(definition.id)}
                    onChange={async (value) => {
                      const result = await service.setValue(definition.id, value);
                      if (!result.ok) {
                        setError(result.message);
                        return;
                      }
                      setError(null);
                    }}
                  />
                ))}
              </div>
            ) : <p className="settings-empty">Select a settings category to edit</p>}
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
  const [stringDraft, setStringDraft] = useState(() => (typeof value === "string" ? value : ""));
  const [numberDraft, setNumberDraft] = useState(() => (typeof value === "number" ? String(value) : "0"));
  const service = getCoreSettingsService();

  useEffect(() => {
    if (definition.type === "json") {
      setDraft(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    }
  }, [definition.type, value]);

  useEffect(() => {
    if (definition.type === "string") {
      setStringDraft(typeof value === "string" ? value : "");
    }
  }, [definition.type, value]);

  useEffect(() => {
    if (definition.type === "number") {
      setNumberDraft(typeof value === "number" ? String(value) : "0");
    }
  }, [definition.type, value]);

  useEffect(() => {
    if (definition.type !== "string") {
      return;
    }

    const targetValue = typeof value === "string" ? value : "";
    if (stringDraft === targetValue) {
      return;
    }

    const timer = setTimeout(() => {
      void onChange(stringDraft);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [definition.type, stringDraft, value, onChange]);

  useEffect(() => {
    if (definition.type !== "number") {
      return;
    }

    const parsed = Number(numberDraft);
    if (Number.isNaN(parsed)) {
      return;
    }

    const targetValue = typeof value === "number" ? value : 0;
    if (parsed === targetValue) {
      return;
    }

    const timer = setTimeout(() => {
      void onChange(parsed);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [definition.type, numberDraft, value, onChange]);

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
      {definition.isSecret && definition.type !== "password" ? (
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
              value={stringDraft}
              onChange={(event) => setStringDraft(event.target.value)}
              className="settings-field-input"
            />
          )}

          {definition.type === "password" && (
            <PasswordFieldInput
              inputId={`settings-password-${definition.id}`}
              valueRef={
                typeof value === "string" || (value && typeof value === "object" && "secretRef" in value)
                  ? (value as string | { secretRef: string })
                  : undefined
              }
              readonly={false}
              onChangeRef={(nextRef) => {
                void onChange(nextRef ?? "");
              }}
            />
          )}

          {definition.type === "number" && (
            <input
              type="number"
              value={numberDraft}
              min={definition.constraints?.min}
              max={definition.constraints?.max}
              onChange={(event) => setNumberDraft(event.target.value)}
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
  normalizeMixedNodes(root);
  return root;
}

function normalizeMixedNodes(node: TreeNode): void {
  for (const child of node.children) {
    normalizeMixedNodes(child);
  }

  if (node.settingIds.length === 0 || node.children.length === 0) {
    return;
  }

  let generalChild = node.children.find((child) => child.name === "General");
  if (!generalChild) {
    generalChild = {
      name: "General",
      key: `${node.key}/General`,
      children: [],
      settingIds: []
    };
    node.children.push(generalChild);
  }

  generalChild.settingIds.push(...node.settingIds);
  node.settingIds = [];
}

function TreeNodeView(props: {
  node: TreeNode;
  selectedNodeKey: string | null;
  onSelectNode: (nodeKey: string) => void;
  expandedNodeKeys: Set<string>;
  onToggleNode: (key: string) => void;
  depth?: number;
}): JSX.Element {
  const {
    node,
    selectedNodeKey,
    onSelectNode,
    expandedNodeKeys,
    onToggleNode,
    depth = 0
  } = props;
  return (
    <ul className="settings-tree-list">
      {node.children
        .sort((a, b) => compareTreeNodes(a, b))
        .map((child) => {
          const isExpanded = expandedNodeKeys.has(child.key);
          const isSettingsNode = child.settingIds.length > 0 && child.children.length === 0;
          return (
            <li key={child.key} className="settings-tree-node">
              <button
                type="button"
                className={`settings-tree-group${isSettingsNode ? " is-settings-node" : ""}${selectedNodeKey === child.key ? " is-selected" : ""}`}
                style={{ "--settings-depth": depth } as CSSProperties}
                onClick={() => {
                  onSelectNode(child.key);
                  if (!isSettingsNode) {
                    onToggleNode(child.key);
                  }
                }}
                aria-expanded={isSettingsNode ? undefined : isExpanded}
              >
                {!isSettingsNode && (
                  <span className={`settings-tree-chevron${isExpanded ? " is-expanded" : ""}`}>
                    {'>'}
                  </span>
                )}
                <span className="settings-tree-label">{child.name}</span>
              </button>
              {isExpanded && !isSettingsNode && (
                <TreeNodeView
                  node={child}
                  selectedNodeKey={selectedNodeKey}
                  onSelectNode={onSelectNode}
                  expandedNodeKeys={expandedNodeKeys}
                  onToggleNode={onToggleNode}
                  depth={depth + 1}
                />
              )}
            </li>
          );
        })}
    </ul>
  );
}

function compareTreeNodes(left: TreeNode, right: TreeNode): number {
  const leftIsGeneral = left.name === "General";
  const rightIsGeneral = right.name === "General";
  if (leftIsGeneral && !rightIsGeneral) {
    return -1;
  }
  if (!leftIsGeneral && rightIsGeneral) {
    return 1;
  }
  return left.name.localeCompare(right.name);
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

function findTreeNodeByKey(root: TreeNode, key: string): TreeNode | null {
  if (root.key === key) {
    return root;
  }

  const stack = [...root.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.key === key) {
      return node;
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }

  return null;
}

function findFirstNodeWithSettings(root: TreeNode): TreeNode | null {
  const stack = [...root.children].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.settingIds.length > 0) {
      return current;
    }
    for (const child of [...current.children].reverse()) {
      stack.push(child);
    }
  }
  return null;
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
