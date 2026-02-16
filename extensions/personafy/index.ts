import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PersonafyPluginConfig } from "./src/types.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./src/types.js";
import { createPersonafyTools } from "./src/tools.js";
import { createPersonafyService } from "./src/service.js";
import { registerPersonafyHooks } from "./src/hooks.js";
import { registerPersonafyGatewayMethods } from "./src/gateway-methods.js";
import { registerPersonafyHttpRoutes } from "./src/http-routes.js";

function resolveConfig(pluginConfig?: Record<string, unknown>): PersonafyPluginConfig {
  const resolved = {
    ...DEFAULT_PERSONAFY_CONFIG,
    ...(pluginConfig as Partial<PersonafyPluginConfig>),
  };
  if (!resolved.posthogApiKey) {
    resolved.posthogApiKey = process.env.POSTHOG_API_KEY;
  }
  return resolved;
}

const personafyPlugin = {
  id: "personafy",
  name: "Personafy",
  description: "Privacy-first personal context vault — gates access to user data with approval flows",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        defaultPosture: {
          type: "string",
          enum: ["open", "guarded", "locked"],
          default: "guarded",
        },
        approvalExpiryMs: { type: "number", default: 86400000 },
        auditRetentionDays: { type: "number", default: 90 },
        scheduledRuleDefaultExpiryDays: { type: "number", default: 30 },
        preWarmMinutes: { type: "number", default: 5 },
        notificationChannel: { type: "string" },
        posthogApiKey: { type: "string" },
      },
    },
    uiHints: {
      enabled: { label: "Enable Personafy", help: "Enable the personal context vault" },
      defaultPosture: {
        label: "Default Posture",
        help: "open = auto-approve matching rules, guarded = always prompt, locked = deny all",
      },
      approvalExpiryMs: {
        label: "Approval Expiry (ms)",
        help: "How long async approval requests stay pending",
        advanced: true,
      },
      notificationChannel: {
        label: "Notification Channel",
        help: "Channel ID for push approval notifications (e.g. whatsapp, telegram)",
      },
      posthogApiKey: {
        label: "PostHog API Key",
        help: "PostHog project API key for server-side analytics (falls back to POSTHOG_API_KEY env var)",
        advanced: true,
      },
    },
  },
  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    if (!cfg.enabled) return;

    // Tools
    const tools = createPersonafyTools(cfg);
    for (const tool of tools) {
      api.registerTool(tool.factory, { names: [tool.name] });
    }

    // Service
    api.registerService(createPersonafyService(cfg));

    // Lifecycle hooks
    registerPersonafyHooks(api, cfg);

    // Gateway RPC methods
    registerPersonafyGatewayMethods(api, cfg);

    // HTTP routes
    registerPersonafyHttpRoutes(api, cfg);
  },
};

export default personafyPlugin;
