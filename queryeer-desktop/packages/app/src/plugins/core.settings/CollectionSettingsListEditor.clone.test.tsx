import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretRefValue } from "@queryeer/api/security/Security";

const mocks = vi.hoisted(() => ({
  releaseStore: (): void => undefined,
  security: {
    getStatus: async () => ({ unlocked: true, hasPersistedVault: true, hasStoredMasterPassword: false }),
    subscribeStatus: () => () => undefined,
    peekSecret: () => undefined,
    ensureUnlockedForSecretAccess: async () => true,
    storeSecret: undefined as unknown,
    deleteSecret: async () => ({ deleted: true })
  }
}));

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: () => mocks.security
}));

import { CollectionSettingsListEditor } from "./CollectionSettingsListEditor";
import { PasswordFieldInput } from "./PasswordFieldInput";

void React;

type Row = { id: string; password?: SecretRefValue };

describe("CollectionSettingsListEditor clone", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("waits for a password typed just before Clone to be saved, so the clone sees its ref", async () => {
    mocks.security.storeSecret = vi.fn(
      () =>
        new Promise<{ secretRef: string }>((resolve) => {
          mocks.releaseStore = () => resolve({ secretRef: "typed" });
        })
    );
    const clonedFrom: Array<SecretRefValue | undefined> = [];

    function Editor(): JSX.Element {
      const [rows, setRows] = useState<Row[]>([{ id: "a" }]);
      const rowsRef = useRef(rows);
      const update = (password: SecretRefValue | undefined): void => {
        rowsRef.current = rowsRef.current.map((row) => (row.id === "a" ? { ...row, password } : row));
        setRows(rowsRef.current);
      };
      return (
        <CollectionSettingsListEditor
          items={rows.map((row) => ({ id: row.id, label: row.id }))}
          selectedId="a"
          readonly={false}
          onSelect={() => undefined}
          onAdd={() => undefined}
          onClone={(id) => clonedFrom.push(rowsRef.current.find((row) => row.id === id)?.password)}
          onDelete={() => undefined}
          renderDetails={() => <PasswordFieldInput inputId="pw" valueRef={rows[0].password} onChangeRef={update} />}
        />
      );
    }

    await act(async () => {
      root.render(<Editor />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector<HTMLInputElement>("#pw")!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new-pass");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Clone right away: the field is still focused and its save hasn't started
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[title='Clone']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.security.storeSecret).toHaveBeenCalledWith("new-pass", undefined);
    expect(clonedFrom).toEqual([]);

    await act(async () => {
      mocks.releaseStore();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(clonedFrom).toEqual([{ secretRef: "typed" }]);
  });
});
