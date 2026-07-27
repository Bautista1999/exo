import { describe, expect, it } from "vitest";

import { toolResultMessage, type Event, type Message } from "@exo/harness";

import {
  hydrateToolResultsForVision,
  materializeExoWorkerEventsToMessages,
  repairLinguaToolPairing,
} from "./message-materialize.js";

describe("materializeExoWorkerEventsToMessages", () => {
  it("keeps parallel tool results when names only appear in messages events", () => {
    const events: Event[] = [
      {
        id: "1",
        conversationId: "conversation",
        createdAt: "2026-01-01T00:00:00Z",
        data: {
          type: "messages",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool_call",
                  tool_call_id: "call_a",
                  tool_name: "task_tree_update_status",
                  arguments: {},
                },
                {
                  type: "tool_call",
                  tool_call_id: "call_b",
                  tool_name: "task_tree_update_status",
                  arguments: {},
                },
              ],
            },
          ],
        },
      },
      {
        id: "2",
        conversationId: "conversation",
        createdAt: "2026-01-01T00:00:01Z",
        data: {
          type: "tool_result",
          tool_call_id: "call_a",
          result: { ok: true, value: { status: "in_progress" } },
        },
      },
      {
        id: "3",
        conversationId: "conversation",
        createdAt: "2026-01-01T00:00:02Z",
        data: {
          type: "tool_result",
          tool_call_id: "call_b",
          result: { ok: true, value: { status: "completed" } },
        },
      },
    ];

    expect(materializeExoWorkerEventsToMessages(events)).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_a",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
          {
            type: "tool_call",
            tool_call_id: "call_b",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      toolResultMessage("call_a", "task_tree_update_status", {
        ok: true,
        value: { status: "in_progress" },
      }),
      toolResultMessage("call_b", "task_tree_update_status", {
        ok: true,
        value: { status: "completed" },
      }),
    ]);
  });
});

describe("repairLinguaToolPairing", () => {
  it("coalesces split assistant rows before pairing tool results", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Running tools in parallel." }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_a",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_b",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      toolResultMessage("call_a", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
      toolResultMessage("call_b", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
    ];

    expect(repairLinguaToolPairing(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running tools in parallel." },
          {
            type: "tool_call",
            tool_call_id: "call_a",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
          {
            type: "tool_call",
            tool_call_id: "call_b",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      toolResultMessage("call_a", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
      toolResultMessage("call_b", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
    ]);
  });

  it("synthesizes missing tool results after parallel assistant tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_a",
            tool_name: "task_tree_init",
            arguments: {},
          },
          {
            type: "tool_call",
            tool_call_id: "call_b",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      toolResultMessage("call_b", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
    ];

    expect(repairLinguaToolPairing(messages)).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_a",
            tool_name: "task_tree_init",
            arguments: {},
          },
          {
            type: "tool_call",
            tool_call_id: "call_b",
            tool_name: "task_tree_update_status",
            arguments: {},
          },
        ],
      },
      toolResultMessage("call_b", "task_tree_update_status", {
        ok: true,
        value: {},
      }),
      toolResultMessage("call_a", "task_tree_init", {
        ok: false,
        error: "tool result missing from event log; synthesized by ExoWorker",
      }),
    ]);
  });
});

describe("hydrateToolResultsForVision", () => {
  // Distinct JPEG-shaped payloads so we can assert they never reappear as text.
  const fakeJpegA =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAACBQYBB//EADUQAAIBAwIEBAMEAgMAAAAAAAECAwAEERIhBTFBEyJRYXGBkaGxBjLB0fAHFSNCYvEZ/8QAGQEAAwEBAQAAAAAAAAAAAAAAAAECAwQF/8QAIhEAAgICAgMBAQEAAAAAAAAAAAECERIhAzFBBFEiYXEy/9oADAMBAAIRAxEAPwD1SlKBRSv/2Q==";
  const fakeJpegB =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAACBQYBB//EADUQAAIBAwIEBAMEAgMAAAAAAAECAwAEERIhBTFBEyJRYXGBkaGxBjLB0fAHFSNCYvEZ/8QAGQEAAwEBAQAAAAAAAAAAAAAAAAECAwQF/8QAIhEAAgICAgMBAQEAAAAAAAAAAAECERIhAzFBBFEiYXEy/9oADAMBAAIRAxEAPwD2TmKBRSv/2Q==";

  it("attaches screenshot bytes as a user image message after the tool result", async () => {
    const conversation = {
      async readArtifactText() {
        return null;
      },
    };

    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "shot_1",
            tool_name: "screenshotUrl",
            arguments: {},
          },
        ],
      },
      toolResultMessage("shot_1", "screenshotUrl", {
        success: true,
        title: "Example",
        url: "https://example.com",
        screenshotBase64: fakeJpegA,
      }),
    ];

    const hydrated = await hydrateToolResultsForVision(
      conversation as never,
      messages,
    );
    const repaired = repairLinguaToolPairing(hydrated);

    expect(repaired).toHaveLength(3);
    expect(repaired[1]?.role).toBe("tool");
    const toolOut = (
      repaired[1]!.content as Array<{ output?: Record<string, unknown> }>
    )[0]?.output;
    expect(toolOut?.screenshotBase64).toBeUndefined();
    expect(toolOut?.screenshotBase64Omitted).toBe(true);

    expect(repaired[2]?.role).toBe("user");
    const parts = repaired[2]!.content as Array<{
      type?: string;
      image?: string;
    }>;
    expect(parts.some((p) => p.type === "image" && p.image === fakeJpegA)).toBe(
      true,
    );
  });

  it("shows nested slide previews once, then strips them from later rounds", async () => {
    let artifactReads = 0;
    const artifactJson = JSON.stringify({
      success: true,
      slides: [
        { slideNumber: 1, path: "/tmp/1.png", imageBase64: fakeJpegA },
        { slideNumber: 2, path: "/tmp/2.png", imageBase64: fakeJpegB },
      ],
    });

    const conversation = {
      async readArtifactText() {
        artifactReads += 1;
        return artifactJson;
      },
    };

    const previewEnvelope = {
      ok: true,
      toolName: "previewPresentation",
      toolCallId: "prev_1",
      truncated: true,
      preview: '{"success":true,"slides":2}',
      value: {
        success: true,
        slides: [{ slideNumber: 1, path: "/tmp/1.png" }],
      },
      resultArtifact: { artifactId: "art-preview-1", version: 1 },
    };

    const round1: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "prev_1",
            tool_name: "previewPresentation",
            arguments: {},
          },
        ],
      },
      toolResultMessage("prev_1", "previewPresentation", previewEnvelope),
    ];

    const first = await hydrateToolResultsForVision(
      conversation as never,
      round1,
    );
    const firstRepaired = repairLinguaToolPairing(first);
    expect(artifactReads).toBe(1);
    expect(JSON.stringify(firstRepaired)).toContain(fakeJpegA);
    expect(JSON.stringify(firstRepaired)).toContain(fakeJpegB);
    // Base64 must live only in image parts, not tool JSON.
    const firstToolOut = (
      firstRepaired.find((m) => m.role === "tool")!.content as Array<{
        output?: unknown;
      }>
    )[0]?.output;
    expect(JSON.stringify(firstToolOut)).not.toContain(fakeJpegA);
    expect(JSON.stringify(firstToolOut)).not.toContain(fakeJpegB);
    const visionCount = firstRepaired.filter(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((p) => (p as { type?: string }).type === "image"),
    ).length;
    expect(visionCount).toBe(2);

    // After the model replies, the same tool result is historical — no re-read.
    const round2: Message[] = [
      ...round1,
      {
        role: "assistant",
        content: [{ type: "text", text: "Looks good, continuing." }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "shell_1",
            tool_name: "shell",
            arguments: { command: "ls" },
          },
        ],
      },
      toolResultMessage("shell_1", "shell", {
        ok: true,
        value: { stdout: "deck.md\n", stderr: "", exitCode: 0 },
      }),
    ];

    const second = await hydrateToolResultsForVision(
      conversation as never,
      round2,
    );
    expect(artifactReads).toBe(1); // must not rehydrate the old preview
    const serialized = JSON.stringify(second);
    expect(serialized).not.toContain(fakeJpegA);
    expect(serialized).not.toContain(fakeJpegB);
    expect(
      second.some(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((p) => (p as { type?: string }).type === "image"),
      ),
    ).toBe(false);
  });
});
