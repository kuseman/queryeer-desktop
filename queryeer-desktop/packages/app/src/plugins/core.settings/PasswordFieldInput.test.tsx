import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityStatus } from "@queryeer/api/security/Security";

const mocks = vi.hoisted(() => {
  const listeners = new Set<(status: SecurityStatus) => void>();
  let unlocked = false;

  return {
    emitStatus: (status: SecurityStatus) => {
      unlocked = status.unlocked;
      for (const listener of listeners) {
        listener(status);
      }
    },
    security: {
      getStatus: vi.fn(async () => ({
        unlocked,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      })),
      subscribeStatus: vi.fn((listener: (status: SecurityStatus) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      peekSecret: vi.fn(() => undefined),
      ensureUnlockedForSecretAccess: vi.fn(async () => false),
      storeSecret: vi.fn(async () => ({ secretRef: "secret-1" })),
      deleteSecret: vi.fn(async () => ({ deleted: true }))
    },
    reset: () => {
      unlocked = false;
      listeners.clear();
      mocks.security.getStatus.mockClear();
      mocks.security.subscribeStatus.mockClear();
      mocks.security.peekSecret.mockClear();
      mocks.security.ensureUnlockedForSecretAccess.mockClear();
      mocks.security.storeSecret.mockClear();
      mocks.security.deleteSecret.mockClear();
    }
  };
});

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: () => mocks.security
}));

import { PasswordFieldInput } from "./PasswordFieldInput";

void React;

describe("PasswordFieldInput", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    mocks.reset();
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("unlocks all password inputs when status changes globally", async () => {
    await act(async () => {
      root.render(
        <div>
          <PasswordFieldInput inputId="secret-1" valueRef={undefined} readonly={false} onChangeRef={vi.fn()} />
          <PasswordFieldInput inputId="secret-2" valueRef={undefined} readonly={false} onChangeRef={vi.fn()} />
        </div>
      );
    });

    const before = Array.from(rootElement.querySelectorAll("input[type='password']")) as HTMLInputElement[];
    expect(before).toHaveLength(2);
    expect(before.every((x) => x.readOnly)).toBe(true);

    await act(async () => {
      mocks.emitStatus({ unlocked: true, hasPersistedVault: true, hasStoredMasterPassword: false });
    });

    const after = Array.from(rootElement.querySelectorAll("input[type='password']")) as HTMLInputElement[];
    expect(after.every((x) => !x.readOnly)).toBe(true);
  });
});
