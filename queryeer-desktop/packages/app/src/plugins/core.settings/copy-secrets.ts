import { getCoreSecurityService } from "../core.security/service";
import { copySecretRefs } from "./secret-ref";

/**
 * `context.settings.copySecrets`: `value` with its own vault copy of every secret, for a clone. Without the security
 * service (tests), secrets are left out.
 */
export function copySettingSecrets<T>(value: T): Promise<T> {
  const security = getCoreSecurityService();
  return copySecretRefs(value, async (secretRef) => (security ? security.copySecret(secretRef) : undefined));
}
