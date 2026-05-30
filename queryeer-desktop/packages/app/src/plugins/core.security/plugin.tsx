import type { Plugin } from "@queryeer/api/plugin/Plugin";
import {
  initializeCoreSecurityService,
  SECURITY_MASTER_PASSWORD_STORAGE_SETTING_ID,
  SECURITY_UNLOCK_MODE_SETTING_ID
} from "./service";

export const coreSecurityPlugin: Plugin = {
  manifest: {
    id: "core.security",
    name: "Core Security",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.settings"],
    providesCapabilities: ["security.vault"],
    description: "Centralized vault and security policy settings"
  },
  activate: (context) => {
    context.settings.registerSettings({
      moduleId: "core.security",
      title: "Security",
      order: 12,
      settings: [
        {
          id: SECURITY_UNLOCK_MODE_SETTING_ID,
          moduleId: "core.security",
          title: "Vault Unlock Mode",
          description: "Control when to unlock the security vault.",
          sectionPath: ["Security", "Vault"],
          tags: ["security", "vault", "unlock"],
          type: "enum",
          options: [
            {
              value: "first-use",
              label: "On First Use",
              description: "Ask for master password when a secret is first needed"
            },
            {
              value: "startup",
              label: "On Startup",
              description: "Attempt unlock during app startup"
            }
          ],
          defaultValue: "first-use"
        },
        {
          id: SECURITY_MASTER_PASSWORD_STORAGE_SETTING_ID,
          moduleId: "core.security",
          title: "Master Password Storage",
          description: "Choose whether to persist the master password in OS secure storage.",
          sectionPath: ["Security", "Vault"],
          tags: ["security", "vault", "master password", "safe storage"],
          type: "enum",
          options: [
            {
              value: "ask",
              label: "Ask Every Time",
              description: "Do not persist master password"
            },
            {
              value: "safeStorage",
              label: "Use OS Secure Storage",
              description: "Persist encrypted master password via Electron safeStorage"
            }
          ],
          defaultValue: "ask"
        }
      ]
    });

    const securityService = initializeCoreSecurityService(context.dialog);
    void securityService.maybeAutoUnlockAtStartup();
  }
};
