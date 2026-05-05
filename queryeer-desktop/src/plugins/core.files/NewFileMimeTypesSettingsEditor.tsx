import type { MimeIconProps } from "../../contracts/files/FilesRegistry";

type MimeTypeOption = {
  mimeType: string;
  label: string;
  icon: (props: MimeIconProps) => JSX.Element;
};

type NewFileMimeTypesSettingsEditorProps = {
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
  options: MimeTypeOption[];
};

function normalizeSelection(value: unknown, options: MimeTypeOption[]): string[] {
  const available = new Set(options.map((option) => option.mimeType));
  if (!Array.isArray(value)) {
    return options.map((option) => option.mimeType);
  }
  const selected: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    if (!available.has(entry)) {
      continue;
    }
    if (selected.includes(entry)) {
      continue;
    }
    selected.push(entry);
  }
  return selected;
}

export function NewFileMimeTypesSettingsEditor({
  value,
  setValue,
  readonly,
  options
}: NewFileMimeTypesSettingsEditorProps): JSX.Element {
  const selected = normalizeSelection(value, options);
  const selectedSet = new Set(selected);
  const orderedOptions = [
    ...selected
      .map((mimeType) => options.find((option) => option.mimeType === mimeType))
      .filter((option): option is MimeTypeOption => Boolean(option)),
    ...options.filter((option) => !selectedSet.has(option.mimeType))
  ];

  const move = (mimeType: string, delta: number): void => {
    if (!selectedSet.has(mimeType)) {
      return;
    }
    const visibleIndex = selected.indexOf(mimeType);
    if (visibleIndex < 0) {
      return;
    }
    const targetVisibleIndex = visibleIndex + delta;
    if (targetVisibleIndex < 0 || targetVisibleIndex >= selected.length) {
      return;
    }
    const nextSelected = [...selected];
    const targetMimeType = nextSelected[targetVisibleIndex]!;
    nextSelected[visibleIndex] = targetMimeType;
    nextSelected[targetVisibleIndex] = mimeType;
    setValue(nextSelected);
  };

  return (
    <div className="settings-mime-grid" role="table" aria-label="New file MIME type visibility and order">
      <div className="settings-mime-grid-header" role="row">
        <span role="columnheader">Show</span>
        <span role="columnheader">MIME type</span>
        <span role="columnheader">Label</span>
        <span role="columnheader">Order</span>
      </div>
      <div className="settings-mime-grid-body">
        {orderedOptions.map((option) => {
          const isVisible = selectedSet.has(option.mimeType);
          const visibleIndex = selected.indexOf(option.mimeType);
          return (
            <div key={option.mimeType} className="settings-mime-grid-row" role="row">
              <label className="settings-mime-grid-toggle" title={isVisible ? "Hide from New menus" : "Show in New menus"}>
                <input
                  type="checkbox"
                  checked={isVisible}
                  disabled={readonly}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setValue([...selected, option.mimeType]);
                      return;
                    }
                    setValue(selected.filter((entry) => entry !== option.mimeType));
                  }}
                />
              </label>
              <code className="settings-mime-grid-code">{option.mimeType}</code>
              <span className="settings-mime-grid-label">
                <option.icon className="settings-mime-grid-icon" />
                {option.label}
              </span>
              <div className="settings-mime-grid-order">
                <button
                  type="button"
                  className="settings-list-editor-icon-button"
                  disabled={readonly || !isVisible || visibleIndex === 0}
                  onClick={() => move(option.mimeType, -1)}
                  title="Move up"
                >
                  Up
                </button>
                <button
                  type="button"
                  className="settings-list-editor-icon-button"
                  disabled={readonly || !isVisible || visibleIndex === selected.length - 1}
                  onClick={() => move(option.mimeType, 1)}
                  title="Move down"
                >
                  Down
                </button>
              </div>
              {isVisible ? (
                <span className="settings-mime-grid-position">#{visibleIndex + 1}</span>
              ) : (
                <span className="settings-mime-grid-position is-hidden">Hidden</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
