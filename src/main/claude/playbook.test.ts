import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NOT_TRANSCRIBED } from '../transcribe/transcript'
import { Vault } from '../vault/vault'
import {
  afterDrawing,
  courseSources,
  editsOf,
  editsTaken,
  lessonsOf,
  notLearned,
  PlaybookStore,
  withRule,
  type CourseState
} from './playbook'

let dir: string
let store: PlaybookStore
let vault: Vault

const write = async (rel: string, text = ''): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, 'vault', rel)), { recursive: true })
  await fs.writeFile(path.join(dir, 'vault', rel), text)
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-playbook-'))
  store = new PlaybookStore(path.join(dir, 'skills'))
  await fs.mkdir(path.join(dir, 'vault'))
  vault = new Vault(path.join(dir, 'vault'), async () => {})
})

afterEach(() => fs.rm(dir, { recursive: true, force: true }))

const canvas = (nodes: { id: string; text: string }[], edges: object[] = []): string =>
  JSON.stringify({
    nodes: nodes.map((n) => ({
      ...n,
      type: 'text',
      shape: 'class',
      x: 0,
      y: 0,
      width: 100,
      height: 60
    })),
    edges
  })

describe('PlaybookStore', () => {
  it('keeps what it learned and my rules per course, outside the vault', async () => {
    expect(await store.read('uml', 'DSS', 'text')).toBe('')
    await store.write('uml', 'DSS', 'text', '## Notation\n- Multiplicities on both ends')
    await store.write('uml', 'DSS', 'rules', '- No getters and setters')
    expect(await store.read('uml', 'DSS', 'text')).toBe(
      '## Notation\n- Multiplicities on both ends\n'
    )
    expect(await store.read('uml', 'DSS', 'rules')).toBe('- No getters and setters\n')
    expect((await fs.readdir(path.join(dir, 'skills', 'uml', 'courses'))).sort()).toEqual([
      'DSS.md',
      'DSS.rules.md'
    ])
    await expect(store.write('uml', '', 'text', 'x')).rejects.toThrow('course')
    await expect(store.write('summary', 'DSS', 'text', 'x')).rejects.toThrow('does not learn')
  })

  it('adds rules one at a time, also when they arrive together', async () => {
    await Promise.all([
      store.addRule('uml', 'DSS', 'No getters and setters'),
      store.addRule('uml', 'DSS', 'Name every association'),
      store.addRule('uml', 'DSS', 'Name every association')
    ])
    expect(await store.read('uml', 'DSS', 'rules')).toBe(
      '- No getters and setters\n- Name every association\n'
    )
    await store.addRule(
      'uml',
      'DSS',
      'Getters only for derived attributes',
      'no getters and setters'
    )
    await store.addRule('uml', 'DSS', '', 'Name every association')
    expect(await store.read('uml', 'DSS', 'rules')).toBe('- Getters only for derived attributes\n')
  })

  it('remembers which courses it learns', async () => {
    expect(await store.learning('uml')).toEqual([])
    await store.update('uml', 'DSS', (s) => ({ ...s, learning: true }))
    await store.update('uml', 'ML', (s) => ({ ...s, learned: { 'ML/a.pdf': '1-2|' } }))
    expect(await store.learning('uml')).toEqual(['DSS'])
    expect((await store.state('uml', 'ML')).learned).toEqual({ 'ML/a.pdf': '1-2|' })
  })
})

describe('withRule', () => {
  it('replaces the rule it names, by its words, and says when there was none', () => {
    const rules = '## Mine\n- Use «interface» for interfaces\n- Attributes are private\n'
    expect(withRule(rules, 'Attributes may be protected', 'attributes are private')).toEqual({
      rules: '## Mine\n- Use «interface» for interfaces\n- Attributes may be protected\n',
      found: true
    })
    expect(withRule(rules, 'X', 'never heard of it').found).toBe(false)
    expect(withRule('', '', 'anything').rules).toBe('')
  })

  it('says who a rule comes from, and takes the newer source for the same words', () => {
    const mine = withRule('', 'No getters in class diagrams').rules
    const ta = withRule(mine, 'No getters in class diagrams', undefined, 'the TA, iteration 1')
    expect(ta.rules).toBe('- No getters in class diagrams (from the TA, iteration 1)\n')
    // Replacing by its words works with or without the source.
    expect(
      withRule(ta.rules, 'Getters only when derived', 'no getters in class diagrams').rules
    ).toBe('- Getters only when derived\n')
    // A replacement whose words were there already leaves one line.
    const two = '- Aggregation for parts\n- Composition for parts\n'
    expect(withRule(two, 'Composition for parts', 'aggregation for parts').rules).toBe(
      '- Composition for parts\n'
    )
  })
})

describe('renames in the vault', () => {
  it('move what was learned along, and a renamed notebook takes its playbook', async () => {
    await store.write('uml', 'DSS', 'rules', '- No getters')
    await store.update('uml', 'DSS', (s) => ({
      ...s,
      learning: true,
      learned: { 'DSS/les_1/a.pdf': '1-2|', 'DSS/les_1/b.md': '3-4', 'DSS/les_2/c.md': '5-6' },
      drawn: { 'DSS/les_1/Shop.canvas': '{}' }
    }))

    await store.remap('DSS/les_1', 'DSS/les_1 Intro')
    expect((await store.state('uml', 'DSS')).learned).toEqual({
      'DSS/les_1 Intro/a.pdf': '1-2|',
      'DSS/les_1 Intro/b.md': '3-4',
      'DSS/les_2/c.md': '5-6'
    })
    expect(Object.keys((await store.state('uml', 'DSS')).drawn)).toEqual([
      'DSS/les_1 Intro/Shop.canvas'
    ])

    await store.remap('DSS/les_2/c.md', null)
    await store.remap('DSS/les_1 Intro/b.md', 'ML/b.md')
    expect(Object.keys((await store.state('uml', 'DSS')).learned)).toEqual([
      'DSS/les_1 Intro/a.pdf'
    ])

    await store.remap('DSS', 'Design of Software Systems')
    expect(await store.read('uml', 'Design of Software Systems', 'rules')).toBe('- No getters\n')
    expect(await store.learning('uml')).toEqual(['Design of Software Systems'])
    expect(Object.keys((await store.state('uml', 'Design of Software Systems')).learned)).toEqual([
      'Design of Software Systems/les_1 Intro/a.pdf'
    ])
  })

  it('reach the store when the vault renames a folder', async () => {
    const seen: [string, string | null][] = []
    const watched = new Vault(
      path.join(dir, 'vault'),
      async () => {},
      async (from, to) => {
        seen.push([from, to])
      }
    )
    await write('DSS/les_1/notes.md', 'x')
    await watched.rename('DSS/les_1', 'les_1 Intro')
    await watched.trash('DSS/les_1 Intro/notes.md')
    expect(seen).toEqual([
      ['DSS/les_1', 'DSS/les_1 Intro'],
      ['DSS/les_1 Intro/notes.md', null]
    ])
  })
})

describe('course sources', () => {
  it('takes every PDF, transcript, note and canvas of the course, in sidebar order', async () => {
    await write('DSS/les_1/1 Intro.pdf', 'pdf')
    await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases.')
    await write('DSS/les_1/Summary.md', 'my notes')
    await write('DSS/les_1/Empty.md', '  \n')
    await write('DSS/les_1/Transcript 2026-09-25 10-30.md', `# Transcript\n\n${NOT_TRANSCRIBED}\n`)
    // A live transcription that wrote nothing: only the header.
    await write(
      'DSS/les_1/Transcript 2026-09-26 10-30.md',
      '# Transcript 26 September 2026, 10:30\n\nRecorded live.\nAudio: [r.webm](assets/r.webm)\n'
    )
    await write('DSS/les_2/Shop.canvas', canvas([]))
    await write('ML/B2/slides.pdf', 'pdf')
    const sources = await courseSources(vault, 'DSS')
    expect(Object.entries(sources).map(([p, s]) => [p, s.kind])).toEqual([
      ['DSS/les_1/1 Intro.pdf', 'pdf'],
      ['DSS/les_1/Summary.md', 'note'],
      ['DSS/les_1/Transcript 2026-09-24 10-30.md', 'transcript'],
      ['DSS/les_2/Shop.canvas', 'canvas']
    ])
  })

  it('offers new and changed files, and a PDF whose annotations alone changed', async () => {
    await write('DSS/les_1/1 Intro.pdf', 'pdf')
    await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases.')
    await write('DSS/les_2/2 Class diagrams.pdf', 'pdf')
    const sources = await courseSources(vault, 'DSS')
    const learned = Object.fromEntries(
      Object.entries(sources)
        .slice(0, 2)
        .map(([p, s]) => [p, s.stamp])
    )
    expect(notLearned(sources, learned)).toEqual([
      { path: 'DSS/les_2/2 Class diagrams.pdf', kind: 'pdf', why: 'new' }
    ])

    await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases. And actors.')
    await write('DSS/les_1/1 Intro.pdf.annotations.json', '{"version":1,"pages":{}}')
    const now = await courseSources(vault, 'DSS')
    expect(notLearned(now, learned).map((p) => [p.path, p.why])).toEqual([
      ['DSS/les_1/1 Intro.pdf', 'annotations'],
      ['DSS/les_1/Transcript 2026-09-24 10-30.md', 'changed'],
      ['DSS/les_2/2 Class diagrams.pdf', 'new']
    ])
    expect(lessonsOf(notLearned(now, learned)).map((l) => [l.folder, l.files.length])).toEqual([
      ['DSS/les_1', 2],
      ['DSS/les_2', 1]
    ])
  })
})

describe('my changes to the canvases Claude drew', () => {
  const state: CourseState = {
    learning: true,
    learned: {},
    drawn: {},
    edits: {},
    log: [],
    error: null
  }
  const drawn = canvas([{ id: 'o', text: 'Order\n---\n- id: int' }])
  const mine = canvas([{ id: 'o', text: 'Order\n---\n- orderId: String' }])

  it('are what changed since Claude left it, kept when Claude draws on it again', () => {
    expect(editsOf(state, 'DSS/a.canvas', mine)).toBeNull()
    const s1 = afterDrawing(state, 'DSS/a.canvas', canvas([]), drawn)
    expect(editsOf(s1, 'DSS/a.canvas', drawn)).toEqual([])
    expect(editsOf(s1, 'DSS/a.canvas', mine)).toEqual([
      'In "Order": removed "- id: int"; added "- orderId: String"'
    ])

    // Claude adds a class after my change: my change stays to be taken in.
    const more = canvas([
      { id: 'o', text: 'Order\n---\n- orderId: String' },
      { id: 'c', text: 'Customer' }
    ])
    const s2 = afterDrawing(s1, 'DSS/a.canvas', mine, more)
    expect(editsOf(s2, 'DSS/a.canvas', more)).toEqual([
      'In "Order": removed "- id: int"; added "- orderId: String"'
    ])

    const s3 = editsTaken(s2, { 'DSS/a.canvas': more })
    expect(editsOf(s3, 'DSS/a.canvas', more)).toEqual([])
    expect(s3.edits).toEqual({})
  })
})
