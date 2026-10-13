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
const annotationPage = z
  .number()
  .min(1)
  .describe(
    '1-based slide number, or a blank page I added, like 3.1 for the first one after slide 3'
  )
const color = z.string().describe('Hex colour like #cf222e')

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
      'read_pdf_text',
      'The text of every page of a slide PDF (or of pages from_page to to_page), with page ' +
        'numbers, plus the notes linked to it. Cheaper than read_pdf_page for a whole lecture.',
      { file: pdf, from_page: page.optional(), to_page: page.optional() },
      run('read_pdf_text'),
      { annotations: READ_ONLY }
    ),
    sdk.tool(
      'create_note',
      'Makes a new Markdown note with this content and opens it. With link_to_pdf it is linked ' +
        'to those slides (shown under the PDF, and one of the notes lecture mode can open). ' +
        'A name that is taken gets a number. Returns the vault path of the note.',
      {
        folder: z.string().describe('Vault path of the folder, like Machine Learning/B2'),
        name: z.string().describe('File name without .md'),
        markdown: z.string(),
        link_to_pdf: pdf.optional()
      },
      run('create_note')
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
      'Puts a Markdown text box on a slide or blank page. Without x and y it goes in the margin ' +
        'to the right of the page, under any boxes already there. x, y and width are PDF points ' +
        'from the top-left. It is fitted by itself: wider up to the page edge, or moved up, when ' +
        'its text would run past the bottom of the page; when it cannot fit at all you get an ' +
        'error with where it goes on a blank page. On a blank page use one box at the full ' +
        'width, not columns.',
      {
        file: pdf,
        page: annotationPage,
        markdown: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional()
      },
      run('add_text_annotation')
    ),
    sdk.tool(
      'add_highlight',
      'Finds text on a slide and highlights, underlines or strikes it through.',
      {
        file: pdf,
        page,
        text: z.string().describe('Text exactly as it appears on the page'),
        style: z.enum(['highlight', 'underline', 'strikethrough']).optional(),
        color: color.optional()
      },
      run('add_highlight')
    ),
    sdk.tool(
      'list_annotations',
      'Everything on a PDF that I or you added, with ids and positions: text boxes (with their ' +
        'Markdown), highlights, pen strokes, images and blank pages. Without page: all pages.',
      { file: pdf, page: annotationPage.optional() },
      run('list_annotations'),
      { annotations: READ_ONLY }
    ),
    sdk.tool(
      'edit_annotation',
      'Changes one annotation by id (from list_annotations): a text box its Markdown, x, y, ' +
        'width, font_size or color; a highlight its color or style; a stroke or image its x and ' +
        'y (top-left), and width for an image. to_page moves it to another page or blank page. ' +
        'A text box is fitted on its page like add_text_annotation. Change font_size only when ' +
        'I ask; it never goes below the default size, so to make text fit, move it instead.',
      {
        file: pdf,
        page: annotationPage,
        id: z.string(),
        markdown: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        font_size: z.number().optional(),
        color: color.optional(),
        style: z.enum(['highlight', 'underline', 'strikethrough']).optional(),
        to_page: annotationPage.optional()
      },
      run('edit_annotation')
    ),
    sdk.tool(
      'delete_annotations',
      'Removes annotations from one page by id (from list_annotations).',
      { file: pdf, page: annotationPage, ids: z.array(z.string()).min(1) },
      run('delete_annotations')
    ),
    sdk.tool(
      'add_blank_page',
      'Adds a blank page right after a slide (or after a blank page), for notes that do not ' +
        'fit. Returns its page key, like 3.1, to write on with the other tools.',
      { file: pdf, after_page: annotationPage },
      run('add_blank_page')
    ),
    sdk.tool(
      'add_drawing',
      'Draws pen lines on a page, for arrows, circles around something or underlines. Each ' +
        'line is a list of [x, y] points in PDF points; a circle needs enough points to look round.',
      {
        file: pdf,
        page: annotationPage,
        lines: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1),
        color: color.optional(),
        width: z.number().optional().describe('Pen width, 1 to 8; default is my pen width')
      },
      run('add_drawing')
    ),
    sdk.tool(
      'screenshot',
      'A picture of how something looks in the app right now, exactly as I see it. With a ' +
        'PDF and page: that whole page with everything on it (text boxes, highlights, ink, ' +
        'images, the margin; blank pages like 3.1 too), plus how PDF points map to its pixels. ' +
        'With a note: the part of it on screen. Without file: the whole window. Use it after ' +
        'adding or changing annotations to check they fit, are readable and do not overlap, ' +
        'and fix what looks off.',
      { file: file.optional(), page: annotationPage.optional() },
      run('screenshot'),
      { annotations: READ_ONLY }
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
  'read_pdf_text',
  'create_note',
  'read_summary',
  'insert_into_summary',
  'replace_in_summary',
  'add_text_annotation',
  'add_highlight',
  'list_annotations',
  'edit_annotation',
  'delete_annotations',
  'add_blank_page',
  'add_drawing',
  'screenshot',
  'goto'
].map((name) => `mcp__${SERVER_NAME}__${name}`)
