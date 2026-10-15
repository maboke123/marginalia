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
  } else if (/circle/i.test(question)) {
    const reply = await input.callTool('add_drawing', {
      file: slides,
      page,
      lines: [
        [
          [50, 40],
          [300, 40],
          [300, 110],
          [50, 110],
          [50, 40]
        ]
      ]
    })
    yield { type: 'text', text: reply.ok ? 'Circled it.' : reply.text }
  } else if (/rework/i.test(question)) {
    // Every step through the tools, as the real agent would: page, box, list, edit, remove.
    const steps = []
    const call = async (name, args) => {
      const reply = await input.callTool(name, { file: slides, ...args })
      steps.push(`${name}: ${reply.ok ? 'ok' : reply.text}`)
      return reply.text
    }
    const added = await call('add_blank_page', { after_page: page })
    const blank = Number(match(added, /blank page ([\d.]+)/))
    await call('add_text_annotation', { page: blank, markdown: 'Worked example', x: 40, y: 40 })
    await call('add_highlight', { page, text: 'Information gain', style: 'underline' })
    const listing = await call('list_annotations', {})
    const box = match(listing, /text box (t_\w+)/)
    const line = match(listing, /underline (h_\w+)/)
    await call('edit_annotation', { page: blank, id: box, markdown: 'Worked example, step 2' })
    await call('edit_annotation', { page: blank, id: box, to_page: page, x: 980, y: 300 })
    await call('delete_annotations', { page, ids: [line] })
    await call('delete_annotations', { page, ids: ['t_nope'] })
    yield { type: 'text', text: steps.join('\n\n') }
  } else if (question.startsWith('/summary')) {
    // A skill: its steps come in the context, the chat shows only the command.
    const text = await input.callTool('read_pdf_text', { file: slides })
    const steps = /^Skill \/summary: /m.test(input.text) ? 'got the steps' : 'no steps'
    const reply = await input.callTool('create_note', {
      folder: slides.split('/').slice(0, -1).join('/'),
      name: 'slides summary',
      markdown: '# Decision trees\n\nSplit on the attribute with the most information gain.',
      link_to_pdf: slides
    })
    const pages = (text.text.match(/^--- Page \d+ ---$/gm) ?? []).length
    yield { type: 'text', text: `${steps}, read ${pages} pages. ${reply.text}` }
  } else if (/look at/i.test(question)) {
    // The picture goes next to the log, for the test to measure.
    const reply = await input.callTool('screenshot', { file: slides, page })
    if (reply.image) await fs.writeFile(`${LOG}.png`, reply.image.data)
    yield { type: 'text', text: reply.text }
  } else if (/highlight/i.test(question)) {
    const reply = await input.callTool('add_highlight', {
      file: slides,
      page,
      text: 'Information gain'
    })
    yield { type: 'text', text: reply.ok ? 'Highlighted it.' : reply.text }
  } else if (/^remember/i.test(question)) {
    // "remember: <note>" saves the course note, "remember me: <note>" the one about me.
    const about = /^remember me/i.test(question) ? 'me' : 'course'
    const note = question.slice(question.indexOf(':') + 1).trim()
    yield { type: 'tool', name: 'remember', input: { about } }
    const reply = await input.callTool('remember', { about, note })
    yield { type: 'text', text: reply.text }
  } else if (/get stuck/i.test(question)) {
    // Like a hung CLI: never ends and ignores the stop signal.
    yield { type: 'text', text: 'Working on it' }
    await new Promise(() => {})
  } else {
    yield { type: 'text', text: `You asked: ${question}` }
  }

  await record(sessionId, {
    text: input.text,
    images: input.images.length,
    question,
    instructions: input.settings.instructions,
    memory: input.memory
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
  await record('complete', {
    text: input.text,
    images: input.images.length,
    question: 'complete',
    memory: input.memory
  })
  // The request is its own line; instructions may follow it.
  const ask = /My request at ⟦here⟧: (.*)$/m.exec(input.text)?.[1] ?? ''
  const wait = ask.startsWith('slow') ? 60_000 : ask.startsWith('later') ? 1500 : 400
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, wait)
    input.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
  // Blocks: display math right under a line of text, and a chart in a fence.
  if (ask.startsWith('block')) {
    return 'The risk:\n$$\nR = L \\times I\n$$\n\n```mermaid\ngraph TD\n  A-->B\n```'
  }
  if (ask.startsWith('long')) {
    return Array.from({ length: 30 }, (_, i) => `Point ${i + 1} of a long answer.`).join('\n\n')
  }
  // Real answers sometimes put display math in the middle of a line.
  if (ask.startsWith('display')) return '$$x_{k+1} = x_k - \\alpha \\nabla f(x_k)$$'
  // Changing and removing text that is already there, the way the real prompt asks for it.
  if (ask.startsWith('change the formula above')) {
    return [
      '<<<<<<< FIND',
      '$\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$',
      '=======',
      '$\\alpha^* = \\arg\\min_{\\alpha > 0} L(\\alpha)$',
      '>>>>>>> REPLACE'
    ].join('\n')
  }
  if (ask.startsWith('remove the line above')) {
    return ['<<<<<<< FIND', 'Background: /claude slow', '=======', '>>>>>>> REPLACE'].join('\n')
  }
  return '$\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'
}
