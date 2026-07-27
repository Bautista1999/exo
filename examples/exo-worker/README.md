# ExoWorker

ExoWorker is an autonomous exo harness for jobs that need planning, execution,
and a durable record of progress. The agent breaks work into a task tree,
updates status as it goes, runs shell and sandbox commands, talks to external
channels through adapters when configured, and reports deliverables when
something is ready to hand off.

ExoWorker is built on the same exo substrate as other harness examples: agents,
conversations, artifacts, adapters, and optional scheduling all live under
your exo `--root` (typically `.exo`).

## Quickstart

### Option A — dedicated ExoWorker setup (recommended)

After checking out this branch:

```bash
bash examples/exo-worker/setup.sh
bash examples/exo-worker/exo-worker.sh
```

`setup.sh` configures `.env`, registers a model, and creates the ExoWorker agent
in the current checkout. It does not clone or reinstall exo.

Use `exo-worker.sh` (not plain `./exo.sh`) so the ExoWorker module, minimal
template, and `local-process` sandbox are applied. Plain `./exo.sh` starts the
canonical Exo agent (Docker + ExoChat). If you previously created the agent
with Docker, `exo-worker.sh` clears the durable agent sandbox before launch.

### Option B — manual CLI setup

**Prerequisites:** a built `exo` binary, Node with pnpm, and a model API key
(`ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`).

From the exo repository root:

1. Install dependencies and configure your model key:

```bash
pnpm install
cp .env.example .env   # then fill in the provider key your model binding uses
```

2. Build the CLI:

```bash
cargo build -p exo
```

3. Register a secret + model, then create a ExoWorker agent and conversation:

```bash
EXO=./target/debug/exo

$EXO --root .exo secret set anthropic --env ANTHROPIC_API_KEY
# or: $EXO --root .exo secret set openai --env OPENAI_API_KEY

$EXO --root .exo model register claude-sonnet-4-6 --secret anthropic
# or: $EXO --root .exo model register gpt-5.4 --secret openai

$EXO --harness typescript --root .exo \
  agent create "ExoWorker" \
  --slug worker \
  --module examples/exo-worker/harness.ts \
  --model claude-sonnet-4-6 \
  --networking enabled

$EXO --harness typescript --root .exo \
  conversation create worker \
  --slug job-1 \
  --name "First job"
```

4. Send a task:

```bash
$EXO --harness typescript --root .exo \
  conversation send worker job-1 \
  "Plan and build a small CLI that converts CSV to JSON. Report the result when done."
```

5. Open an interactive REPL on the same conversation (optional):

```bash
$EXO --harness typescript --root .exo repl worker job-1
```

ExoWorker will call `task_tree_init` early, keep the tree updated as it
works, use `report_deliverable` for outputs, and finish with `complete_task`.

## How it works

Each user message starts a **turn**. Flow:

1. `harness.ts` registers tools and builds developer instructions (identity,
   operating rules, optional local profile).
2. `turn-loop.ts` materializes conversation history, calls the model, executes
   tools, and continues until the task tree is finished or budgets are exhausted.
3. Events (messages, tool calls, tool results, artifact writes) append to the
   conversation log under the exo root.

**Turn-loop behavior that matters in practice:**

- If the model replies with text only before `complete_task`, ExoWorker sends
  a developer **nudge** (default up to 3; see `EXO_WORKER_MAX_TEXT_ONLY_NUDGES`).
- Round-trip budget can be extended a few times when the task tree is still
  unfinished (`DEFAULT_ROUND_BUDGET_EXTENSIONS` in `task-tree-snapshot.ts`).
- Task-tree tool args are unwrapped via `tool-args.ts` so nested
  `{ type: "valid", value: … }` envelopes from the runtime still work.

Task-tree tools also persist a **`task-tree.json`** conversation artifact
(`task-tree-snapshot.ts`). That snapshot survives across turns so you can resume
long jobs. Successful task-tree tool results include a structured `bridgeEvent`
field — useful if a host process outside exo wants to mirror progress into its
own database or UI.

## Codebase layout

```text
examples/exo-worker/
  harness.ts                 Entry point: prompts + tool registration
  setup.sh                   Configure ExoWorker agent in this checkout
  exo-worker.sh              Launch ExoWorker (wraps root exo.sh)
  turn-loop.ts               Model/tool round loop + budget extensions
  turn-loop-nudge.ts         Text-only nudge helpers
  message-materialize.ts     Conversation history → model messages
  prompts/me.md              Committed identity and operating rules
  task-tree-tools.ts         Task tree + deliverable + complete_task tools
  task-tree-snapshot.ts      task-tree.json artifact read/write + finish checks
  tool-args.ts               Unwrap nested harness tool-arg envelopes
  introspection-tools.ts     list_adapter_events, list_conversation_events
  sandbox-tools.ts           Snapshot and rewind for the agent sandbox
  scheduler-tools.ts         Recurring tasks (optional; see env below)
  host-tools.ts              Bridge from TypeScript tool defs to Rust host tools
  SELF.md                    Map of important paths for self-inspection
```

Shared with the canonical Exo example (not copied into this folder):

- `examples/exo/adapters/` — library adapter workers (Discord, IRC, WhatsApp, …)
- `examples/exo/scripts/` — `exo-cli`, `exo-service-guardian`
- `examples/exo/scheduler-runner/` — host process that fires scheduled sandbox tasks
- `crates/executor/src/adapter/` — adapter store, worker supervision, outbox
- `typescript/harness/adapter-tools.ts` — `create_adapter`, `send_adapter_message`, …

`registerAdapterTools(tools)` in `harness.ts` is the reuse path: library
adapters resolve to `examples/exo/adapters/<type>/worker.ts` inside
`TypeScriptHarness::exo_from_root`.

See [`SELF.md`](./SELF.md) for the full path map the agent reads at runtime.

## Task tree

ExoWorker owns its own plan. Conventions:

| Depth | Role                         |
| ----- | ---------------------------- |
| 1     | Objectives                   |
| 2     | Sub-objectives               |
| 3     | TODO leaves (`isLeaf: true`) |

Status flow: `pending` → `in_progress` → `completed` or `failed`.

**Tools:**

- `task_tree_init` — declare the full tree once you understand the job
- `task_tree_upsert_node` — add or revise a single node later
- `task_tree_update_status` — move a node through statuses
- `report_deliverable` — record a URL, file, image, or text output
- `complete_task` — signal the whole job is finished (once)

**Bridge events:** successful task-tree tool results look like:

```json
{
  "ok": true,
  "bridgeEvent": {
    "type": "task_tree.init",
    "rootRef": "root",
    "nodes": []
  }
}
```

Event types include `task_tree.init`, `task_tree.upsert_node`,
`task_tree.update_status`, `deliverable.report`, and `task.complete`. A host
integration can subscribe to exo conversation events and react to these payloads
without changing the harness.

## Tools

ExoWorker registers tools in layers (`harness.ts`):

**Built-in** (from exo harness defaults when enabled on the agent):

- `shell` — run commands in the agent sandbox
- `install_agent_tool` / `uninstall_agent_tool` when agent tool creation is enabled

**Task tree** — see above.

**Adapters:**

- `create_adapter`, `list_adapters`, `disable_adapter`, `delete_adapter`
- `send_adapter_message`

**Introspection:**

- `list_adapter_events` — adapter telemetry (connect, disconnect, inbound, errors)
- `list_conversation_events` — read the durable conversation event log

**Sandbox:**

- `list_sandbox_snapshots`, `snapshot_sandbox`, `rewind_sandbox`

**Scheduler** (when `EXO_WORKER_ENABLE_SCHEDULER=true`):

- `schedule_sandbox_task`, `list_scheduled_tasks`, `cancel_scheduled_task`, `delete_scheduled_task`

**Host-injected modules:** anything registered on the agent with
`--tool-module` / `toolModulePaths` (extra sandboxes, HTTP clients, custom
packages). Host deployments often inject catalog or sandbox tools here.
Register at agent create/update time:

```bash
$EXO --harness typescript agent update worker \
  --tool-module /path/to/my-tools.ts
```

## Adapters

Adapters are long-running host processes that connect ExoWorker to external
apps (chat, IRC, CLI bridges). ExoWorker does **not** ship its own adapter
workers — it reuses the canonical ones under
[`examples/exo/adapters/`](../exo/adapters/).

`harness.ts` calls `registerAdapterTools(tools)`. That registers
`create_adapter` / `list_adapters` / `send_adapter_message` / …, and library
adapters (`source: "library"`, type `discord` | `whatsapp` | `signal` |
`slack` | `exochat`) run the workers already checked in at
`examples/exo/adapters/<type>/worker.ts`. Built-in adapters (`irc`,
`agent-cli`) use the same shared tree.

| Adapter   | Docs                                                             |
| --------- | ---------------------------------------------------------------- |
| Discord   | [`examples/exo/adapters/discord/`](../exo/adapters/discord/)     |
| IRC       | [`examples/exo/adapters/irc/`](../exo/adapters/irc/)             |
| WhatsApp  | [`examples/exo/adapters/whatsapp/`](../exo/adapters/whatsapp/)   |
| Signal    | [`examples/exo/adapters/signal/`](../exo/adapters/signal/)       |
| Slack     | [`examples/exo/adapters/slack/`](../exo/adapters/slack/)         |
| ExoChat   | [`examples/exo/adapters/exochat/`](../exo/adapters/exochat/)     |
| agent-cli | [`examples/exo/adapters/agent-cli/`](../exo/adapters/agent-cli/) |

To list configured adapters after setup:

```bash
$EXO --harness typescript adapters list
```

Create one through the agent (`create_adapter`) or send a setup prompt from
`examples/exo/adapters/<type>/setup-prompt.md` (same flow as canonical Exo).
Architecture notes: [`examples/exo/adapter-architecture.md`](../exo/adapter-architecture.md).

## Identity and local profile

`prompts/me.md` is the committed ExoWorker identity — keep it generic.

For machine-specific instructions (your name, repo paths, style preferences),
create a local profile file. The harness loads it when present:

```text
.exo/exo-worker-profile.md
```

This file is git-ignored by convention. Override the path with
`EXO_WORKER_LOCAL_PROMPT_FILE`.

## Self-inspection

When the repo is mounted into the sandbox (for example at `/workspace/exo`),
ExoWorker can read its own source. The self map at
`examples/exo-worker/SELF.md` points to harness code, adapter workers, and
executor modules. Set `EXO_WORKER_REPO` to the mount path and
`EXO_WORKER_SELF_MAP` to the map file if your layout differs.

## Testing

### Unit tests

ExoWorker unit tests live next to the modules they cover and run with the
repo-wide Vitest suite:

```bash
# All exo TypeScript tests
pnpm test

# ExoWorker-only
pnpm test examples/exo-worker
```

Covered areas include message materialization, task-tree snapshots, tool-arg
unwrapping, and text-only nudge helpers.

### Live E2E

`pnpm e2e:exo-worker` runs `scripts/exo-worker-e2e.ts` — a live check against a
real `exo` binary and model provider (same style as `pnpm e2e:agent-harnesses`,
but for ExoWorker).

It:

1. Builds `target/debug/exo` if needed
2. Creates a temp exo root, registers a secret/model, and creates a ExoWorker agent
   with `local-process` sandbox (no Docker/E2B required for this smoke)
3. Sends a constrained user message that must call `task_tree_init` then
   `complete_task`
4. If init lands without complete, sends one follow-up nudge
5. Asserts both tools appear in `conversation events`, and that `complete_task`
   returned a successful-looking result

```bash
pnpm e2e:exo-worker

# useful options
pnpm e2e:exo-worker -- --keep-root
pnpm e2e:exo-worker -- --model claude-sonnet-4-6
pnpm e2e:exo-worker -- --timeout-ms 300000
pnpm e2e:exo-worker -- --help
```

Requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`. This is a **live**
test (costs tokens); it is not part of `pnpm check`.

## Environment

| Variable                          | Purpose                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `EXO_WORKER_REPO`                 | Sandbox mount path to this repo (default `/workspace/exo`)                   |
| `EXO_WORKER_SELF_MAP`             | Path to `SELF.md` inside the mount                                           |
| `EXO_WORKER_LOCAL_PROMPT_FILE`    | Optional local profile (default `.exo/exo-worker-profile.md`)                |
| `EXO_WORKER_ENABLE_SCHEDULER`     | Set to `true` to register scheduler tools                                    |
| `EXO_WORKER_MAX_TEXT_ONLY_NUDGES` | Max developer nudges on text-only exits before `complete_task` (default `3`) |
| `EXO_WORKER_E2E_MODEL`            | Optional model override for `pnpm e2e:exo-worker`                            |
| `EXO_BIN`                         | Optional path to an `exo` binary for the E2E script                          |

Legacy `WORKERCLAW_*` env names are still accepted for one release when the
corresponding `EXO_WORKER_*` value is unset.

Deployment-specific secrets (API keys, Twilio, OAuth tokens) belong in exo
secrets or conversation secrets — not in this tree. Use `exo secret set` or
your host's secret sync before starting adapters or injected tool modules.

## Further reading

- [`SELF.md`](./SELF.md) — path map for changing ExoWorker itself
- [`examples/exo/adapter-architecture.md`](../exo/adapter-architecture.md) — adapter store, runtime, and worker protocol
- [`examples/exo/docs/SELF-CONTROL.md`](../exo/docs/SELF-CONTROL.md) — durable state, introspection, and service lifecycle
- [`scripts/exo-worker-e2e.ts`](../../scripts/exo-worker-e2e.ts) — live E2E implementation
