import { Type, type Static } from "@sinclair/typebox";

import type { PersonafyPluginConfig, PersonafyPosture } from "./types.js";
import {
  getActiveVault,
  addFact,
  deleteFact,
  getFactsByPersona,
  setPersona,
  getFieldValue,
} from "./vault.js";
import { getPosture, setPosture, isValidPosture } from "./posture.js";
import { requestContext } from "./context-engine.js";
import { getApprovalById, getPendingApprovals } from "./approval-queue.js";

// ---------------------------------------------------------------------------
// Result helper
// ---------------------------------------------------------------------------

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RequestContextSchema = Type.Object({
  persona: Type.String({ description: "The persona identifier to request context for" }),
  fields: Type.Array(Type.String(), {
    description: "Array of field names to retrieve from the vault",
  }),
  purpose: Type.String({ description: "Why this context is being requested" }),
  urgency: Type.Optional(
    Type.Union([Type.Literal("normal"), Type.Literal("urgent")], {
      description: "Request urgency level",
    }),
  ),
});

const ManageVaultSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("add_fact"),
      Type.Literal("remove_fact"),
      Type.Literal("list_personas"),
      Type.Literal("list_facts"),
      Type.Literal("get_posture"),
      Type.Literal("set_posture"),
      Type.Literal("add_persona_field"),
    ],
    { description: "The vault management action to perform" },
  ),
  persona: Type.Optional(Type.String({ description: "Target persona identifier" })),
  field: Type.Optional(Type.String({ description: "Field name for the action" })),
  value: Type.Optional(Type.String({ description: "Value to set or add" })),
});

const ApprovalStatusSchema = Type.Object({
  approval_id: Type.Optional(
    Type.String({
      description:
        "Specific approval ID to look up. If omitted, returns all pending approvals.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createPersonafyTools(cfg: PersonafyPluginConfig) {
  return [
    // -----------------------------------------------------------------------
    // personafy_request_context
    // -----------------------------------------------------------------------
    {
      name: "personafy_request_context",
      factory: (_ctx: unknown) => {
        if (!cfg.enabled) return null;
        const vault = getActiveVault();
        if (!vault) return null;

        return {
          label: "Request Personal Context",
          name: "personafy_request_context",
          description:
            "Request personal context from the Personafy vault. Retrieves specific fields " +
            "for a given persona, subject to the current disclosure posture and approval rules.",
          parameters: RequestContextSchema,
          async execute(
            _toolCallId: string,
            params: Static<typeof RequestContextSchema>,
          ) {
            const v = getActiveVault();
            if (!v) return jsonResult({ error: "Vault not available" });
            const result = requestContext(
              {
                agentId: "agent", // resolved from tool context in production
                requestType: "message",
                persona: params.persona,
                fields: params.fields,
                purpose: params.purpose,
                urgency: params.urgency ?? "normal",
              },
              v,
              cfg,
            );
            return jsonResult(result);
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    // personafy_manage_vault
    // -----------------------------------------------------------------------
    {
      name: "personafy_manage_vault",
      factory: (_ctx: unknown) => {
        if (!cfg.enabled) return null;
        const vault = getActiveVault();
        if (!vault) return null;

        return {
          label: "Manage Personafy Vault",
          name: "personafy_manage_vault",
          description:
            "Manage data in the Personafy vault. Supports adding/removing facts, " +
            "listing personas and facts, getting or setting the disclosure posture, " +
            "and adding new persona fields.",
          parameters: ManageVaultSchema,
          async execute(
            _toolCallId: string,
            params: Static<typeof ManageVaultSchema>,
          ) {
            const v = getActiveVault();
            if (!v) return jsonResult({ error: "Vault not available" });
            const { action, persona, field, value } = params;

            switch (action) {
              case "add_fact": {
                if (!persona || !field || !value) {
                  return jsonResult({ error: "add_fact requires persona, field, and value" });
                }
                const fact = addFact(v, persona, field, value);
                return jsonResult({ ok: true, fact });
              }

              case "remove_fact": {
                if (!field) {
                  return jsonResult({ error: "remove_fact requires field (fact id)" });
                }
                const removed = deleteFact(v, field);
                return jsonResult({ ok: removed });
              }

              case "list_personas": {
                const ids = Object.keys(v.personas);
                const personas = ids.map((id) => ({
                  id,
                  label: v.personas[id].label,
                  fieldCount: Object.keys(v.personas[id].fields).length,
                }));
                return jsonResult({ personas });
              }

              case "list_facts": {
                if (!persona) {
                  return jsonResult({ error: "list_facts requires persona" });
                }
                const facts = getFactsByPersona(v, persona);
                return jsonResult({ facts });
              }

              case "get_posture": {
                return jsonResult({ posture: getPosture(v) });
              }

              case "set_posture": {
                if (!value) {
                  return jsonResult({ error: "set_posture requires value (open|guarded|locked)" });
                }
                if (!isValidPosture(value)) {
                  return jsonResult({ error: `Invalid posture: "${value}". Must be one of: open, guarded, locked` });
                }
                setPosture(v, value);
                return jsonResult({ ok: true, posture: getPosture(v) });
              }

              case "add_persona_field": {
                if (!persona || !field) {
                  return jsonResult({ error: "add_persona_field requires persona and field" });
                }
                const existing = v.personas[persona];
                setPersona(v, persona, existing?.label ?? persona, {
                  ...(existing?.fields ?? {}),
                  [field]: value ?? "",
                });
                return jsonResult({ ok: true });
              }

              default:
                return jsonResult({ error: `Unknown action: ${action}` });
            }
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    // personafy_approval_status
    // -----------------------------------------------------------------------
    {
      name: "personafy_approval_status",
      factory: (_ctx: unknown) => {
        if (!cfg.enabled) return null;
        const vault = getActiveVault();
        if (!vault) return null;

        return {
          label: "Check Approval Status",
          name: "personafy_approval_status",
          description:
            "Check the status of context disclosure approvals. If an approval_id is " +
            "provided, returns the status of that specific approval. Otherwise, returns " +
            "all currently pending approvals.",
          parameters: ApprovalStatusSchema,
          async execute(
            _toolCallId: string,
            params: Static<typeof ApprovalStatusSchema>,
          ) {
            const v = getActiveVault();
            if (!v) return jsonResult({ error: "Vault not available" });

            if (params.approval_id) {
              const approval = getApprovalById(v, params.approval_id);
              if (!approval) {
                return jsonResult({ error: `Approval not found: ${params.approval_id}` });
              }
              return jsonResult(approval);
            }

            const pending = getPendingApprovals(v);
            return jsonResult({ pending });
          },
        };
      },
    },
  ];
}
