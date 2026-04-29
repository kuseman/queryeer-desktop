import { useEffect, useState } from "react";
import { queryTextRegistry } from "../core.queryengine/QueryTextEditorRegistry";
import { getPayloadbuilderCatalogStore } from "./catalog-store";
import { onCoreSettingsServiceInitialized } from "../core.settings/service";
import { getPayloadbuilderCatalogContribution } from "./catalog-contributions";

type ActiveFileState = {
  fileId: string;
};

export function PayloadbuilderCatalogSidebar(): JSX.Element {
  const [activeFile, setActiveFile] = useState<ActiveFileState | null>(() => {
    const file = queryTextRegistry.getActiveFile();
    return file ? { fileId: file.fileId } : null;
  });
  const [_revision, setRevision] = useState(0);

  useEffect(() => {
    const registry = queryTextRegistry;
    let unsubscribeSettingsValues: (() => void) | undefined;
    const sub = registry.subscribe(() => {
      const file = registry.getActiveFile();
      setActiveFile(file ? { fileId: file.fileId } : null);
    });
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
      sub.dispose();
      unsubscribe();
      unsubscribeSettingsValues?.();
      unsubscribeSettingsInit();
    };
  }, []);

  const instances = activeFile
    ? getPayloadbuilderCatalogStore().listInstances(activeFile.fileId).filter((instance) => instance.enabled)
    : [];
  const panelInstances = instances.filter((instance) =>
    Boolean(getPayloadbuilderCatalogContribution(instance.catalogId)?.renderPanel)
  );
  const activeDefaultAlias = activeFile
    ? ((getPayloadbuilderCatalogStore().buildEngineState(activeFile.fileId) as {
        payloadbuilder?: { defaultCatalogAlias?: string };
      })?.payloadbuilder?.defaultCatalogAlias ?? "")
    : "";

  if (!activeFile) {
    return <div className="payloadbuilder-catalog-empty">Open a query file to configure catalogs.</div>;
  }

  return (
    <div className="payloadbuilder-catalog-sidebar" data-context="payloadbuilder-catalogs">
      {panelInstances.length === 0 && (
        <div className="payloadbuilder-catalog-empty">No configurable catalog panels for this file.</div>
      )}

      {panelInstances.map((instance) => {
        const contribution = getPayloadbuilderCatalogContribution(instance.catalogId);
        const title = instance.title ?? contribution?.title ?? instance.catalogId;
        return (
          <section className="panel-card" key={instance.alias}>
            <header className="panel-header">
              <label>
                <input
                  type="radio"
                  name="payloadbuilder-default-catalog-alias"
                  title="Set as default catalog alias"
                  aria-label={`Set ${instance.alias} as default catalog alias`}
                  checked={instance.alias === activeDefaultAlias}
                  onChange={() =>
                    getPayloadbuilderCatalogStore().setDefaultCatalogAlias(activeFile.fileId, instance.alias)
                  }
                />
              </label>
              <span className="panel-title">
                {instance.alias} - {title}
              </span>
            </header>
            <div className="panel-content">
              {contribution?.renderPanel?.({
                  fileId: activeFile.fileId,
                  alias: instance.alias,
                  catalogId: instance.catalogId,
                  properties: instance.properties,
                  setProperty: (propertyKey, value) =>
                    getPayloadbuilderCatalogStore().setProperty(
                      activeFile.fileId,
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
