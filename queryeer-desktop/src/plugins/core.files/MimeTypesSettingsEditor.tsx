import type { MimeIconProps } from "../../contracts/files/FilesRegistry";

type MimeTypeOption = {
  mimeType: string;
  label: string;
  icon: (props: MimeIconProps) => JSX.Element;
};

type MimeTypeConfigItem = {
  mimeType: string;
  enableForNew: boolean;
  color?: string;
};

type MimeTypesSettingsEditorProps = {
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
  options: MimeTypeOption[];
};

function normalizeValue(value: unknown, options: MimeTypeOption[]): MimeTypeConfigItem[] {
  const available = new Map(options.map((o) => [o.mimeType, o]));
  if (!Array.isArray(value)) {
    return options.map((o) => ({ mimeType: o.mimeType, enableForNew: true }));
  }
  const result: MimeTypeConfigItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const mimeType = String(item.mimeType ?? "");
    if (!available.has(mimeType) || seen.has(mimeType)) {
      continue;
    }
    seen.add(mimeType);
    const color = typeof item.color === "string" ? item.color : undefined;
    result.push({
      mimeType,
      enableForNew: Boolean(item.enableForNew),
      color
    });
  }
  for (const option of options) {
    if (!seen.has(option.mimeType)) {
      result.push({ mimeType: option.mimeType, enableForNew: true });
    }
  }
  return result;
}

export function MimeTypesSettingsEditor({
  value,
  setValue,
  readonly,
  options
}: MimeTypesSettingsEditorProps): JSX.Element {
  const items = normalizeValue(value, options);
  const optionByMimeType = new Map(options.map((o) => [o.mimeType, o]));

  const update = (nextItems: MimeTypeConfigItem[]) => {
    setValue(nextItems);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) {
      return;
    }
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    update(next);
  };

  return (
    <div className="settings-mime-grid" role="table" aria-label="MIME type configuration">
      <div className="settings-mime-grid-header" role="row">
        <span role="columnheader">New</span>
        <span role="columnheader">Color</span>
        <span role="columnheader">MIME type</span>
        <span role="columnheader">Label</span>
        <span role="columnheader">Order</span>
      </div>
      <div className="settings-mime-grid-body">
        {items.map((item, index) => {
          const option = optionByMimeType.get(item.mimeType)!;
          const inputId = `settings-color-${item.mimeType}`;
          return (
            <div key={item.mimeType} className="settings-mime-grid-row" role="row">
              <label
                className="settings-mime-grid-toggle"
                title="Include in New menus"
              >
                <input
                  type="checkbox"
                  checked={item.enableForNew}
                  disabled={readonly}
                  onChange={(event) => {
                    const next = [...items];
                    next[index] = { ...item, enableForNew: event.target.checked };
                    update(next);
                  }}
                />
              </label>
              <div className="settings-mime-grid-color">
                <label htmlFor={inputId} className="settings-color-swatch-wrapper" title="Set or change color">
                  <input
                    id={inputId}
                    type="color"
                    className="settings-color-input-hidden"
                    value={item.color ?? "#000000"}
                    disabled={readonly}
                    onChange={(event) => {
                      const next = [...items];
                      next[index] = { ...item, color: event.target.value };
                      update(next);
                    }}
                  />
                  <span
                    className="settings-color-swatch"
                    style={{ backgroundColor: item.color ?? "transparent" }}
                  />
                </label>
                {item.color && (
                  <button
                    type="button"
                    className="settings-color-clear"
                    disabled={readonly}
                    onClick={() => {
                      const next = [...items];
                      next[index] = { ...item, color: undefined };
                      update(next);
                    }}
                    title="Clear color"
                  >
                    &times;
                  </button>
                )}
              </div>
              <code className="settings-mime-grid-code">{item.mimeType}</code>
              <span className="settings-mime-grid-label">
                <option.icon className="settings-mime-grid-icon" />
                {option.label}
              </span>
              <div className="settings-mime-grid-order">
                <button
                  type="button"
                  className="settings-list-editor-icon-button"
                  disabled={readonly || index === 0}
                  onClick={() => move(index, -1)}
                  title="Move up"
                >
                  Up
                </button>
                <button
                  type="button"
                  className="settings-list-editor-icon-button"
                  disabled={readonly || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  title="Move down"
                >
                  Down
                </button>
              </div>
              <span className="settings-mime-grid-position">#{index + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
