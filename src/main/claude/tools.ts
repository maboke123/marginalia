import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ToolReply } from '../../shared/claude'
import { SERVER_NAME } from './events'

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>

/** Runs an app tool in the renderer, where the open documents and their undo history live. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolReply>

const file = z.string().describe('Vault path with forward slashes, as in the context packet')
const pdf = file.describe('Vault path of a .pdf file')
const note = file.describe('Vault path of a .md file')
const page = z.number().int().min(1).describe('1-based page number')

const READ_ONLY = { readOnlyHint: true }

function toResult(reply: ToolReply): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: reply.text }]
  if (reply.image) {
    content.push({
      type: 'image',
      data: Buffer.from(reply.image.data).toString('base64'),
      mimeType: reply.image.mediaType
    })
  }
  return { content, isError: !reply.ok }
}

/** The app tools from SPEC section 6, as an in-process MCP server. */
export function appToolServer(sdk: Sdk, call: CallTool): McpSdkServerConfigWithInstance {
  const run =
    (name: string) =>
    async (args: Record<string, unknown>): Promise<CallToolResult> =>
      toResult(await call(name, args))

  const tools = [
    sdk.tool(
      'get_current_view',
      'What I am looking at right now: open slides and page, the page text, my annotations ' +
        'there, selected text, and the summary around my cursor.',
      {},
      run('get_current_view'),
      { annotations: READ_ONLY }
    ),
    sdk.tool(
      'read_pdf_page',
      'Text and an image of one page of a slide PDF.',
      { file: pdf, page },
      run('read_pdf_page'),
      { annotations: READ_ONLY }
    ),
    sdk.tool(
      'read_summary',
      'Markdown of a summary, or of one section of it when a heading is given. Includes edits ' +
        'that are not saved yet.',
      { file: note, heading: z.string().optional().describe('Heading text, without the #') },
      run('read_summary'),
      { annotations: READ_ONLY }
    ),
    sdk.tool(
      'insert_into_summary',
      'Adds Markdown to a summary: at my cursor, at the end, or at the end of the section ' +
        'under a heading. Opens the file so I see the change; I can undo it in one step.',
      {
        file: note,
        position: z.enum(['cursor', 'end', 'heading']),
        heading: z.string().optional().describe('Heading text when position is "heading"'),
        markdown: z.string()
      },
      run('insert_into_summary')
    ),
    sdk.tool(
      'replace_in_summary',
      'Replaces text in a summary. old_text must appear exactly once; otherwise nothing changes.',
      { file: note, old_text: z.string(), new_text: z.string() },
      run('replace_in_summary')
    ),
    sdk.tool(
      'add_text_annotation',
      'Puts a Markdown text box on a slide. Without x and y it goes in the margin to the right ' +
        'of the page, under any boxes already there. x and y are PDF points from the top-left.',
      { file: pdf, page, markdown: z.string(), x: z.number().optional(), y: z.number().optional() },
      run('add_text_annotation')
    ),
    sdk.tool(
      'add_highlight',
      'Finds text on a slide and highlights it.',
      { file: pdf, page, text: z.string().describe('Text exactly as it appears on the page') },
      run('add_highlight')
    ),
    sdk.tool(
      'goto',
      'Opens a file in the app, and a PDF at a page.',
      { file, page: page.optional() },
      run('goto'),
      { annotations: READ_ONLY }
    )
  ]
  return sdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools })
}

export const APP_TOOLS = [
  'get_current_view',
  'read_pdf_page',
  'read_summary',
  'insert_into_summary',
  'replace_in_summary',
  'add_text_annotation',
  'add_highlight',
  'goto'
].map((name) => `mcp__${SERVER_NAME}__${name}`)
