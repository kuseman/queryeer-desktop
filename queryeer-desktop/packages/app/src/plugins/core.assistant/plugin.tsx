import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { AssistantConnectionsSettingsEditor } from "./assistant-settings";
import {
  ASSISTANT_CONNECTIONS_RENDERER_ID,
  ASSISTANT_CONNECTIONS_SETTING_ID
} from "./assistant-types";
import { AssistantChatView } from "./chat/AssistantChatView";
import "./assistant.css";

export const coreAssistantPlugin: Plugin = {
  manifest: {
    id: "core.assistant",
    name: "Core Assistant",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.layout", "core.settings", "core.security"],
    providesCapabilities: ["assistant.core"],
    description: "Assistant provider settings and chat foundation"
  },
  activate: (context) => {
    context.settings.registerAdvancedRenderer({
      id: ASSISTANT_CONNECTIONS_RENDERER_ID,
      render: ({ value, setValue, readonly }) => (
        <AssistantConnectionsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.assistant",
      title: "Assistant",
      order: 35,
      settings: [
        {
          id: ASSISTANT_CONNECTIONS_SETTING_ID,
          moduleId: "core.assistant",
          title: "Assistant Providers",
          description: "Configured OpenAI-compatible assistant providers and API keys.",
          sectionPath: ["Assistant", "Providers"],
          tags: ["assistant", "ai", "openai", "lm studio", "models"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: ASSISTANT_CONNECTIONS_RENDERER_ID
          }
        }
      ]
    });

    getCoreSettingsService()?.refreshSchemaFromRegistry();
    void getCoreSettingsService()?.syncRegistryModules();

    context.commands.registerCommand({
      id: "core.assistant.openSettings",
      title: "Open Assistant Settings",
      category: "Preferences",
      handler: () => {
        getCoreSettingsService()?.openModalForSetting(ASSISTANT_CONNECTIONS_SETTING_ID);
      }
    });

    context.layout.registerView({
      id: "core.assistant.chat",
      title: "Assistant",
      defaultZone: "secondarySidebar",
      order: 1000,
      canMoveZones: true,
      canCollapse: true,
      isOpen: false,
      flex: 1,
      minHeight: 180,
      panelActions: [
        {
          id: "core.assistant.chat.settings",
          icon: "⚙",
          title: "Assistant Settings",
          commandId: "core.assistant.openSettings"
        }
      ],
      render: () => <AssistantChatView context={context} />
    });
  }
};
