import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../vault/vault'
import type { LearnInput } from './agent'
import { Learner } from './learner'
import { afterDrawing, PlaybookStore, SETTLE_MS } from './playbook'

let dir: string
let store: PlaybookStore
let vault: Vault
let runs: LearnInput[]
let fail: string | null

const write = async (rel: string, text: string, age = 2 * SETTLE_MS): Promise<void> => {
  const file = path.join(dir, 'vault', rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
  const when = new Date(Date.now() - age)
  await fs.utimes(file, when, when)
}

const box = (id: string, text: string): object => ({
  id,
  type: 'text',
  shape: 'class',
  text,
  x: 0,
  y: 0,
  width: 100,
  height: 60
})

function learner(): Learner {
  return new Learner({
    playbooks: store,
    vault: () => vault,
    // Like Claude: saves a playbook naming the lesson, says what it did.
    learn: async () => async (input) => {
      runs.push(input)
      if (fail) throw new Error(fail)
      const lesson = /Lesson: (.+)\./.exec(input.text)![1]
      await store.write(
        'uml',
        'DSS',
        'text',
        `${await store.read('uml', 'DSS', 'text')}- ${lesson}\n`
      )
      return `- Learned ${lesson}`
    },
    tools: () => async () => ({ id: '', ok: true, text: '' }),
    input: async () => ({
      settings: {} as LearnInput['settings'],
      memory: { me: '', course: 'DSS', courseNote: '' },
      apiKey: null
    }),
    emit: () => {}
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-learner-'))
  store = new PlaybookStore(path.join(dir, 'skills'))
  await fs.mkdir(path.join(dir, 'vault'))
  vault = new Vault(path.join(dir, 'vault'), async () => {})
  runs = []
  fail = null
  await write('DSS/les_1/1 Intro.pdf', 'pdf')
  await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases.')
  await write('DSS/les_2/2 Class diagrams.pdf', 'pdf')
})

afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('Learner', () => {
  it('takes in a course lesson by lesson, each in its own run, and keeps what it learned', async () => {
    await learner().run('uml', 'DSS', false)
    expect(runs.map((r) => r.text.split('\n')[0])).toEqual([
      'Course: DSS. Lesson: DSS/les_1.',
      'Course: DSS. Lesson: DSS/les_2.'
    ])
    expect(runs[0].text).toContain('- DSS/les_1/1 Intro.pdf (slides or other PDF, new)')
    expect(runs[0].text).toContain('(empty: this is the first lesson you take in)')
    // The second lesson builds on the first.
    expect(runs[1].text).toContain('<playbook>\n- DSS/les_1\n</playbook>')
    const state = await store.state('uml', 'DSS')
    expect(Object.keys(state.learned)).toHaveLength(3)
    expect(state.log.map((l) => l.summary)).toEqual(['- Learned DSS/les_2', '- Learned DSS/les_1'])

    // Nothing new: no run at all.
    runs = []
    await learner().run('uml', 'DSS', false)
    expect(runs).toEqual([])
  })

  it('leaves files I am still changing for later, unless I ask', async () => {
    await learner().run('uml', 'DSS', false)
    runs = []
    await write('DSS/les_2/Notes.md', 'Aggregation is a white diamond', 0)
    await learner().run('uml', 'DSS', true)
    expect(runs).toEqual([])
    await learner().run('uml', 'DSS', false)
    expect(runs[0].text).toContain('- DSS/les_2/Notes.md (my note, new)')
  })

  it('takes in new slides and transcripts soon, notes only an hour after my last change', async () => {
    await learner().run('uml', 'DSS', false)
    runs = []
    const quarter = 15 * 60_000
    await write('DSS/les_3/Transcript 7 Patterns.md', '**00:10** The creator pattern.', quarter)
    await write('DSS/les_3/7 Patterns.pdf', 'pdf', quarter)
    await write('DSS/les_3/Summary.md', 'Creator: who makes it', quarter)
    await learner().run('uml', 'DSS', true)
    expect(runs).toHaveLength(1)
    expect(runs[0].text).toContain('- DSS/les_3/7 Patterns.pdf (slides or other PDF, new)')
    expect(runs[0].text).toContain('- DSS/les_3/Transcript 7 Patterns.md (transcript, new)')
    expect(runs[0].text).not.toContain('Summary.md')
  })

  it('shows my changes to a diagram it drew, and skips one I left alone', async () => {
    await learner().run('uml', 'DSS', false)
    const drawn = JSON.stringify({ nodes: [box('o', 'Order\n---\n- id: int')], edges: [] })
    const mine = JSON.stringify({ nodes: [box('o', 'Order\n---\n- orderId: String')], edges: [] })
    await store.update('uml', 'DSS', (s) => afterDrawing(s, 'DSS/les_2/Shop.canvas', '', drawn))
    await write('DSS/les_2/Shop.canvas', drawn)

    runs = []
    await learner().run('uml', 'DSS', false)
    expect(runs).toEqual([])
    expect(Object.keys((await store.state('uml', 'DSS')).learned)).toContain(
      'DSS/les_2/Shop.canvas'
    )

    await write('DSS/les_2/Shop.canvas', mine)
    await learner().run('uml', 'DSS', false)
    expect(runs[0].text).toContain(
      '- DSS/les_2/Shop.canvas: a canvas you drew. What I changed since:\n' +
        '    - In "Order": removed "- id: int"; added "- orderId: String"'
    )
    // Taken in: the next run does not see them again.
    expect((await store.state('uml', 'DSS')).drawn['DSS/les_2/Shop.canvas']).toBe(mine)
  })

  it('stops at the first lesson that fails and says why, learning nothing from it', async () => {
    fail = 'You have reached your usage limit'
    await learner().run('uml', 'DSS', false)
    expect(runs).toHaveLength(1)
    const state = await store.state('uml', 'DSS')
    expect(state.error).toBe('You have reached your usage limit')
    expect(state.learned).toEqual({})

    fail = null
    await learner().run('uml', 'DSS', false)
    expect((await store.state('uml', 'DSS')).error).toBeNull()
  })
})
