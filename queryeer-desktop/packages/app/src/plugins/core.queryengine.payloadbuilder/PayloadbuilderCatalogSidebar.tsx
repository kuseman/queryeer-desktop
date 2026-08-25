import { useEffect, useState } from "react";
import { getPayloadbuilderCatalogStore } from "./catalog-store";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { getPayloadbuilderCatalogContribution } from "./catalog-contributions";
import { getPayloadbuilderEnvironments } from "./environment-settings";
import { PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID } from "./environment-settings";

type Props = {
  fileId?: string;
};

export function PayloadbuilderCatalogSidebar({ fileId }: Props): JSX.Element {
  const [_revision, setRevision] = useState(0);

  useEffect(() => {
    let unsubscribeSettingsValues: (() => void) | undefined;
    const unsubscribe = getPayloadbuilderCatalogStore().subscribe(() => {
      setRevision((prev) => prev + 1);
    });
    const unsubscribeSettingsInit = onCoreSettingsServiceInitialized((settingsService) => {
      unsubscribeSettingsValues?.();
      unsubscribeSettingsValues = settingsService.subscribe(() => {
        setRevision((prev) => prev + 1);
      });
      setRevision((prev) => prev + 1);
    });

    return () => {
      unsubscribe();
      unsubscribeSettingsValues?.();
      unsubscribeSettingsInit();
    };
  }, []);

  const instances = fileId
    ? getPayloadbuilderCatalogStore().listInstances(fileId).filter((instance) => instance.enabled)
    : [];
  const panelInstances = instances.filter((instance) =>
    Boolean(getPayloadbuilderCatalogContribution(instance.catalogId)?.renderPanel)
  );
  const activeDefaultAlias = fileId
    ? ((getPayloadbuilderCatalogStore().buildEngineState(fileId) as {
        payloadbuilder?: { defaultCatalogAlias?: string };
      })?.payloadbuilder?.defaultCatalogAlias ?? "")
    : "";
  const selectedEnvironmentId = fileId
    ? ((getPayloadbuilderCatalogStore().buildEngineState(fileId) as {
        payloadbuilder?: { selectedEnvironmentId?: string };
      })?.payloadbuilder?.selectedEnvironmentId ?? "")
    : "";
  const environments = getPayloadbuilderEnvironments();

  if (!fileId) {
    return <div className="payloadbuilder-catalog-empty">Open a query file to configure catalogs.</div>;
  }

  return (
    <div className="payloadbuilder-catalog-sidebar" data-context="payloadbuilder-catalogs">
      {environments.length > 0 && (
        <section className="panel-card">
          <header className="panel-header">
            <span className="panel-title">Environment</span>
          </header>
          <div className="panel-content">
            <div className="payloadbuilder-environment-selector-row">
              <select
                className="payloadbuilder-catalog-select"
                value={selectedEnvironmentId}
                onInput={(event) =>
                  getPayloadbuilderCatalogStore().setSelectedEnvironmentId(
                    fileId,
                    event.currentTarget.value || undefined
                  )
                }
              >
                <option value="">None</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="payloadbuilder-catalog-button"
                title="Open environment settings"
                aria-label="Open environment settings"
                onClick={() => {
                  getCoreSettingsService()?.openModalForSetting(
                    PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID
                  );
                }}
              >
                ⚙
              </button>
            </div>
          </div>
        </section>
      )}

      {panelInstances.length === 0 && (
        <div className="payloadbuilder-catalog-empty">No configurable catalog panels for this file.</div>
      )}

      {panelInstances.map((instance) => {
        const contribution = getPayloadbuilderCatalogContribution(instance.catalogId);
        const title = instance.title ?? contribution?.title ?? instance.catalogId;
        return (
          <section className="panel-card" key={`${fileId}:${instance.alias}`}>
            <header className="panel-header">
              <label>
                <input
                  type="radio"
                  name="payloadbuilder-default-catalog-alias"
                  title="Set as default catalog alias"
                  aria-label={`Set ${instance.alias} as default catalog alias`}
                  checked={instance.alias === activeDefaultAlias}
                  onChange={() =>
                    getPayloadbuilderCatalogStore().setDefaultCatalogAlias(fileId, instance.alias)
                  }
                />
              </label>
              <span className="panel-title">
                {instance.alias} - {title}
              </span>
            </header>
            <div className="panel-content">
              {contribution?.renderPanel?.({
                  fileId,
                  alias: instance.alias,
                  catalogId: instance.catalogId,
                  properties: instance.properties,
                  setProperty: (propertyKey, value) =>
                    getPayloadbuilderCatalogStore().setProperty(
                      fileId,
                      instance.alias,
                      propertyKey,
                      value
                    )
                })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
