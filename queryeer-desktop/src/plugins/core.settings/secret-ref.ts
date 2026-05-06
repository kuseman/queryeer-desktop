import type { SecretRefValue } from "../../contracts/security/Security";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSecretRefValue(value: unknown): SecretRefValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const secretRef = value.secretRef;
  return typeof secretRef === "string" && secretRef.trim()
    ? { secretRef: secretRef.trim() }
    : undefined;
}
