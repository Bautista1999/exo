import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  defineHarness,
  registerBuiltInTools,
  registerAgentToolsFromDirectoryIfExists,
  registerLibraryToolModulePath,
  registerAdapterTools,
  registerSkillTools,
  skillsInstruction,
  type BuiltInToolName,
  type HarnessToolRegistry,
  type Message,
  type TurnContext,
} from "@exo/harness";

import { registerFalTools } from "./tools/fal/fal-tools.js";
import { registerIntrospectionTools } from "./tools/introspection-tools.js";
import { registerSandboxTools } from "./tools/sandbox-tools.js";
import { registerTaskTreeTools } from "./tools/task-tree-tools.js";
import { registerSchedulerTools } from "./tools/scheduler-tools.js";
import { exoWorkerEnv, exoWorkerEnvFlag } from "./env.js";
import {
  memoryInstruction,
  registerMemoryTools,
} from "./tools/memory-tools.js";
import {
  basicHarnessInstructions,
  defaultBuiltInToolNames,
  runExoWorkerHarnessTurn,
} from "./turn-loop.js";

const EXO_WORKER_IDENTITY_PROMPT = readFileSync(
  new URL("./prompts/me.md", import.meta.url),
  "utf8",
).trim();
const DEFAULT_LOCAL_PROMPT_PATH = ".exo/exo-worker-profile.md";
const DEFAULT_EXO_WORKER_REPO = "/workspace/exo";
const DEFAULT_EXO_WORKER_SELF_MAP = `${DEFAULT_EXO_WORKER_REPO}/examples/exo-worker/SELF.md`;

export default defineHarness({
  async runTurn(context) {
    await runExoWorkerHarnessTurn(context, {
      instructions: exoWorkerInstructions,
      registerTools: registerExoWorkerTools,
    });
  },
});

async function registerExoWorkerTools(
  tools: HarnessToolRegistry,
  context: TurnContext,
): Promise<void> {
  registerBuiltInTools(tools, context, builtInToolNames(context));
  registerTaskTreeTools(tools);
  // Reuse Exo's shipped adapters (examples/exo/adapters). create_adapter with
  // source "library" resolves workers from that tree via ExoToolRuntime — this
  // example intentionally does not duplicate Discord/IRC/WhatsApp/Signal/Slack.
  registerAdapterTools(tools);
  registerIntrospectionTools(tools);
  registerSandboxTools(tools);
  registerMemoryTools(tools);
  registerSkillTools(tools);
  if (exoWorkerEnvFlag("ENABLE_SCHEDULER")) {
    registerSchedulerTools(tools);
  }
  if (exoWorkerEnvFlag("ENABLE_FAL")) {
    registerFalTools(tools);
  }
  for (const modulePath of context.agentConfig.typescript?.toolModulePaths ??
    []) {
    await registerExoWorkerToolModule(tools, context, modulePath);
  }
  if (context.agentConfig.enableAgentToolCreation) {
    await registerAgentToolsFromDirectoryIfExists(
      tools,
      context,
      process.env.EXO_AGENT_TOOLS_DIR?.trim() || undefined,
    );
  }
}

async function registerExoWorkerToolModule(
  registry: HarnessToolRegistry,
  context: TurnContext,
  modulePath: string,
): Promise<void> {
  const mod = await import(pathToFileURL(modulePath).href);
  // Host deployments may inject modules that export registerHostTools.
  if (typeof mod.registerHostTools === "function") {
    await mod.registerHostTools(registry, context);
    return;
  }
  await registerLibraryToolModulePath(registry, context, modulePath);
}

function builtInToolNames(context: TurnContext): BuiltInToolName[] {
  return defaultBuiltInToolNames(context);
}

async function exoWorkerInstructions(context: TurnContext): Promise<Message[]> {
  const repoPath = exoWorkerEnv("REPO") ?? DEFAULT_EXO_WORKER_REPO;
  const selfMapPath = exoWorkerEnv("SELF_MAP") ?? DEFAULT_EXO_WORKER_SELF_MAP;
  const localPromptPath =
    exoWorkerEnv("LOCAL_PROMPT_FILE") ?? DEFAULT_LOCAL_PROMPT_PATH;
  const instructions: Message[] = [
    ...basicHarnessInstructions(context),
    {
      role: "developer",
      content: EXO_WORKER_IDENTITY_PROMPT,
    },
    {
      role: "developer",
      content:
        "You have full autonomy to plan and execute work. Maintain a task tree throughout the job using task_tree_init, task_tree_upsert_node, and task_tree_update_status. Depth 1 = objectives, depth 2 = sub-objectives, depth 3 = TODO leaves (isLeaf true). Update node status as you work: pending → in_progress → completed/failed. Report client outputs with report_deliverable: for PPTX/PDF/files use type=file with the sandbox path as url (the host may upload and deliver the file); for sites/repos use type=url with https. Never send desktop/VNC stream URLs to the client. Fix recoverable sandbox/tool errors with shell or other registered command tools — do not call complete_task with status failed for fixable issues. When all TODO leaves are completed and deliverables are reported, call complete_task once. You may create external adapters (Slack, WhatsApp, Signal, Discord, IRC) with create_adapter and reply with send_adapter_message; do not auto-send model text externally.",
    },
    {
      role: "developer",
      content: [
        "## Self-evolution (memory, skills, tools)",
        "Persist what you learn across jobs:",
        "- remember / forget — durable facts (client prefs, project conventions, lessons). Injected every turn.",
        "- install_skill / use_skill / list_skills / uninstall_skill — reusable procedures in agent-skills format. Call use_skill before matching work.",
        "- install_agent_tool — when the same helper is needed across rounds/jobs and no registered tool covers it.",
        "Prefer remember for short facts, install_skill for multi-step playbooks, install_agent_tool for callable code helpers.",
      ].join("\n"),
    },
    toolLayerInstruction(context),
    {
      role: "developer",
      content: `ExoWorker source is at ${repoPath}. See ${selfMapPath} for layout. Local overrides may live in ${localPromptPath}.`,
    },
  ];
  const localPrompt = readLocalPrompt();
  if (localPrompt !== null) {
    instructions.push({
      role: "developer",
      content: localPrompt,
    });
  }
  const memory = await memoryInstruction(context);
  if (memory !== null) {
    instructions.push(memory);
  }
  const skills = await skillsInstruction(context);
  if (skills !== null) {
    instructions.push(skills);
  }
  return instructions;
}

function toolLayerInstruction(context: TurnContext): Message {
  const layers = [
    "Tool layers (use the best match; all may be registered in the same turn):",
    "1. Host-injected tools — any modules registered on the agent via toolModulePaths (sandboxes, HTTP clients, platform catalog tools, etc.). Prefer these when they cover the job.",
    "2. ExoWorker substrate — task_tree_*, report_deliverable, complete_task, adapters, sandbox/introspection, remember/forget, install_skill/use_skill.",
  ];
  if (context.agentConfig.enableAgentToolCreation) {
    layers.push(
      "3. install_agent_tool / uninstall_agent_tool — first-class. Install a reusable TypeScript tool under .exo/agent-tools/ when you need the same helper more than once and no registered host tool covers it. Previously installed agent tools reload each round. Do not reinstall duplicates of working registered tools.",
    );
  }
  return { role: "developer", content: layers.join("\n") };
}

function readLocalPrompt(): string | null {
  const path = exoWorkerEnv("LOCAL_PROMPT_FILE") ?? DEFAULT_LOCAL_PROMPT_PATH;
  if (!existsSync(path)) {
    return null;
  }
  const contents = readFileSync(path, "utf8").trim();
  return contents.length > 0 ? contents : null;
}
