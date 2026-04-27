import { useEffect, useState } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
import { getCoreSecurityService } from "../core.security/service";

type Props = {
  inputId: string;
  valueRef: string | SecretRefValue | undefined;
  readonly: boolean;
  onChangeRef: (nextRef: SecretRefValue | undefined) => void;
};

export function PasswordFieldInput({ inputId, valueRef, readonly, onChangeRef }: Props): JSX.Element {
  const security = getCoreSecurityService();
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

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

    return () => {
      cancelled = true;
    };
  }, [security]);

  const currentSecretRef = getSecretRef(valueRef);

  useEffect(() => {
    if (!currentSecretRef || !security) {
      setDraft("");
      return;
    }

    const cached = security.peekSecret(currentSecretRef);
    setDraft(cached ?? "");
    setDirty(false);
  }, [security, currentSecretRef]);

  const persistDraft = async (): Promise<boolean> => {
    if (readonly || !security || !unlocked) {
      return false;
    }

    try {
      if (!draft.trim()) {
        if (currentSecretRef) {
          await security.deleteSecret(currentSecretRef);
        }
        onChangeRef(undefined);
        setDirty(false);
        return true;
      }

      const stored = await security.storeSecret(draft, currentSecretRef);
      onChangeRef({ secretRef: stored.secretRef });
      setDirty(false);
      return true;
    } catch {
      return false;
    }
  };

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
  }, [draft, dirty, readonly, security]);

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

function getSecretRef(valueRef: string | SecretRefValue | undefined): string | undefined {
  if (typeof valueRef === "string") {
    return valueRef || undefined;
  }

  if (valueRef && typeof valueRef.secretRef === "string") {
    return valueRef.secretRef || undefined;
  }

  return undefined;
}
