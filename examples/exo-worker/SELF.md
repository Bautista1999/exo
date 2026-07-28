# ExoWorker Self Map

ExoWorker is an autonomous exo harness example: plan work as a task tree,
execute in sandboxes and adapters, and report deliverables. In a normal local
startup, the repository is mounted in the sandbox at:

```text
/workspace/exo
```

Use this map before changing ExoWorker itself.

## Important Paths

- `examples/exo-worker/harness.ts`: assembles ExoWorker's prompt and tool registry.
- `examples/exo-worker/setup.sh`: configure ExoWorker in this checkout (no reinstall).
- `examples/exo-worker/exo-worker.sh`: launch ExoWorker via root `exo.sh` with correct defaults.
- `examples/exo-worker/prompts/me.md`: durable identity and operating rules.
- `examples/exo-worker/tools/memory-tools.ts`: agent-scoped `remember` / `forget` (artifact `memory/exo-worker-memory.json`).
- `examples/exo-worker/tools/task-tree-tools.ts`: task tree tools + `bridgeEvent` payloads in tool results.
- `examples/exo-worker/tools/introspection-tools.ts`: adapter and conversation introspection.
- `examples/exo-worker/tools/sandbox-tools.ts`: sandbox snapshot and rewind tools.
- `examples/exo-worker/tools/scheduler-tools.ts`: scheduled task tools (optional via `EXO_WORKER_ENABLE_SCHEDULER`).
- `typescript/harness/skill-tools.ts`: `install_skill` / `use_skill` / `list_skills` / `uninstall_skill` (agent artifacts).
- `typescript/harness/adapter-tools.ts`: model-visible adapter tools (`create_adapter`, …).
- `examples/exo/adapters/`: shipped library adapter workers — ExoWorker reuses these via `registerAdapterTools` (no local copy).
- `examples/exo/adapter-architecture.md` / `examples/exo/docs/SELF-CONTROL.md`: shared adapter and self-control docs.
- `examples/exo/scripts/exo-service-guardian` / `examples/exo/scheduler-runner/`: host service helpers shared with canonical Exo.
- `crates/executor/src/adapter/`: Rust adapter runtime and supervision.

## Self-evolution (rung 1)

ExoWorker can grow capability without rebuilding itself:

- **Memory** — short durable facts across jobs (`remember` / `forget`).
- **Skills** — multi-step playbooks as agent artifacts (`install_skill` / `use_skill`). Distinct from any methodology skills a host may inject in the task briefing.
- **Agent tools** — TypeScript helpers via `install_agent_tool` (when enabled).

## Task Tree

ExoWorker owns planning. Task-tree tools persist `task-tree.json` as a
conversation artifact and return structured `bridgeEvent` objects in tool
results so an external host (if any) can mirror progress into its own store.

- Depth 1: objectives
- Depth 2: sub-objectives
- Depth 3: TODO leaves (`isLeaf: true`)
- Status flow: `pending` → `in_progress` → `completed` / `failed`

## Environment

| Variable                       | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `EXO_WORKER_REPO`              | Sandbox mount path (default `/workspace/exo`) |
| `EXO_WORKER_SELF_MAP`          | Path to this file                             |
| `EXO_WORKER_LOCAL_PROMPT_FILE` | Optional local profile override               |
| `EXO_WORKER_ENABLE_SCHEDULER`  | `true` to register scheduler tools            |

Host deployments may inject additional tool modules via agent `toolModulePaths`
and mirror OAuth/API credentials into exo conversation secrets — that wiring lives
outside this repository.
