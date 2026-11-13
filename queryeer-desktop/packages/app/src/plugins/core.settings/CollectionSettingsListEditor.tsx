import type {
  CollectionSettingsListEditorProps,
  CollectionSettingsListItem,
  UseCollectionSettingsPersistence
} from "@queryeer/api/settings/SettingsExtension";
import { useCallback, useEffect, useRef } from "react";

export type { CollectionSettingsListItem };

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
}: CollectionSettingsListEditorProps): JSX.Element {
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

export const useCollectionSettingsPersistence: UseCollectionSettingsPersistence = <T,>(options: {
  persist: (items: T[]) => void;
  debounceMs?: number;
}) => {
  const { persist, debounceMs = 300 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingItemsRef = useRef<T[] | null>(null);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const persistNow = useCallback((items: T[]) => {
    clearTimer();
    pendingItemsRef.current = null;
    persistRef.current(items);
  }, [clearTimer]);

  const persistDebounced = useCallback((items: T[]) => {
    clearTimer();
    pendingItemsRef.current = items;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pendingItems = pendingItemsRef.current;
      pendingItemsRef.current = null;
      if (pendingItems) {
        persistRef.current(pendingItems);
      }
    }, debounceMs);
  }, [clearTimer, debounceMs]);

  useEffect(() => {
    return () => {
      clearTimer();
      const pendingItems = pendingItemsRef.current;
      pendingItemsRef.current = null;
      if (pendingItems) {
        persistRef.current(pendingItems);
      }
    };
  }, [clearTimer]);

  return {
    persistNow,
    persistDebounced
  };
};
