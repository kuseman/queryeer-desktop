import { useEffect, useMemo, useState } from "react";
import { getThemeService } from "./runtime";

export function ThemeSettingsEditor(props: {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
}): JSX.Element {
  const service = getThemeService();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!service) {
      return;
    }
    return service.subscribe(() => {
      setVersion((value) => value + 1);
    });
  }, [service]);

  const themes = useMemo(() => service?.listThemes() ?? [], [service, version]);
  const selected = typeof props.value === "string" ? props.value : "queryeer.dark";
  const selectedTheme = themes.find((theme) => theme.id === selected);

  return (
    <div>
      <select
        value={selected}
        onChange={(event) => props.setValue(event.target.value)}
        disabled={props.readonly}
        className="settings-input"
      >
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
      {selectedTheme?.description ? (
        <p className="settings-description">{selectedTheme.description}</p>
      ) : null}
    </div>
  );
}
