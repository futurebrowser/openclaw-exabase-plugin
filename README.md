# OpenClaw Exabase Memory Plugin

Exabase M-1 memory-provider integration for OpenClaw.

## About

[Exabase Memory (M-1)](https://exabase.io/memory) is a self-organising memory
engine for AI agents. It stores facts, preferences, and events, builds a living
knowledge graph, resolves contradictions, and evolves with every interaction.

M-1 is SOTA on the leading AI memory benchmark (LongMemEval), with the highest
recorded QA score, and using a small model. Read the research paper
[here](https://exabase.io/research/exabase-achieves-state-of-the-art-on-longmemeval-benchmark).


| System | Model | Score |
| --- | --- | --- |
| M-1 (Exabase) | Gemini 3 Flash | 96.4% |
| Mem0 | Gemini 3 Pro | 94.8% |
| Honcho | Gemini 3 Pro | 92.6% |
| HydraDB | Gemini 3 Pro | 90.79% |
| Supermemory | Gemini 3 Pro | 85.2% |

Exabase Memory powers memory in production apps like
[Fabric](https://fabric.so), used by 300,000+ people.

## What it does

- Automatically recalls relevant memories before a turn.
- Automatically stores each completed conversation turn after the agent finishes.
- Exposes tools to store, search, fetch, update, and delete memories.

## Configuration

Set either:

- `config.apiKey`
- `EXABASE_API_KEY`

Optional:

- `config.baseId` or `EXABASE_BASE_ID`
- `config.autoRecall` default `true`
- `config.autoCapture` default `true`
- `config.recallLimit` default `20`
- `config.captureInfer` default `false`

## Setup

Run:

```bash
openclaw plugins install clawhub:openclaw-exabase-memory
openclaw exabase setup
openclaw gateway restart
```

That stores the API key in your OpenClaw config. Use `openclaw exabase status` to check whether the plugin is configured.

## Tool names

- `exabase_memory_store`
- `exabase_memory_search`
- `exabase_memory_get`
- `exabase_memory_update`
- `exabase_memory_delete`

## Runtime behavior

- If no API key is configured, the plugin loads in setup-only mode.
- In setup-only mode, it exposes `openclaw exabase setup` and `openclaw exabase status`, but does not register memory tools or hooks.
- Once configured, it registers auto-recall, auto-capture, and the Exabase memory tools.
