import type { HarnessToolRegistry } from "@exo/harness";

import { registerHostTool } from "./host-tools";

// Read-only introspection over the agent's canonical exoharness event log.
export function registerIntrospectionTools(
  registry: HarnessToolRegistry,
): void {
  registerHostTool(registry, {
    name: "list_conversation_events",
    description:
      "List this conversation's canonical event log, newest first. By default returns lifecycle and host events only: conversation_created, conversation_forked, session_started, session_ended, error, sandbox_created, sandbox_started, sandbox_stopped, sandbox_snapshotted, host_reboot (planned host restart with reason), adapter_runner_started (a start without a preceding host_reboot implies a crash or manual restart), and adapter_runner_draining (graceful shutdown began). Pass explicit kinds to query other event types (e.g. tool_requested, tool_result, messages — these can be very large). Use this to reconstruct restarts, crashes, and session history. Read-only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kinds: {
          type: ["array", "null"],
          items: { type: "string" },
          description:
            "Event kinds to return. Null for the default lifecycle/host set described above.",
        },
        limit: {
          type: ["number", "null"],
          description:
            "Maximum events to return (default 50, capped at 200). Null for the default.",
        },
        cursor: {
          type: ["string", "null"],
          description:
            "Event id cursor from a previous call's result for pagination. Null to start from the newest (or oldest for asc) event.",
        },
        direction: {
          type: ["string", "null"],
          enum: ["asc", "desc", null],
          description: "Listing order. Null for desc (newest first).",
        },
      },
      required: ["kinds", "limit", "cursor", "direction"],
    },
  });
}
