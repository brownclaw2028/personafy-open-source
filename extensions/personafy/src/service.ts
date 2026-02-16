import type { OpenClawPluginService, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import type { PersonafyPluginConfig } from "./types.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./types.js";
import { loadVault, saveVault, setActiveVault, getActiveVault, pruneAuditLog } from "./vault.js";
import { expireStaleApprovals, pruneResolvedApprovals } from "./approval-queue.js";
import { expireScheduledRules } from "./scheduled-rules.js";
import { initPostHogNode, captureEvent, shutdownPostHog } from "./posthog.js";

let _maintenanceInterval: ReturnType<typeof setInterval> | null = null;

export function createPersonafyService(cfg: PersonafyPluginConfig): OpenClawPluginService {
  return {
    id: "personafy",

    async start(ctx: OpenClawPluginServiceContext) {
      // Load vault from stateDir (no encryption passphrase for now — can be added via config)
      const vault = await loadVault(ctx.stateDir, undefined, cfg.defaultPosture);
      setActiveVault(vault);

      initPostHogNode(cfg.posthogApiKey);

      // Initial maintenance
      const expiredApprovals = expireStaleApprovals(vault);
      const expiredRules = expireScheduledRules(vault);
      const prunedAudit = pruneAuditLog(vault, cfg.auditRetentionDays * 24 * 60 * 60 * 1000);
      pruneResolvedApprovals(vault);

      if (expiredApprovals > 0 || expiredRules > 0 || prunedAudit > 0) {
        ctx.logger.info(
          `Personafy maintenance: expired ${expiredApprovals} approvals, ${expiredRules} rules, pruned ${prunedAudit} audit entries`
        );
        await saveVault(ctx.stateDir, vault);
      }

      ctx.logger.info(
        `Personafy vault loaded (posture: ${vault.posture}, personas: ${Object.keys(vault.personas).length})`
      );

      captureEvent("service_started", {
        posture: vault.posture,
        persona_count: Object.keys(vault.personas).length,
      });

      // Periodic maintenance every 5 minutes
      const intervalId = setInterval(async () => {
        const v = getActiveVault();
        if (!v) return;
        const ea = expireStaleApprovals(v);
        const er = expireScheduledRules(v);
        if (ea > 0 || er > 0) {
          await saveVault(ctx.stateDir, v).catch((err) => {
            ctx.logger.warn(`Personafy: failed to save vault during maintenance: ${err}`);
          });
        }
      }, 5 * 60 * 1000);

      // Store interval for cleanup
      _maintenanceInterval = intervalId;
    },

    async stop(ctx: OpenClawPluginServiceContext) {
      if (_maintenanceInterval) {
        clearInterval(_maintenanceInterval);
        _maintenanceInterval = null;
      }
      const vault = getActiveVault();
      if (vault) {
        await saveVault(ctx.stateDir, vault).catch((err) => {
          ctx.logger.warn(`Personafy: failed to save vault on shutdown: ${err}`);
        });
        ctx.logger.info("Personafy vault saved and shut down");
      }
      captureEvent("service_stopped", {});
      await shutdownPostHog();
    },
  };
}
