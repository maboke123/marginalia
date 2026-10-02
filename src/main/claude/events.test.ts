import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { toChatEvents, toHistory, type StreamState } from './events'

// Only the fields the code reads; the real messages carry many more.
const msg = (m: object): SDKMessage => ({ parent_tool_use_id: null, ...m }) as SDKMessage

const stream = (event: object): SDKMessage => msg({ type: 'stream_event', event })

describe('toChatEvents', () => {
  it('streams text and separates text blocks around a tool call', () => {
    const state: StreamState = { hasText: false }
    const events = [
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Let me ' }
      }),
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'look.' }
      }),
      stream({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'thinking_delta', thinking: '…' }
      }),
      msg({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'mcp__marginalia__read_pdf_page',
              input: { page: 3 }
            }
          ]
        }
      }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Done.' }
      }),
      msg({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' })
    ].flatMap((m) => toChatEvents(m, state))

    expect(events).toEqual([
      { type: 'text', text: 'Let me ' },
      { type: 'text', text: 'look.' },
      { type: 'tool', name: 'read_pdf_page', input: { page: 3 } },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'Done.' },
      { type: 'done' }
    ])
  })

  it('reports errors, also when the result says success but is an error', () => {
    const state: StreamState = { hasText: false }
    expect(
      toChatEvents(
        msg({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }),
        state
      )
    ).toEqual([{ type: 'done', error: 'Not logged in' }])
    expect(
      toChatEvents(msg({ type: 'result', subtype: 'error_max_turns', errors: [] }), state)
    ).toEqual([{ type: 'done', error: 'Claude stopped early' }])
  })

  it('ignores what subagents say', () => {
    const nested = msg({
      type: 'stream_event',
      parent_tool_use_id: 'toolu_1',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }
    })
    expect(toChatEvents(nested, { hasText: false })).toEqual([])
  })
})

describe('toHistory', () => {
  const session = (type: 'user' | 'assistant', content: unknown): SessionMessage =>
    ({ type, message: { content }, parent_tool_use_id: null }) as SessionMessage

  it('keeps questions without their context and joins the parts of an answer', () => {
    const history = toHistory([
      session('user', [
        {
          type: 'text',
          text: '<context>\nSlides: ML/slides.pdf, page 3\n</context>\n\nExplain this'
        },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
      ]),
      session('assistant', [{ type: 'thinking', thinking: '' }]),
      session('assistant', [{ type: 'text', text: 'Entropy measures disorder.' }]),
      session('assistant', [{ type: 'tool_use', name: 'Read', input: {} }]),
      session('user', [{ type: 'tool_result', tool_use_id: 't', content: 'file text' }]),
      session('assistant', [{ type: 'text', text: 'See [slide 3](ML/slides.pdf#page=3).' }]),
      session('user', 'Thanks')
    ])

    expect(history).toEqual([
      { role: 'user', text: 'Explain this' },
      {
        role: 'assistant',
        text: 'Entropy measures disorder.\n\nSee [slide 3](ML/slides.pdf#page=3).'
      },
      { role: 'user', text: 'Thanks' }
    ])
  })
})
