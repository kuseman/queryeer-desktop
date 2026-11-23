import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, securityHolder } = vi.hoisted(() => ({
  invoke: vi.fn<() => Promise<unknown>>(async () => []),
  securityHolder: { current: undefined as unknown }
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke })
}));

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: () => securityHolder.current
}));

import { JdbcConnectionsSettingsEditor } from "./JdbcConnectionsSettingsEditor";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A locked vault that can only copy secrets, as copying needs no unlock. */
function lockedVault(copySecret: (secretRef: string) => Promise<string | undefined>): unknown {
  return {
    getStatus: async () => ({ unlocked: false, hasPersistedVault: true, hasStoredMasterPassword: false }),
    subscribeStatus: () => () => undefined,
    peekSecret: () => undefined,
    copySecret
  };
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
    securityHolder.current = undefined;
  });

  it("gives a cloned connection its own copy of the password", async () => {
    const copySecret = vi.fn(async (secretRef: string) => `${secretRef}-copy`);
    securityHolder.current = lockedVault(copySecret);
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
    expect(copySecret).toHaveBeenCalledWith("secret-1");
    expect(latest[1]?.password).toEqual({ secretRef: "secret-1-copy" });
  });

  it("clones a connection without a password when the secret can't be copied", async () => {
    securityHolder.current = lockedVault(async () => undefined);
    const setValue = vi.fn();

    await act(async () => {
      root.render(
        <JdbcConnectionsSettingsEditor
          readonly={false}
          value={[{ connectionId: "conn-1", title: "Prod", dialectId: "jdbc", url: "jdbc:test://prod", password: { secretRef: "gone" }, enabled: true }]}
          setValue={setValue}
        />
      );
      await flush();
    });
    await act(async () => {
      rootElement.querySelector<HTMLButtonElement>("button[title='Clone']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const latest = setValue.mock.calls[setValue.mock.calls.length - 1]?.[0] as Array<{ password?: { secretRef: string } }>;
    expect(latest).toHaveLength(2);
    expect(latest[0]?.password).toEqual({ secretRef: "gone" });
    expect(latest[1]?.password).toBeUndefined();
  });

  it("edits and clears only the clone's own copy of the password", async () => {
    let releaseStore: () => void = () => undefined;
    const storeSecret = vi.fn((_plaintext: string, secretRef?: string) =>
      new Promise<{ secretRef: string }>((resolve) => {
        releaseStore = () => resolve({ secretRef: secretRef ?? "secret-new" });
      })
    );
    const deleteSecret = vi.fn(async () => ({ deleted: true }));
    securityHolder.current = {
      getStatus: async () => ({ unlocked: true, hasPersistedVault: true, hasStoredMasterPassword: false }),
      subscribeStatus: () => () => undefined,
      peekSecret: () => "old-pass",
      storeSecret,
      deleteSecret,
      copySecret: async () => "secret-1-copy",
      ensureUnlockedForSecretAccess: async () => true
    };
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

    const passwordInput = (): HTMLInputElement => rootElement.querySelector<HTMLInputElement>("input[type='password']")!;
    const typeInto = (input: HTMLInputElement, text: string): void => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    // Edit the source's password, then click Clone before the save has finished
    await act(async () => {
      typeInto(passwordInput(), "new-pass");
      await flush();
    });
    await act(async () => {
      passwordInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      rootElement.querySelector<HTMLButtonElement>("button[title='Clone']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(storeSecret).toHaveBeenCalledWith("new-pass", "secret-1");
    await act(async () => {
      releaseStore();
      await flush();
    });

    // The clone has its own copy; editing and clearing it must not touch the source's vault entry
    await act(async () => {
      typeInto(passwordInput(), "clone-pass");
      await flush();
    });
    await act(async () => {
      passwordInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await flush();
    });
    expect(storeSecret).toHaveBeenLastCalledWith("clone-pass", "secret-1-copy");
    await act(async () => {
      releaseStore();
      await flush();
    });
    await act(async () => {
      typeInto(passwordInput(), "");
      await flush();
    });
    await act(async () => {
      passwordInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await flush();
    });

    expect(deleteSecret).toHaveBeenCalledWith("secret-1-copy");
    expect(deleteSecret).not.toHaveBeenCalledWith("secret-1");
    // The cleared password is saved with the settings' debounce
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const latest = setValue.mock.calls[setValue.mock.calls.length - 1]?.[0] as Array<{ password?: { secretRef: string } }>;
    expect(latest[0]?.password).toEqual({ secretRef: "secret-1" });
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
