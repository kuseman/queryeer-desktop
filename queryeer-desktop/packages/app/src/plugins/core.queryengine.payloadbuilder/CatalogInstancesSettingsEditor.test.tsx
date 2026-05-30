import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listPayloadbuilderCatalogContributionsMock = vi.hoisted(() => vi.fn());

vi.mock("./catalog-contributions", () => ({
  listPayloadbuilderCatalogContributions: () => listPayloadbuilderCatalogContributionsMock(),
  subscribePayloadbuilderCatalogContributions: () => () => {}
}));

import { CatalogInstancesSettingsEditor } from "./CatalogInstancesSettingsEditor";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CatalogInstancesSettingsEditor", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
    listPayloadbuilderCatalogContributionsMock.mockReturnValue([
      { catalogId: "elasticsearch", title: "Elasticsearch", defaultAlias: "es", allowMultiple: true },
      { catalogId: "filesystem", title: "Filesystem", defaultAlias: "fs", allowMultiple: false }
    ]);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("clones selected alias row", async () => {
    const setValue = vi.fn();

    await act(async () => {
      root.render(
        <CatalogInstancesSettingsEditor
          readonly={false}
          value={[{ alias: "es1", catalogId: "elasticsearch", enabled: true }]}
          setValue={setValue}
        />
      );
      await flush();
    });

    const cloneButton = Array.from(rootElement.querySelectorAll("button")).find(
      (button) => button.textContent === "Clone"
    );
    expect(cloneButton).toBeTruthy();

    await act(async () => {
      cloneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const latest = setValue.mock.calls[setValue.mock.calls.length - 1]?.[0] as Array<{
      alias: string;
      catalogId: string;
      enabled: boolean;
    }>;
    expect(latest).toEqual([
      { alias: "es1", catalogId: "elasticsearch", enabled: true },
      { alias: "es12", catalogId: "elasticsearch", enabled: true }
    ]);
  });

  it("prevents cloning non-multiple catalogs", async () => {
    const setValue = vi.fn();

    await act(async () => {
      root.render(
        <CatalogInstancesSettingsEditor
          readonly={false}
          value={[{ alias: "fs", catalogId: "filesystem", enabled: true }]}
          setValue={setValue}
        />
      );
      await flush();
    });

    const cloneButton = Array.from(rootElement.querySelectorAll("button")).find(
      (button) => button.textContent === "Clone"
    );
    expect(cloneButton).toBeTruthy();

    await act(async () => {
      cloneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const latest = setValue.mock.calls[setValue.mock.calls.length - 1]?.[0] as
      | Array<{ alias: string }>
      | undefined;
    expect(latest).toBeUndefined();
  });
});
