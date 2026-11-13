import { useCallback, useEffect, useRef, useState } from "react";
import type { PasswordFieldInputProps } from "@queryeer/api/settings/SettingsExtension";
import { getCoreSecurityService } from "../core.security/service";

export function PasswordFieldInput({ inputId, valueRef, readonly = false, onChangeRef }: PasswordFieldInputProps): JSX.Element {
  const security = getCoreSecurityService();
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const draftRef = useRef(draft);
  const secretRefRef = useRef<string | undefined>(undefined);
  const editVersionRef = useRef(0);
  const persistedVersionRef = useRef(0);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const observedSecretRef = useRef<{ value: string | undefined } | undefined>(undefined);

  useEffect(() => {
    if (!security) {
      setUnlocked(false);
      return;
    }

    let cancelled = false;
    void security.getStatus().then((status) => {
      if (!cancelled) {
        setUnlocked(status.unlocked);
      }
    });

    const unsubscribe = security.subscribeStatus((status) => {
      if (!cancelled) {
        setUnlocked(status.unlocked);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [security]);

  const currentSecretRef = getSecretRef(valueRef);

  useEffect(() => {
    if (observedSecretRef.current?.value === currentSecretRef) {
      return;
    }
    observedSecretRef.current = { value: currentSecretRef };
    if (currentSecretRef === secretRefRef.current) {
      return;
    }
    secretRefRef.current = currentSecretRef;
    if (dirty) {
      return;
    }
    if (!currentSecretRef || !security) {
      draftRef.current = "";
      setDraft("");
      return;
    }

    const cached = security.peekSecret(currentSecretRef);
    const nextDraft = cached ?? "";
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setDirty(false);
  }, [dirty, security, currentSecretRef]);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (readonly || !security || !unlocked) {
      return false;
    }

    const draftToPersist = draft;
    const editVersion = editVersionRef.current;
    const persist = async (): Promise<boolean> => {
      if (editVersion <= persistedVersionRef.current) {
        return true;
      }

      try {
        if (!draftToPersist.trim()) {
          if (secretRefRef.current) {
            await security.deleteSecret(secretRefRef.current);
          }
          secretRefRef.current = undefined;
          onChangeRef(undefined);
        } else {
          const stored = await security.storeSecret(draftToPersist, secretRefRef.current);
          secretRefRef.current = stored.secretRef;
          onChangeRef({ secretRef: stored.secretRef });
        }

        persistedVersionRef.current = editVersion;
        if (draftRef.current === draftToPersist) {
          setDirty(false);
        }
        return true;
      } catch {
        return false;
      }
    };

    const result = writeChainRef.current.then(persist, persist);
    writeChainRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }, [draft, onChangeRef, readonly, security, unlocked]);

  const unlockVault = async (): Promise<void> => {
    if (!security || readonly) {
      return;
    }

    const accepted = await security.ensureUnlockedForSecretAccess({ interactive: true });
    setUnlocked(accepted);
  };

  useEffect(() => {
    if (!dirty || readonly || !security || !unlocked) {
      return;
    }

    const timer = setTimeout(() => {
      void persistDraft();
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [dirty, persistDraft, readonly, security, unlocked]);

  return (
    <div>
      <input
        id={inputId}
        type="password"
        className="settings-field-input"
        value={draft}
        readOnly={readonly || !security || !unlocked}
        autoComplete="off"
        onChange={(event) => {
          editVersionRef.current += 1;
          draftRef.current = event.target.value;
          setDraft(event.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (dirty) {
            void persistDraft();
          }
        }}
      />
      <div className="settings-password-actions">
        {!unlocked && <span className="settings-setting-id">Vault locked</span>}
        {currentSecretRef && <span className="settings-setting-id">Stored securely</span>}
        {!readonly && !unlocked && (
          <button
            type="button"
            className="settings-apply-button"
            onClick={() => {
              void unlockVault();
            }}
          >
            Unlock
          </button>
        )}
      </div>
    </div>
  );
}

function getSecretRef(valueRef: PasswordFieldInputProps["valueRef"]): string | undefined {
  if (typeof valueRef === "string") {
    return valueRef || undefined;
  }

  if (valueRef && typeof valueRef.secretRef === "string") {
    return valueRef.secretRef || undefined;
  }

  return undefined;
}
