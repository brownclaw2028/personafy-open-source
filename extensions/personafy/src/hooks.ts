import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PersonafyPluginConfig } from "./types.js";
import { getActiveVault } from "./vault.js";
import { expireStaleApprovals, getPendingApprovals } from "./approval-queue.js";
import { expireScheduledRules } from "./scheduled-rules.js";
import { isVaultLocked } from "./posture.js";
import { captureEvent } from "./posthog.js";

export function registerPersonafyHooks(
  api: OpenClawPluginApi,
  cfg: PersonafyPluginConfig,
): void {
  // ---------------------------------------------------------------
  // gateway_start  (priority 5)
  // ---------------------------------------------------------------
  api.on(
    "gateway_start",
    (_event, _ctx) => {
      api.logger.info("Personafy vault initialized");

      const vault = getActiveVault();
      if (!vault) return;

      const expiredRules = expireScheduledRules(vault);
      const expiredApprovals = expireStaleApprovals(vault);
      const pendingCount = getPendingApprovals(vault).length;

      api.logger.info(
        `Personafy: ${pendingCount} pending approvals, ${expiredRules} expired rules cleaned, ${expiredApprovals} expired approvals cleaned`,
      );

      captureEvent("gateway_start", {
        pending_approvals: pendingCount,
        posture: vault.posture,
        persona_count: Object.keys(vault.personas).length,
      });
    },
    { priority: 5 },
  );

  // ---------------------------------------------------------------
  // before_agent_start  (priority 10)
  // Inject vault status into the agent context.
  // ---------------------------------------------------------------
  api.on(
    "before_agent_start",
    (_event, _ctx) => {
      const vault = getActiveVault();
      if (!vault) return undefined;

      if (isVaultLocked(vault)) {
        captureEvent("agent_start", {
          posture: vault.posture,
          vault_locked: true,
          pending_approvals: 0,
        });
        return {
          prependContext:
            "[Personafy] Vault is LOCKED \u2014 personal context is unavailable for this session.",
        };
      }

      const pendingCount = getPendingApprovals(vault).length;
      const personaIds = Object.keys(vault.personas);

      const lines: string[] = [`[Personafy] Posture: ${vault.posture}`];

      if (pendingCount > 0) {
        lines.push(`[Personafy] Pending approvals: ${pendingCount}`);
      }

      if (personaIds.length > 0) {
        lines.push(`[Personafy] Available personas: ${personaIds.join(", ")}`);
      }

      captureEvent("agent_start", {
        posture: vault.posture,
        vault_locked: false,
        pending_approvals: pendingCount,
      });

      return { prependContext: lines.join("\n") };
    },
    { priority: 10 },
  );

  // ---------------------------------------------------------------
  // agent_end  (priority 0)
  // ---------------------------------------------------------------
  api.on(
    "agent_end",
    (_event, _ctx) => {
      // Placeholder for future session telemetry
    },
    { priority: 0 },
  );

  // ---------------------------------------------------------------
  // gateway_stop  (priority 0)
  // ---------------------------------------------------------------
  api.on(
    "gateway_stop",
    (_event, _ctx) => {
      api.logger.info("Personafy vault shutting down");
    },
    { priority: 0 },
  );
}
