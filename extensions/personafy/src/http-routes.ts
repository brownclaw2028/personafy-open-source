import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PersonafyPluginConfig } from "./types.js";
import { resolveApproval, getApprovalById, getPendingApprovals } from "./approval-queue.js";
import { getDemoHtml } from "./demo-ui.js";
import {
  createDemoVault,
  listDemoScenarios,
  runDemoScenario,
  executeDemoAction,
  getOrCreateSession,
} from "./demo.js";
import { getPosture } from "./posture.js";
import { getActiveVault } from "./vault.js";

// ── Helpers ──────────────────────────────────────────────────────────

const MAX_BODY_SIZE = 1_048_576; // 1 MB

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function isAuthorized(req: IncomingMessage): boolean {
  const secret = process.env.PERSONAFY_HTTP_SECRET;
  if (!secret) return false;
  const authHeader = req.headers["authorization"];
  if (typeof authHeader !== "string") return false;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return token.length > 0 && timingSafeEqual(hash(token), hash(secret));
}

function extractPathParam(url: string, prefix: string): string | null {
  // Given a URL like "/personafy/approve/abc-123" and prefix "/personafy/approve/"
  // returns "abc-123"
  const pathOnly = url.split("?")[0];
  if (!pathOnly.startsWith(prefix)) return null;
  const segment = pathOnly.slice(prefix.length).split("/")[0];
  return segment || null;
}

// ── Route registration ───────────────────────────────────────────────

export function registerPersonafyHttpRoutes(
  api: OpenClawPluginApi,
  cfg: PersonafyPluginConfig,
): void {
  // Intentionally unauthenticated: local-only status endpoint
  // ── GET /personafy/status ──────────────────────────────────────────
  api.registerHttpRoute({
    path: "/personafy/status",
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      const vault = getActiveVault();
      if (!vault) {
        sendJson(res, 503, { ok: false, error: "Vault not initialized" });
        return;
      }

      const pending = getPendingApprovals(vault);

      sendJson(res, 200, {
        ok: true,
        posture: getPosture(vault),
        pendingApprovals: pending.length,
        enabled: cfg.enabled,
      });
    },
  });

  // ── POST /personafy/approve/:id ────────────────────────────────────
  api.registerHttpRoute({
    path: "/personafy/approve",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      if (!isAuthorized(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const vault = getActiveVault();
      if (!vault) {
        sendJson(res, 503, { ok: false, error: "Vault not initialized" });
        return;
      }

      const url = req.url ?? "";
      const id = extractPathParam(url, "/personafy/approve/");

      if (!id) {
        sendJson(res, 400, { ok: false, error: "Missing approval id" });
        return;
      }

      const approval = getApprovalById(vault, id);
      if (!approval) {
        sendJson(res, 404, { ok: false, error: "not found" });
        return;
      }

      resolveApproval(vault, id, "approved");
      sendJson(res, 200, { ok: true });
    },
  });

  // Intentionally unauthenticated: demo feature
  // ── GET /personafy/demo ─────────────────────────────────────────────
  api.registerHttpRoute({
    path: "/personafy/demo",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      // Serve HTML for GET, reject other methods
      const url = req.url ?? "";
      const pathOnly = url.split("?")[0];

      // Handle the API sub-route
      if (pathOnly === "/personafy/demo/api") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const body = await readBody(req);
        let parsed: { action?: string; params?: Record<string, unknown> };
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { ok: false, error: "Invalid JSON" });
          return;
        }

        const action = parsed.action;
        const params = parsed.params ?? {};
        const sessionId = (req.headers["x-demo-session"] as string) || "default";
        const session = getOrCreateSession(sessionId);

        switch (action) {
          case "create_vault": {
            session.vault = createDemoVault();
            sendJson(res, 200, { ok: true });
            return;
          }
          case "list_scenarios": {
            sendJson(res, 200, { ok: true, scenarios: listDemoScenarios() });
            return;
          }
          case "run_scenario": {
            const scenarioId = params.scenarioId as string;
            if (!scenarioId) {
              sendJson(res, 400, { ok: false, error: "Missing scenarioId" });
              return;
            }
            const result = runDemoScenario(scenarioId, session.vault, session.config);
            if (!result) {
              sendJson(res, 404, { ok: false, error: "Scenario not found" });
              return;
            }
            sendJson(res, 200, { ok: true, ...result });
            return;
          }
          case "execute_action": {
            const actionName = params.action as string;
            if (!actionName) {
              sendJson(res, 400, { ok: false, error: "Missing action in params" });
              return;
            }
            const actionResult = executeDemoAction(
              actionName,
              params,
              session.vault,
              session.config,
            );
            sendJson(res, 200, actionResult);
            return;
          }
          case "get_state": {
            const stateResult = executeDemoAction("get_state", {}, session.vault, session.config);
            sendJson(res, 200, stateResult);
            return;
          }
          default:
            sendJson(res, 400, { ok: false, error: `Unknown action: ${action}` });
            return;
        }
      }

      // Serve the HTML page
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getDemoHtml());
    },
  });
}
