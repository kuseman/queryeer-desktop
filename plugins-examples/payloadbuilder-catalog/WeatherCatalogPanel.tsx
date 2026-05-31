import { useCallback } from "react";
import type { PayloadbuilderCatalogPanelProps } from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension";
import weatherCatalogStyles from "./weather-catalog.css";

const STYLE_ID = "example-weather-catalog-styles";

export function injectWeatherCatalogStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = weatherCatalogStyles;
  document.head.appendChild(style);
}

export function WeatherCatalogPanel({
  fileId,
  alias,
  catalogId,
  properties,
  setProperty
}: PayloadbuilderCatalogPanelProps) {
  const defaultCategory = (properties.defaultCategory as string) ?? "";

  const handleCategoryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setProperty("defaultCategory", e.target.value),
    [setProperty]
  );

  return (
    <div className="weather-catalog-panel">
      <h4>Fake Catalog</h4>
      <p className="weather-catalog-description">
        Configure the <strong>{alias}</strong> catalog ({catalogId})
        for file <code>{fileId}</code>.
      </p>
      <p className="weather-catalog-description">
        This catalog contributes table <code>products</code> and TVF <code>products_by_category(category)</code>.
      </p>
      <div className="weather-catalog-field">
        <label htmlFor="defaultCategory">Default Category</label>
        <input id="defaultCategory" type="text" value={defaultCategory} onChange={handleCategoryChange}
          placeholder="fruit or vegetable" />
      </div>
    </div>
  );
}
