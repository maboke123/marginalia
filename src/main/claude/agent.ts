import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatEvent, ChatImage } from '../../shared/claude'
import type { StoredClaudeSettings } from '../config'
import { claudeEnvironment, claudeExecutable } from './cli'
import { toChatEvents, type StreamState } from './events'
import { SYSTEM_APPEND } from './prompt'
import { APP_TOOLS, appToolServer, type CallTool } from './tools'

export interface AgentInput {
  /** The vault root; Claude's built-in tools only read inside it. */
  cwd: string
  text: string
  images: ChatImage[]
  /** Continue this conversation, or start a new one. */
  sessionId: string | null
  settings: StoredClaudeSettings
  apiKey: string | null
  callTool: CallTool
  signal: AbortSignal
  onSession(sessionId: string): void
}

/** One question in, a stream of answer events out, ending with `done`. */
export type Agent = (input: AgentInput) => AsyncIterable<ChatEvent>

const READ_TOOLS = ['Read', 'Glob', 'Grep']
const WEB_TOOLS = ['WebSearch', 'WebFetch']

async function* oneMessage(text: string, images: ChatImage[]): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        ...images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mediaType,
            data: Buffer.from(image.data).toString('base64')
          }
        })),
        { type: 'text' as const, text }
      ]
    }
  }
}

export const claudeAgent: Agent = async function* (input) {
  // Loaded on first use: it is ESM-only and large, and most sessions never open the panel.
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const { settings } = input
  const builtIn = settings.webSearch ? [...READ_TOOLS, ...WEB_TOOLS] : READ_TOOLS
  const allowed = new Set([...APP_TOOLS, ...(settings.webSearch ? WEB_TOOLS : [])])
  const abortController = new AbortController()
  input.signal.addEventListener('abort', () => abortController.abort(), { once: true })

  const options: Options = {
    cwd: input.cwd,
    resume: input.sessionId ?? undefined,
    model: settings.model === 'default' ? undefined : settings.model,
    effort: settings.effort === 'default' ? undefined : settings.effort,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
    // My own CLAUDE.md, hooks and plugins are for coding, not for this app.
    settingSources: [],
    // No Bash, Write or Edit at all: every change goes through the app tools.
    tools: builtIn,
    mcpServers: { marginalia: appToolServer(sdk, input.callTool) },
    // Reads inside the vault (the working directory) are allowed by default. Everything else
    // asks, and is answered here. Read, Glob and Grep must not go in allowedTools: a bare
    // entry approves them for every path on the disk.
    permissionMode: 'default',
    canUseTool: async (name, toolInput) =>
      allowed.has(name)
        ? { behavior: 'allow', updatedInput: toolInput }
        : {
            behavior: 'deny',
            message:
              'Only files inside the notes vault can be read, and changes go through the app tools.'
          },
    includePartialMessages: true,
    abortController,
    env: claudeEnvironment(input.apiKey),
    pathToClaudeCodeExecutable: claudeExecutable()
  }

  const query = sdk.query({ prompt: oneMessage(input.text, input.images), options })
  const state: StreamState = { hasText: false }
  let sessionId: string | null = null
  try {
    for await (const message of query) {
      if (message.session_id && message.session_id !== sessionId) {
        sessionId = message.session_id
        input.onSession(sessionId)
      }
      for (const event of toChatEvents(message, state)) {
        yield event
        if (event.type === 'done') return
      }
    }
  } finally {
    query.close()
  }
}

export interface CompleteInput {
  cwd: string
  text: string
  images: ChatImage[]
  settings: StoredClaudeSettings
  apiKey: string | null
  signal: AbortSignal
}

/** One question, one answer, no conversation: text Claude writes straight into a note. */
export type Complete = (input: CompleteInput) => Promise<string>

const WRITER_PROMPT = `You write text that goes straight into my lecture notes.
- The notes are Markdown that Obsidian reads: $...$ for inline math, $$ on its own lines for display math.
- Reply with only the text to put at the marked spot: no introduction, no explanation, no code fence around it.
- Fit it into the sentence or paragraph around the spot, in the language and style of my notes.
- Keep it as short as the request allows.`

export const claudeComplete: Complete = async (input) => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const abortController = new AbortController()
  input.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  const query = sdk.query({
    prompt: oneMessage(input.text, input.images),
    options: {
      cwd: input.cwd,
      model: input.settings.model === 'default' ? undefined : input.settings.model,
      effort: input.settings.effort === 'default' ? undefined : input.settings.effort,
      // Everything it needs is in the message; no tools keeps it to one quick answer.
      systemPrompt: WRITER_PROMPT,
      tools: [],
      settingSources: [],
      persistSession: false,
      abortController,
      env: claudeEnvironment(input.apiKey),
      pathToClaudeCodeExecutable: claudeExecutable()
    }
  })
  try {
    for await (const message of query) {
      if (message.type !== 'result') continue
      if (message.subtype !== 'success')
        throw new Error(message.errors.join('\n') || 'Claude stopped early')
      if (message.is_error) throw new Error(message.result)
      return message.result
    }
    throw new Error('No answer')
  } finally {
    query.close()
  }
}
