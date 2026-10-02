/** Types shared by the Claude service in main and the chat panel in the renderer. */

export const MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const
export type ModelChoice = (typeof MODELS)[number]

export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortChoice = (typeof EFFORTS)[number]

export interface ClaudeSettings {
  model: ModelChoice
  effort: EffortChoice
  /** Edits show as a preview with Accept / Reject before they are applied. */
  askBeforeEditing: boolean
  webSearch: boolean
  /** An API key is stored; it is never sent back to the renderer. */
  hasApiKey: boolean
}

export type ClaudeSettingsUpdate = Partial<Omit<ClaudeSettings, 'hasApiKey'>> & {
  /** A new key, or null to remove the stored one. */
  apiKey?: string | null
}

export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  model: 'default',
  effort: 'default',
  askBeforeEditing: true,
  webSearch: false,
  hasApiKey: false
}

export interface ChatImage {
  mediaType: 'image/png' | 'image/jpeg'
  data: Uint8Array
}

export interface ChatRequest {
  /** Chat key: the vault path of the section the conversation belongs to. */
  chat: string
  /** The question, with the context packet in front of it. */
  text: string
  images: ChatImage[]
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'done'; error?: string }

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  text: string
}

/** A call from Claude to one of the app tools, answered by the renderer. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolReply {
  id: string
  ok: boolean
  text: string
  image?: ChatImage
}

/** The context packet travels in front of each question, between these markers. */
export const CONTEXT_START = '<context>'
export const CONTEXT_END = '</context>'

/** The question without the context packet, for showing earlier messages. */
export function stripContext(text: string): string {
  const end = text.indexOf(CONTEXT_END)
  if (!text.startsWith(CONTEXT_START) || end === -1) return text
  return text.slice(end + CONTEXT_END.length).trim()
}
