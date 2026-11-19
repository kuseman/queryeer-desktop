import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<() => Promise<unknown>>(async () => []) }));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke })
}));

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: () => undefined
}));

import { JdbcConnectionsSettingsEditor } from "./JdbcConnectionsSettingsEditor";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("JdbcConnectionsSettingsEditor", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    vi.stubGlobal("appShell", { getAppDir: async () => "/app", openPath: vi.fn() });
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
    invoke.mockImplementation(async () => []);
  });

  it("does not share the password secretRef with a cloned connection", async () => {
    const setValue = vi.fn();

    await act(async () => {
      root.render(
        <JdbcConnectionsSettingsEditor
          readonly={false}
          value={[
            {
              connectionId: "conn-1",
              title: "Prod",
              dialectId: "jdbc",
              url: "jdbc:test://prod",
              username: "admin",
              password: { secretRef: "secret-1" },
              enabled: true
            }
          ]}
          setValue={setValue}
        />
      );
      await flush();
    });

    const cloneButton = rootElement.querySelector<HTMLButtonElement>("button[title='Clone']");
    expect(cloneButton).toBeTruthy();

    await act(async () => {
      cloneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const latest = setValue.mock.calls[setValue.mock.calls.length - 1]?.[0] as Array<{
      connectionId: string;
      url?: string;
      username?: string;
      password?: { secretRef: string };
    }>;
    expect(latest).toHaveLength(2);
    expect(latest[0]?.password).toEqual({ secretRef: "secret-1" });
    expect(latest[1]?.connectionId).not.toBe("conn-1");
    expect(latest[1]?.url).toBe("jdbc:test://prod");
    expect(latest[1]?.username).toBe("admin");
    expect(latest[1]?.password).toBeUndefined();
  });

  it("says the form couldn't be loaded, not that the plugin is missing, when the backend's dialect list is unusable", async () => {
    invoke.mockImplementation(async () => null);

    await act(async () => {
      root.render(
        <JdbcConnectionsSettingsEditor
          readonly={false}
          value={[{ connectionId: "conn-1", title: "Prod", dialectId: "sqlserver", properties: { host: "db" }, enabled: true }]}
          setValue={vi.fn()}
        />
      );
      await flush();
    });

    expect(rootElement.textContent).toContain("couldn't be loaded from the backend");
    expect(rootElement.textContent).not.toContain("Loading the connection form");
  });
});
