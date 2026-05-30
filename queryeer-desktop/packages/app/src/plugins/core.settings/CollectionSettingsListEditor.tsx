import { useCallback, useEffect, useRef, type ReactNode } from "react";

export type CollectionSettingsListItem = {
  id: string;
  label: string;
  subtitle?: string;
  invalid?: boolean;
};

type Props = {
  items: CollectionSettingsListItem[];
  selectedId: string | undefined;
  readonly: boolean;
  addLabel?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  renderDetails: (id: string | undefined) => ReactNode;
};

export function CollectionSettingsListEditor({
  items,
  selectedId,
  readonly,
  addLabel,
  onSelect,
  onAdd,
  onClone,
  onDelete,
  renderDetails
}: Props): JSX.Element {
  const hasItems = items.length > 0;

  return (
    <div className="settings-list-editor">
      <aside className="settings-list-editor-items" aria-label="Configured items">
        {hasItems ? (
          items.map((item) => (
            <div key={item.id} className="settings-list-editor-item-row">
              <button
                type="button"
                className={`settings-list-editor-item ${selectedId === item.id ? "is-selected" : ""} ${
                  item.invalid ? "is-invalid" : ""
                }`}
                onClick={() => onSelect(item.id)}
                title={item.label}
              >
                <span className="settings-list-editor-item-label">{item.label}</span>
                {item.subtitle && <span className="settings-list-editor-item-subtitle">{item.subtitle}</span>}
              </button>
              <button
                type="button"
                className="settings-list-editor-icon-button"
                disabled={readonly}
                onClick={() => onClone(item.id)}
                title="Clone"
                aria-label={`Clone ${item.label}`}
              >
                Clone
              </button>
              <button
                type="button"
                className="settings-list-editor-icon-button"
                disabled={readonly}
                onClick={() => onDelete(item.id)}
                title="Delete"
                aria-label={`Delete ${item.label}`}
              >
                Delete
              </button>
            </div>
          ))
        ) : (
          <div className="settings-list-editor-empty">No items yet.</div>
        )}

        <button type="button" className="settings-list-editor-add" onClick={onAdd} disabled={readonly}>
          {addLabel ?? "Add"}
        </button>
      </aside>
      <section className="settings-list-editor-details">{renderDetails(selectedId)}</section>
    </div>
  );
}

export function useCollectionSettingsPersistence<T>(options: {
  persist: (items: T[]) => void;
  debounceMs?: number;
}): {
  persistNow: (items: T[]) => void;
  persistDebounced: (items: T[]) => void;
} {
  const { persist, debounceMs = 300 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const persistNow = useCallback((items: T[]) => {
    clearTimer();
    persist(items);
  }, [clearTimer, persist]);

  const persistDebounced = useCallback((items: T[]) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      persist(items);
    }, debounceMs);
  }, [clearTimer, debounceMs, persist]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    persistNow,
    persistDebounced
  };
}
