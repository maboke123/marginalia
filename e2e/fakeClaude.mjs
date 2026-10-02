// A scripted stand-in for Claude, loaded by the app when MARGINALIA_FAKE_CLAUDE points here.
// It follows the same contract as the real agent (src/main/claude/agent.ts) and logs what it
// received to MARGINALIA_FAKE_LOG, so tests can check the context packet.
import { promises as fs } from 'fs'

const LOG = process.env.MARGINALIA_FAKE_LOG

async function readLog() {
  try {
    return JSON.parse(await fs.readFile(LOG, 'utf8'))
  } catch {
    return {}
  }
}

// Requests can run at once; one write at a time keeps them from overwriting each other.
let writing = Promise.resolve()

function record(sessionId, entry) {
  writing = writing.then(async () => {
    const log = await readLog()
    log[sessionId] = [...(log[sessionId] ?? []), entry]
    await fs.writeFile(LOG, JSON.stringify(log, null, 2))
  })
  return writing
}

const match = (text, re) => re.exec(text)?.[1]

export async function* agent(input) {
  const sessionId = input.sessionId ?? `fake-${Date.now()}`
  input.onSession(sessionId)
  const question = input.text.split('</context>').pop().trim()
  const slides = match(input.text, /^Slides: (.+), page \d+ of/m)
  const page = Number(match(input.text, /^Slides: .+, page (\d+) of/m) ?? 1)
  const summary = match(input.text, /^Summary: (.+)$/m)

  if (/explain/i.test(question)) {
    yield { type: 'text', text: 'This is the **information gain** ' }
    yield { type: 'text', text: 'formula: $IG(S,t) = H(S) - \\sum_v \\frac{|S_v|}{|S|} H(S_v)$.' }
  } else if (/short version/i.test(question)) {
    yield { type: 'tool', name: 'insert_into_summary', input: { file: summary } }
    const reply = await input.callTool('insert_into_summary', {
      file: summary,
      position: 'heading',
      heading: 'Information gain',
      markdown: 'Short version: pick the split that lowers entropy the most.'
    })
    yield { type: 'text', text: reply.ok ? 'Added it under Information gain.' : reply.text }
  } else if (/note next to/i.test(question)) {
    yield { type: 'tool', name: 'add_text_annotation', input: { file: slides, page } }
    const reply = await input.callTool('add_text_annotation', {
      file: slides,
      page,
      markdown: 'Gain = drop in entropy, $\\Delta H$'
    })
    yield { type: 'text', text: reply.ok ? 'Put a note in the margin.' : reply.text }
  } else if (/highlight/i.test(question)) {
    const reply = await input.callTool('add_highlight', {
      file: slides,
      page,
      text: 'Information gain'
    })
    yield { type: 'text', text: reply.ok ? 'Highlighted it.' : reply.text }
  } else {
    yield { type: 'text', text: `You asked: ${question}` }
  }

  await record(sessionId, {
    text: input.text,
    images: input.images.length,
    question
  })
  yield { type: 'done' }
}

/** Earlier messages of a session, like the real agent reads them from Claude Code's transcripts. */
export async function history(sessionId) {
  const log = await readLog()
  return (log[sessionId] ?? []).flatMap((entry) => [
    { role: 'user', text: entry.question },
    { role: 'assistant', text: `Earlier answer to: ${entry.question}` }
  ])
}

/** The one-off request behind /claude in a note. "slow" waits until it is cancelled. */
export async function complete(input) {
  await record('complete', { text: input.text, images: input.images.length, question: 'complete' })
  const ask = /What to write at ⟦here⟧: (.*)$/.exec(input.text)?.[1] ?? ''
  const wait = ask.startsWith('slow') ? 60_000 : ask.startsWith('later') ? 1500 : 400
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, wait)
    input.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
  // Real answers sometimes put display math in the middle of a line.
  if (ask.startsWith('display')) return '$$x_{k+1} = x_k - \\alpha \\nabla f(x_k)$$'
  return '$\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'
}
