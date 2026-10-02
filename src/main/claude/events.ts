import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { stripContext, type ChatEvent, type ChatHistoryItem } from '../../shared/claude'

export const SERVER_NAME = 'marginalia'
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/** Per answer: whether text was streamed already, so a later text block starts a new paragraph. */
export interface StreamState {
  hasText: boolean
}

type Block = { type: string; text?: string; name?: string; input?: unknown }

/** Turns SDK messages into the few events the chat panel shows. */
export function toChatEvents(message: SDKMessage, state: StreamState): ChatEvent[] {
  // Subagents are not enabled; anything nested is not part of the visible answer.
  if ('parent_tool_use_id' in message && message.parent_tool_use_id) return []

  if (message.type === 'stream_event') {
    const event = message.event
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      return state.hasText ? [{ type: 'text', text: '\n\n' }] : []
    }
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      state.hasText = true
      return [{ type: 'text', text: event.delta.text }]
    }
    return []
  }

  if (message.type === 'assistant') {
    return (message.message.content as Block[])
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({
        type: 'tool',
        name: block.name!.replace(TOOL_PREFIX, ''),
        input: (block.input ?? {}) as Record<string, unknown>
      }))
  }

  if (message.type === 'result') {
    if (message.subtype !== 'success') {
      return [{ type: 'done', error: message.errors.join('\n') || 'Claude stopped early' }]
    }
    return [message.is_error ? { type: 'done', error: message.result } : { type: 'done' }]
  }

  return []
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = (content as Block[]).filter((b) => b.type === 'text').map((b) => b.text ?? '')
  return texts.length ? texts.join('\n\n') : null
}

/**
 * A stored session as chat bubbles: the questions without their context packet and the
 * answers' text. Tool calls and tool results are left out.
 */
export function toHistory(messages: SessionMessage[]): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = []
  for (const m of messages) {
    if (m.parent_tool_use_id) continue
    const content = (m.message as { content?: unknown } | null)?.content
    const text = textOf(content)
    if (text === null || !text.trim()) continue
    if (m.type === 'user') {
      items.push({ role: 'user', text: stripContext(text) })
    } else if (m.type === 'assistant') {
      // The SDK stores one message per content block; they belong to the same answer.
      const last = items[items.length - 1]
      if (last?.role === 'assistant') last.text += '\n\n' + text
      else items.push({ role: 'assistant', text })
    }
  }
  return items
}
