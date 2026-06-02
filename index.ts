import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

const EXABASE_API_URL = "https://api.exabase.io"
const OPENCLAW_CONFIG_KEY = "plugins.entries.openclaw-exabase-memory.config"
const OPENCLAW_ENTRY_KEY = "plugins.entries.openclaw-exabase-memory"

type PluginConfig = {
  apiKey?: string
  baseId?: string
  autoRecall?: boolean
  autoCapture?: boolean
  recallLimit?: number
  captureInfer?: boolean
  hooks?: {
    allowConversationAccess?: boolean
  }
}

type OpenClawPluginEntry = {
  enabled?: boolean
  config?: PluginConfig
  hooks?: {
    allowConversationAccess?: boolean
  }
}

type OpenClawRuntimeConfig = {
  plugins?: {
    entries?: Record<string, OpenClawPluginEntry>
  }
}

type ResolvedConfig = Required<Pick<PluginConfig, "autoRecall" | "autoCapture" | "recallLimit" | "captureInfer">> & PluginConfig

type PluginContext = {
  config?: {
    plugins?: {
      entries?: Record<string, { config?: PluginConfig }>
    }
  }
  pluginConfig?: { config?: PluginConfig } | PluginConfig
  sessionKey?: string
  runId?: string
  messages?: unknown[]
  sessionMessages?: unknown[]
  history?: unknown[]
  conversation?: unknown[]
  prompt?: unknown
  message?: unknown
  context?: {
    pluginConfig?: { config?: PluginConfig } | PluginConfig
    sessionKey?: string
    runId?: string
  }
}

type ToolParams = Record<string, unknown>

type ExabaseMemoryHit = {
  id: string
  name?: string | null
  content?: string
  memory?: string
}

type ExabaseSearchResult = {
  hits?: ExabaseMemoryHit[]
}

type ToolRegistration = {
  name: string
  label?: string
  description: string
  parameters: Record<string, unknown>
  execute: (_toolCallId: string, params: ToolParams) => Promise<{
    content: Array<{ type: "text"; text: string }>
  }>
}

type PluginApi = {
  pluginConfig?: { config?: PluginConfig } | PluginConfig
  logger?: {
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
  registerTool: (tool: ToolRegistration) => void
  registerCli: (
    registrar: (ctx: { program: any }) => void | Promise<void>,
    opts?: { descriptors?: Array<{ name: string; description: string; hasSubcommands?: boolean }>; parentPath?: string[] },
  ) => void
  on: (eventName: "before_prompt_build" | "before_agent_start" | "agent_end", handler: (event: PluginContext) => Promise<{ prependContext: string } | void> | { prependContext: string } | void) => void
}

const DEFAULT_CONFIG: ResolvedConfig = {
  autoRecall: true,
  autoCapture: true,
  recallLimit: 20,
  captureInfer: false,
}

function readConfig(pluginConfig: PluginContext["pluginConfig"]): ResolvedConfig {
  const config = pluginConfig && typeof pluginConfig === "object" && "config" in pluginConfig
    ? pluginConfig.config
    : pluginConfig
  return { ...DEFAULT_CONFIG, ...(config ?? {}) }
}

function resolveApiKey(config: PluginConfig): string {
  return config.apiKey || process.env.EXABASE_API_KEY || ""
}

function resolveBaseId(config: PluginConfig): string {
  return config.baseId || process.env.EXABASE_BASE_ID || ""
}

function asText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n")
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.text === "string") return record.text
    if (typeof record.content === "string") return record.content
    if (Array.isArray(record.content)) return asText(record.content)
    if (typeof record.message === "string") return record.message
    if (typeof record.value === "string") return record.value
    return Object.values(record).map(asText).filter(Boolean).join("\n")
  }
  return ""
}

function normalizeMessages(value: unknown[]): Array<{ role: string; text: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const record = item as Record<string, unknown>
      const role = String(record.role || record.author || record.type || "").toLowerCase()
      const text = asText(record.content ?? record.text ?? record.message ?? item)
      if (!role || !text) return null
      return { role, text }
    })
    .filter((item): item is { role: string; text: string } => item !== null)
}

function getPromptText(event: PluginContext): string {
  const message = event?.message
  const messageContent = message && typeof message === "object"
    ? (message as Record<string, unknown>).content
    : undefined
  return asText(event?.prompt ?? messageContent ?? message ?? "").trim()
}

function getMessages(event: PluginContext): Array<{ role: string; text: string }> {
  return normalizeMessages(
    event?.messages
      ?? event?.sessionMessages
      ?? event?.history
      ?? event?.conversation
      ?? [],
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function formatHits(hits: ExabaseMemoryHit[]): string {
  return hits
    .map((hit) => {
      const title = hit.name ? `${hit.name} (${hit.id})` : hit.id
      const content = truncate(asText(hit.content ?? hit.memory ?? ""), 300)
      return `- ${title}: ${content}`
    })
    .join("\n")
}

function buildConversationContent(event: PluginContext, messages: Array<{ role: string; text: string }>, config: ResolvedConfig): string {
  const userMessages = messages.filter((message) => message.role === "user")
  const assistantMessages = messages.filter((message) => message.role === "assistant")
  const userText = userMessages.at(-1)?.text?.trim() || ""
  const assistantText = assistantMessages.at(-1)?.text?.trim() || ""
  if (!userText || !assistantText) return ""

  const runId = event?.runId || event?.context?.runId || ""
  const sessionKey = event?.context?.sessionKey || event?.sessionKey || ""
  const heading = sessionKey || runId ? `Session ${sessionKey || runId}` : "Conversation"
  const lines = [
    heading,
    `Time: ${new Date().toISOString()}`,
    `User: ${truncate(userText, 12000)}`,
    `Assistant: ${truncate(assistantText, 12000)}`,
  ]

  if (runId) lines.splice(1, 0, `Run: ${runId}`)
  if (config.captureInfer === false) lines.unshift("Verbatim memory")

  return lines.join("\n")
}

async function exabaseRequest<T = unknown>(
  path: string,
  options: {
    method?: string
    apiKey: string
    baseId?: string
    query?: Record<string, string | number | boolean | null | undefined>
    body?: unknown
    signal?: AbortSignal
  },
): Promise<T | null> {
  const url = new URL(`${EXABASE_API_URL}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === "") continue
      url.searchParams.set(key, String(value))
    }
  }

  const headers: Record<string, string> = {
    "X-Api-Key": options.apiKey,
  }
  if (options.baseId) headers["X-Exabase-Base-Id"] = options.baseId
  if (options.body !== undefined) headers["Content-Type"] = "application/json"

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  if (response.status === 204) return null

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Exabase ${options.method ?? "GET"} ${path} failed (${response.status}): ${text || response.statusText}`)
  }

  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

async function createMemory(args: {
  apiKey: string
  baseId?: string
  content: string
  name?: string
  infer?: boolean
  immutable?: boolean
  occurredAt?: string
}) {
  return exabaseRequest("/v2/memories", {
    method: "POST",
    apiKey: args.apiKey,
    baseId: args.baseId,
    body: {
      source: "text",
      content: args.content,
      name: args.name ?? null,
      infer: args.infer ?? false,
      immutable: args.immutable ?? false,
      occuredAt: args.occurredAt ?? null,
    },
  })
}

async function searchMemories(args: {
  apiKey: string
  baseId?: string
  query: string
  limit?: number
}) {
  return exabaseRequest<ExabaseSearchResult>("/v2/memories/search", {
    method: "GET",
    apiKey: args.apiKey,
    baseId: args.baseId,
    query: {
      query: args.query,
      limit: args.limit ?? 20,
    },
  })
}

async function getMemory(args: { apiKey: string; baseId?: string; id: string }) {
  return exabaseRequest(`/v2/memories/${encodeURIComponent(args.id)}`, {
    method: "GET",
    apiKey: args.apiKey,
    baseId: args.baseId,
  })
}

async function updateMemory(args: {
  apiKey: string
  baseId?: string
  id: string
  name?: string
  content: string
}) {
  return exabaseRequest(`/v2/memories/${encodeURIComponent(args.id)}`, {
    method: "PATCH",
    apiKey: args.apiKey,
    baseId: args.baseId,
    body: {
      name: args.name ?? null,
      content: args.content,
    },
  })
}

async function deleteMemory(args: { apiKey: string; baseId?: string; id: string }) {
  return exabaseRequest(`/v2/memories/${encodeURIComponent(args.id)}`, {
    method: "DELETE",
    apiKey: args.apiKey,
    baseId: args.baseId,
  })
}

function requireApiKey(config: PluginConfig): string {
  const apiKey = resolveApiKey(config)
  return apiKey
}

function toolResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  }
}

function configFilePath(): string {
  return process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json")
}

function readOpenClawConfig(): OpenClawRuntimeConfig {
  const filePath = configFilePath()
  if (!fs.existsSync(filePath)) return {}

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OpenClawRuntimeConfig
  } catch {
    return {}
  }
}

function setNestedConfigValue(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split(".").filter(Boolean)
  if (!segments.length) return

  let current: Record<string, unknown> = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]
    const next = current[segment]
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  current[segments[segments.length - 1]] = value
}

function writeOpenClawConfig(configPathKey: string, value: unknown): void {
  const filePath = configFilePath()
  const configDir = path.dirname(filePath)
  fs.mkdirSync(configDir, { recursive: true })

  let config: Record<string, unknown> = {}
  if (fs.existsSync(filePath)) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
    } catch {
      config = {}
    }
  }

  setNestedConfigValue(config, configPathKey, value)
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`)
}

async function promptForApiKey(): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    const value = await rl.question("Exabase API key: ")
    return value.trim()
  } finally {
    rl.close()
  }
}

function registerExabaseCli(api: PluginApi, config: ResolvedConfig): void {
  api.registerCli(async ({ program }) => {
    const exabase = program.command("exabase").description("Manage Exabase memory setup and status")

    exabase
      .command("setup")
      .description("Store the Exabase API key in OpenClaw config")
      .argument("[apiKey]", "Exabase API key")
      .option("--base-id <baseId>", "Optional Exabase base ID")
      .action(async (apiKeyArg?: string, options?: { baseId?: string }) => {
        const apiKey = (apiKeyArg || (await promptForApiKey())).trim()
        if (!apiKey) {
          throw new Error("No Exabase API key provided.")
        }

        writeOpenClawConfig(`${OPENCLAW_CONFIG_KEY}.apiKey`, apiKey)
        writeOpenClawConfig(`${OPENCLAW_ENTRY_KEY}.hooks.allowConversationAccess`, true)

        const baseId = options?.baseId?.trim()
        if (baseId) writeOpenClawConfig(`${OPENCLAW_CONFIG_KEY}.baseId`, baseId)

        console.log("Exabase configured.")
        console.log("Restart OpenClaw if the plugin is already loaded.")
      })

    exabase
      .command("status")
      .description("Show whether Exabase is configured")
      .action(() => {
        const runtimeConfig = readOpenClawConfig()
        const pluginEntry = runtimeConfig.plugins?.entries?.["openclaw-exabase-memory"]
        const entryConfig = pluginEntry?.config
        const entryHooks = pluginEntry?.hooks
        const configured = Boolean(entryConfig?.apiKey || resolveApiKey(config))
        const baseId = entryConfig?.baseId || resolveBaseId(config)
        const allowConversationAccess = entryHooks?.allowConversationAccess === true
        console.log(configured ? "Exabase is configured." : "Exabase is not configured.")
        if (baseId) console.log(`Base ID: ${baseId}`)
        console.log(
          allowConversationAccess
            ? "Conversation access: enabled"
            : "Conversation access: disabled - run 'openclaw exabase setup' again",
        )
        const path = configFilePath()
        if (path) console.log(`Config file: ${path}`)
      })
  }, {
    descriptors: [
      {
        name: "exabase",
        description: "Manage Exabase memory setup and status",
        hasSubcommands: true,
      },
    ],
  })
}

export default definePluginEntry({
  id: "openclaw-exabase-memory",
  name: "Exabase Memory",
  description: "Long-term memory backed by Exabase M-1.",
  kind: "memory",
  register(api: PluginApi) {
    const config = readConfig(api.pluginConfig)
    registerExabaseCli(api, config)

    const apiKey = resolveApiKey(config)

    if (!apiKey) {
      api.logger?.info?.("exabase: not configured - run 'openclaw exabase setup'")
      return
    }

    api.registerTool({
      name: "exabase_memory_store",
      label: "Store memory",
      description: "Store text in Exabase memory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          name: { type: "string" },
          infer: { type: "boolean" },
          baseId: { type: "string" },
        },
        required: ["content"],
      },
      async execute(_id, params) {
        const result = await createMemory({
          apiKey: requireApiKey(config),
          baseId: typeof params.baseId === "string" ? params.baseId : resolveBaseId(config),
          content: String(params.content || ""),
          name: typeof params.name === "string" ? params.name : undefined,
          infer: typeof params.infer === "boolean" ? params.infer : true,
          occurredAt: new Date().toISOString(),
        })
        return toolResponse(JSON.stringify(result, null, 2))
      },
    })

    api.registerTool({
      name: "exabase_memory_search",
      label: "Search memory",
      description: "Search Exabase memories by query.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 20 },
          baseId: { type: "string" },
        },
        required: ["query"],
      },
      async execute(_id, params) {
        const result = await searchMemories({
          apiKey: requireApiKey(config),
          baseId: typeof params.baseId === "string" ? params.baseId : resolveBaseId(config),
          query: String(params.query || ""),
          limit: typeof params.limit === "number" ? params.limit : config.recallLimit,
        })
        const hits = Array.isArray(result?.hits) ? result.hits : []
        return toolResponse(hits.length ? formatHits(hits) : "No memories found.")
      },
    })

    api.registerTool({
      name: "exabase_memory_get",
      label: "Get memory",
      description: "Fetch a memory by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          baseId: { type: "string" },
        },
        required: ["id"],
      },
      async execute(_id, params) {
        const result = await getMemory({
          apiKey: requireApiKey(config),
          baseId: typeof params.baseId === "string" ? params.baseId : resolveBaseId(config),
          id: String(params.id || ""),
        })
        return toolResponse(JSON.stringify(result, null, 2))
      },
    })

    api.registerTool({
      name: "exabase_memory_update",
      label: "Update memory",
      description: "Update a memory's name and content.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          content: { type: "string" },
          name: { type: "string" },
          baseId: { type: "string" },
        },
        required: ["id", "content"],
      },
      async execute(_id, params) {
        const result = await updateMemory({
          apiKey: requireApiKey(config),
          baseId: typeof params.baseId === "string" ? params.baseId : resolveBaseId(config),
          id: String(params.id || ""),
          name: typeof params.name === "string" ? params.name : undefined,
          content: String(params.content || ""),
        })
        return toolResponse(result === null ? "Updated." : JSON.stringify(result, null, 2))
      },
    })

    api.registerTool({
      name: "exabase_memory_delete",
      label: "Delete memory",
      description: "Delete a memory by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          baseId: { type: "string" },
        },
        required: ["id"],
      },
      async execute(_id, params) {
        await deleteMemory({
          apiKey: requireApiKey(config),
          baseId: typeof params.baseId === "string" ? params.baseId : resolveBaseId(config),
          id: String(params.id || ""),
        })
        return toolResponse("Deleted.")
      },
    })

    const recallHandler = async (event: PluginContext) => {
      const cfg = readConfig(event?.context?.pluginConfig ?? config)
      if (!cfg.autoRecall) return

      const apiKey = resolveApiKey(cfg)
      if (!apiKey) return

      const query = getPromptText(event)
      if (!query) return

      const result = await searchMemories({
        apiKey,
        baseId: resolveBaseId(cfg),
        query,
        limit: cfg.recallLimit,
      })
      const hits = Array.isArray(result?.hits) ? result.hits : []
      if (!hits.length) return

      return {
        prependContext: [
          "Relevant Exabase memories:",
          formatHits(hits),
        ].join("\n"),
      }
    }

    api.on("before_prompt_build", recallHandler)
    api.on("before_agent_start", recallHandler)

    api.on("agent_end", async (event: PluginContext) => {
      const cfg = readConfig(event?.context?.pluginConfig ?? config)
      if (!cfg.autoCapture) return

      const apiKey = resolveApiKey(cfg)
      if (!apiKey) return

      const messages = getMessages(event)
      const content = buildConversationContent(event, messages, cfg)
      if (!content) return

      const sessionKey = event?.context?.sessionKey || event?.sessionKey || event?.runId || "conversation"
      await createMemory({
        apiKey,
        baseId: resolveBaseId(cfg),
        content,
        name: `Conversation ${sessionKey}`,
        infer: cfg.captureInfer === true,
        immutable: true,
        occurredAt: new Date().toISOString(),
      })
    })
  },
})
