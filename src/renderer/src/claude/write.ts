import { slideContext } from './context'
import { parseAnswer, type WriteAnswer } from './writePlan'

// "/claude <what to write>" + Enter, in a note or in a text box on a slide: Claude's answer
// replaces the request. Several can run at once; each has an id to cancel it by.

/** The last "/claude <request>" on a line: an earlier one is text I kept, not this request. */
export function findRequest(line: string): { at: number; ask: string } | null {
  let found: { at: number; ask: string } | null = null
  for (const m of line.matchAll(/(^|\s)\/claude\s+/gi)) {
    const ask = line.slice(m.index + m[0].length).trim()
    if (ask) found = { at: m.index + m[1].length, ask }
  }
  return found
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

/** Requests that were cancelled, also while still being prepared (before main knows them). */
const cancelled = new Set<string>()
let nextId = 0

export const newRequestId = (): string => `w${Date.now().toString(36)}-${++nextId}`

export function cancelWrite(id: string): void {
  cancelled.add(id)
  void window.api.claude.cancelComplete(id)
}

export interface WriteRequest {
  id: string
  /** Where the text goes, for Claude: "my note ML/B2/Summary.md, under Entropy". */
  where: string
  /** The text around the spot, with ⟦here⟧ where the answer goes. */
  around: string
  ask: string
  /** A slide to send along (text and image). */
  slide?: { path: string; page: number }
}

/** Asks Claude what to put at ⟦here⟧ and what to change around it. Throws Cancelled. */
export async function writeWithClaude(request: WriteRequest): Promise<WriteAnswer> {
  try {
    const slide = request.slide
      ? await slideContext(request.slide.path, request.slide.page, null)
      : null
    if (cancelled.has(request.id)) throw new Cancelled()
    const text = [
      slide?.lines.join('\n') ?? '',
      `I am writing in ${request.where}.`,
      'Here is the text around the spot; ⟦here⟧ marks where your text goes:',
      `<text>\n${request.around}\n</text>`,
      `My request at ⟦here⟧: ${request.ask}`,
      // Last, because the smaller models follow the final instruction most closely.
      'Reply with only the text that goes into my notes (and FIND/REPLACE blocks for changes). ' +
        'No "Here is", no explanation before or after it.'
    ]
      .filter(Boolean)
      .join('\n\n')
    let answer: string
    try {
      answer = await window.api.claude.complete({
        id: request.id,
        text,
        images: slide?.images ?? []
      })
    } catch (err) {
      if (cancelled.has(request.id)) throw new Cancelled()
      throw err
    }
    if (cancelled.has(request.id)) throw new Cancelled()
    return parseAnswer(answer)
  } finally {
    cancelled.delete(request.id)
  }
}
