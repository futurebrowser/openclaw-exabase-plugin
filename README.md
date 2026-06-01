# OpenClaw Exabase Memory

Long-term memory plugin for OpenClaw backed by Exabase M-1.

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
openclaw exabase setup
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

## Publish to ClawHub

1. Make sure your package name is the one you want to publish. This repo uses `openclaw-exabase-memory`.
2. Sign in to ClawHub: `clawhub login`.
3. Install dependencies and build the runtime: `npm install && npm run build`.
4. Run a dry run from the repo root: `clawhub package publish . --dry-run`.
5. If the dry run looks correct, publish for your owner:
   - Personal owner: `clawhub package publish .`
   - Org owner: `clawhub package publish . --owner <owner>`
6. After ClawHub accepts the publish, install it in OpenClaw with:
   - `openclaw plugins install clawhub:openclaw-exabase-memory`
