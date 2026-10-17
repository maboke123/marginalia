import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnnotationFile } from '../../shared/annotations'
import type { VaultNode } from '../../shared/types'
import { writeFileAtomic } from './atomic'
import { resolveInVault, validateName } from './names'
import { timestamp, Vault } from './vault'
import { watchVault } from './watcher'

let root: string
let trashed: string[]
let vault: Vault

async function write(rel: string, content = ''): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

async function list(dir = ''): Promise<string[]> {
  return (await fs.readdir(path.join(root, dir))).sort()
}

const names = (nodes: VaultNode[]): string[] => nodes.map((n) => n.name)

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-'))
  trashed = []
  vault = new Vault(root, async (abs) => {
    trashed.push(path.relative(root, abs).split(path.sep).join('/'))
    await fs.rm(abs, { recursive: true })
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('tree', () => {
  it('shows notebooks, sections and pages and hides app files', async () => {
    await write('Machine Learning/B2 Decision trees/slides.pdf')
    await write('Machine Learning/B2 Decision trees/slides.pdf.annotations.json', '{}')
    await write('Machine Learning/B2 Decision trees/Summary.md')
    await write('Machine Learning/B2 Decision trees/assets/2026-10-02_14-31-05.png')
    await write('Machine Learning/B2 Decision trees/notes.txt')
    await write('Machine Learning/_order.json', '[]')
    await write('.marginalia/settings.json', '{}')
    await write('.obsidian/app.json', '{}')

    const { nodes } = await vault.tree()

    expect(nodes).toEqual([
      {
        name: 'Machine Learning',
        path: 'Machine Learning',
        kind: 'notebook',
        children: [
          {
            name: 'B2 Decision trees',
            path: 'Machine Learning/B2 Decision trees',
            kind: 'section',
            children: [
              {
                name: 'slides.pdf',
                path: 'Machine Learning/B2 Decision trees/slides.pdf',
                kind: 'pdf'
              },
              {
                name: 'Summary.md',
                path: 'Machine Learning/B2 Decision trees/Summary.md',
                kind: 'markdown'
              }
            ]
          }
        ]
      }
    ])
  })

  it('hides tool folders, and the docs of a code folder but not of a notes folder', async () => {
    await write('OvA/rand1_hiring/hiring.py')
    await write('OvA/rand1_hiring/README.md')
    await write('OvA/rand1_hiring/Verslag.md')
    await write('OvA/rand1_hiring/__pycache__/hiring.cpython-312.pyc')
    await write('OvA/rand1_hiring/node_modules/x/index.js')
    await write('OvA/rand1_hiring/figuren/1_random.pdf')
    await write('OvA/les_1/README.md')

    const { nodes } = await vault.tree()

    const [lesson, code] = nodes[0].children!
    expect(names(lesson.children!)).toEqual(['README.md'])
    expect(names(code.children!)).toEqual(['figuren', 'Verslag.md'])
  })

  it('sorts folders first and numbers naturally', async () => {
    await write('ML/B10 Boosting/x.md')
    await write('ML/B2 Trees/x.md')
    await write('ML/Overview.md')
    await write('ML/B9 Bagging/x.md')

    const { nodes } = await vault.tree()

    expect(names(nodes[0].children!)).toEqual([
      'B2 Trees',
      'B9 Bagging',
      'B10 Boosting',
      'Overview.md'
    ])
  })

  it('follows _order.json and puts unlisted items after it', async () => {
    await write('ML/A.md')
    await write('ML/B.md')
    await write('ML/C.md')
    await write('ML/_order.json', JSON.stringify(['C.md', 'gone.md', 'A.md']))

    const { nodes } = await vault.tree()

    expect(names(nodes[0].children!)).toEqual(['C.md', 'A.md', 'B.md'])
  })

  it('ignores a broken _order.json', async () => {
    await write('ML/B.md')
    await write('ML/A.md')
    await write('ML/_order.json', '{ not json')

    const { nodes } = await vault.tree()

    expect(names(nodes[0].children!)).toEqual(['A.md', 'B.md'])
  })
})

describe('create', () => {
  it('creates folders with a free name', async () => {
    expect(await vault.createFolder('', 'New notebook')).toBe('New notebook')
    expect(await vault.createFolder('', 'New notebook')).toBe('New notebook (2)')
    expect(await vault.createFolder('New notebook', 'B2 Trees')).toBe('New notebook/B2 Trees')
    expect(await list()).toEqual(['New notebook', 'New notebook (2)'])
  })

  it('creates empty Markdown pages and never overwrites one', async () => {
    await write('ML/Summary.md', 'my notes')

    expect(await vault.createNote('ML', 'Summary')).toBe('ML/Summary (2).md')
    expect(await vault.createNote('ML', 'Intro.md')).toBe('ML/Intro.md')
    expect(await fs.readFile(path.join(root, 'ML/Summary.md'), 'utf8')).toBe('my notes')
  })

  it('does not put pages at the vault root', async () => {
    await expect(vault.createNote('', 'Loose')).rejects.toThrow('inside a notebook')
  })

  it('rejects names Windows cannot store', async () => {
    await expect(vault.createFolder('', 'a/b')).rejects.toThrow('cannot contain')
    await expect(vault.createFolder('', 'CON')).rejects.toThrow('reserved')
    await expect(vault.createFolder('', '   ')).rejects.toThrow('empty')
    expect(await list()).toEqual([])
  })
})

describe('rename', () => {
  it('keeps the extension and takes the sidecar along', async () => {
    await write('ML/slides.pdf', 'pdf')
    await write('ML/slides.pdf.annotations.json', '{"version":1}')

    expect(await vault.rename('ML/slides.pdf', 'B2 slides')).toBe('ML/B2 slides.pdf')
    expect(await list('ML')).toEqual(['B2 slides.pdf', 'B2 slides.pdf.annotations.json'])
  })

  it('refuses to overwrite an existing file', async () => {
    await write('ML/a.md', 'a')
    await write('ML/b.md', 'b')

    await expect(vault.rename('ML/a.md', 'b')).rejects.toThrow('already exists')
    expect(await fs.readFile(path.join(root, 'ML/b.md'), 'utf8')).toBe('b')
  })

  it('allows changing only the case', async () => {
    await write('ML/trees.md')

    expect(await vault.rename('ML/trees.md', 'Trees')).toBe('ML/Trees.md')
    expect(await list('ML')).toEqual(['Trees.md'])
  })

  it('updates _order.json and the notebook colour', async () => {
    await write('ML/A.md')
    await write('ML/B.md')
    await write('ML/_order.json', JSON.stringify(['B.md', 'A.md']))
    await vault.setColor('ML', 'teal')

    await vault.rename('ML/B.md', 'Z')
    await vault.rename('ML', 'Machine Learning')

    const { nodes, colors } = await vault.tree()
    expect(names(nodes[0].children!)).toEqual(['Z.md', 'A.md'])
    expect(colors).toEqual({ 'Machine Learning': 'teal' })
  })

  it('keeps colours of subfolders through rename, move and trash', async () => {
    await fs.mkdir(path.join(root, 'ML/B2/extra'), { recursive: true })
    await fs.mkdir(path.join(root, 'Stats'))
    await vault.setColor('ML/B2', 'darkgreen')
    await vault.setColor('ML/B2/extra', 'orange')

    await vault.rename('ML', 'Machine Learning')
    expect((await vault.tree()).colors).toEqual({
      'Machine Learning/B2': 'darkgreen',
      'Machine Learning/B2/extra': 'orange'
    })

    await vault.move('Machine Learning/B2', 'Stats')
    expect((await vault.tree()).colors).toEqual({
      'Stats/B2': 'darkgreen',
      'Stats/B2/extra': 'orange'
    })

    await vault.trash('Stats/B2/extra')
    expect((await vault.tree()).colors).toEqual({ 'Stats/B2': 'darkgreen' })
    await expect(vault.setColor('', 'red')).rejects.toThrow('cannot have a colour')
  })
})

describe('move', () => {
  it('moves a PDF together with its sidecar', async () => {
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.pdf.annotations.json', '{}')
    await fs.mkdir(path.join(root, 'ML/B3'))

    expect(await vault.move('ML/B2/slides.pdf', 'ML/B3')).toBe('ML/B3/slides.pdf')
    expect(await list('ML/B2')).toEqual([])
    expect(await list('ML/B3')).toEqual(['slides.pdf', 'slides.pdf.annotations.json'])
  })

  it('copies the images on a moved PDF to its new folder', async () => {
    const sidecar = (src: string, other: string): string =>
      JSON.stringify({
        version: 1,
        pdf: 'slides.pdf',
        pdfSha256: '',
        marginWidth: 0.6,
        pages: {
          '2': {
            strokes: [],
            highlights: [],
            textBoxes: [],
            images: [
              { id: 'i1', x: 0, y: 0, width: 10, height: 10, src, author: 'me' },
              { id: 'i2', x: 0, y: 20, width: 10, height: 10, src: other, author: 'me' }
            ]
          }
        }
      })
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.pdf.annotations.json', sidecar('assets/a.png', 'assets/b.png'))
    await write('ML/B2/assets/a.png', 'mine')
    await write('ML/B2/assets/b.png', 'also mine')
    await write('ML/B3/assets/a.png', 'a different picture')

    await vault.move('ML/B2/slides.pdf', 'ML/B3')

    // The originals stay; the clash got a new name and the sidecar points at it.
    expect(await list('ML/B2/assets')).toEqual(['a.png', 'b.png'])
    expect(await list('ML/B3/assets')).toEqual(['a-2.png', 'a.png', 'b.png'])
    expect(await fs.readFile(path.join(root, 'ML/B3/assets/a-2.png'), 'utf8')).toBe('mine')
    const moved = (await vault.readAnnotations('ML/B3/slides.pdf')).file!
    expect(moved.pages['2'].images!.map((im) => im.src)).toEqual(['assets/a-2.png', 'assets/b.png'])
  })

  it('renames a same-named note with its PDF, but not a note linked under its own name', async () => {
    await write('ML/B2/Decision trees.pdf', 'pdf')
    await write('ML/B2/decision trees.md', 'same name')
    await write('ML/B2/lecture.pdf', 'pdf')
    await write('ML/B2/Summary.md', 'linked')
    await vault.linkNote('ML/B2/lecture.pdf', 'ML/B2/Summary.md', 'current')

    expect(await vault.rename('ML/B2/Decision trees.pdf', 'B2 Decision trees')).toBe(
      'ML/B2/B2 Decision trees.pdf'
    )
    await vault.rename('ML/B2/lecture.pdf', 'Lecture B2.pdf')

    expect(await list('ML/B2')).toEqual([
      'B2 Decision trees.md',
      'B2 Decision trees.pdf',
      'Lecture B2.pdf',
      'Summary.md'
    ])
    expect(await vault.linkedNote('ML/B2/Lecture B2.pdf')).toBe('ML/B2/Summary.md')
  })

  it('renames neither when the note name is taken', async () => {
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.md', 'mine')
    await write('ML/B2/B2.md', 'other')

    await expect(vault.rename('ML/B2/slides.pdf', 'B2')).rejects.toThrow('"B2.md" already exists')
    expect(await list('ML/B2')).toEqual(['B2.md', 'slides.md', 'slides.pdf'])
  })

  it('takes the note that belongs to a PDF along', async () => {
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.md', 'same name')
    await write('ML/B2/lecture.pdf', 'pdf')
    await write('ML/B2/Summary.md', 'linked')
    await write('ML/B2/Other.md', 'stays')
    await fs.mkdir(path.join(root, 'ML/B3'))
    await vault.linkNote('ML/B2/lecture.pdf', 'ML/B2/Summary.md', 'current')

    await vault.move('ML/B2/slides.pdf', 'ML/B3')
    await vault.move('ML/B2/lecture.pdf', 'ML/B3')

    expect(await list('ML/B2')).toEqual(['Other.md'])
    expect(await list('ML/B3')).toEqual(['Summary.md', 'lecture.pdf', 'slides.md', 'slides.pdf'])
    expect(await vault.linkedNote('ML/B3/lecture.pdf')).toBe('ML/B3/Summary.md')
    expect((await vault.tree()).notes).toEqual({ 'ML/B3/lecture.pdf': ['ML/B3/Summary.md'] })
  })

  it('moves neither when the note would overwrite one there', async () => {
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.md', 'mine')
    await write('ML/B3/slides.md', 'theirs')

    await expect(vault.move('ML/B2/slides.pdf', 'ML/B3')).rejects.toThrow(
      '"slides.md" already exists there'
    )
    expect(await list('ML/B2')).toEqual(['slides.md', 'slides.pdf'])
    expect(await fs.readFile(path.join(root, 'ML/B3/slides.md'), 'utf8')).toBe('theirs')
  })

  it('copies the images a moved note shows', async () => {
    await write('ML/B2/Summary.md', '![](assets/a.png)\ntext\n![](<assets/b c.png>)\n')
    await write('ML/B2/assets/a.png', 'mine')
    await write('ML/B2/assets/b c.png', 'also mine')
    await write('ML/B3/assets/a.png', 'a different picture')

    await vault.move('ML/B2/Summary.md', 'ML/B3')

    expect(await list('ML/B2/assets')).toEqual(['a.png', 'b c.png'])
    expect(await list('ML/B3/assets')).toEqual(['a-2.png', 'a.png', 'b c.png'])
    expect(await fs.readFile(path.join(root, 'ML/B3/Summary.md'), 'utf8')).toBe(
      '![](assets/a-2.png)\ntext\n![](<assets/b c.png>)\n'
    )
  })

  it('does not move a PDF onto an orphaned sidecar', async () => {
    await write('ML/B2/slides.pdf', 'pdf')
    await write('ML/B2/slides.pdf.annotations.json', 'mine')
    await write('ML/B3/slides.pdf.annotations.json', 'orphan')

    await expect(vault.move('ML/B2/slides.pdf', 'ML/B3')).rejects.toThrow('already exists')
    expect(await list('ML/B2')).toEqual(['slides.pdf', 'slides.pdf.annotations.json'])
  })

  it('refuses to move a folder into itself', async () => {
    await write('ML/B2/Sub/x.md')

    await expect(vault.move('ML/B2', 'ML/B2/Sub')).rejects.toThrow('into itself')
  })

  it('writes the manual order when a position is given', async () => {
    await write('ML/A.md')
    await write('ML/B.md')
    await write('ML/C.md')

    await vault.move('ML/C.md', 'ML', 'A.md')
    expect(names((await vault.tree()).nodes[0].children!)).toEqual(['C.md', 'A.md', 'B.md'])

    await vault.move('ML/C.md', 'ML', null)
    expect(names((await vault.tree()).nodes[0].children!)).toEqual(['A.md', 'B.md', 'C.md'])
  })

  it('turns a section into a notebook when dropped at the root', async () => {
    await write('ML/B2/x.md')

    expect(await vault.move('ML/B2', '')).toBe('B2')
    expect((await vault.tree()).nodes.map((n) => [n.name, n.kind])).toEqual([
      ['B2', 'notebook'],
      ['ML', 'notebook']
    ])
  })
})

describe('trash', () => {
  it('sends a PDF and its sidecar to the trash, never deletes directly', async () => {
    await write('ML/slides.pdf')
    await write('ML/slides.pdf.annotations.json')

    await vault.trash('ML/slides.pdf')

    expect(trashed).toEqual(['ML/slides.pdf', 'ML/slides.pdf.annotations.json'])
  })

  it('cannot trash the vault itself', async () => {
    await expect(vault.trash('')).rejects.toThrow()
    expect(trashed).toEqual([])
  })
})

describe('importPdf', () => {
  let outside: string

  beforeEach(async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'downloads-'))
  })

  afterEach(async () => {
    await fs.rm(outside, { recursive: true, force: true })
  })

  it('copies the PDF and leaves the original untouched', async () => {
    const source = path.join(outside, 'B2 Decision trees.pdf')
    await fs.writeFile(source, '%PDF-1.7 original')
    await fs.mkdir(path.join(root, 'ML'))

    expect(await vault.importPdf('ML', source)).toBe('ML/B2 Decision trees.pdf')
    expect(await fs.readFile(source, 'utf8')).toBe('%PDF-1.7 original')
    expect(await fs.readFile(path.join(root, 'ML/B2 Decision trees.pdf'), 'utf8')).toBe(
      '%PDF-1.7 original'
    )
    expect(await list('ML')).toEqual(['B2 Decision trees.pdf'])
  })

  it('adds a suffix on a name clash, also with an orphaned sidecar', async () => {
    const source = path.join(outside, 'slides.pdf')
    await fs.writeFile(source, 'new')
    await write('ML/slides.pdf', 'old')
    await write('ML/slides (2).pdf.annotations.json', '{}')

    expect(await vault.importPdf('ML', source)).toBe('ML/slides (3).pdf')
    expect(await fs.readFile(path.join(root, 'ML/slides.pdf'), 'utf8')).toBe('old')
  })

  it('only imports PDFs into a notebook or section', async () => {
    const source = path.join(outside, 'notes.docx')
    await fs.writeFile(source, '')
    await fs.writeFile(path.join(outside, 'a.pdf'), '')
    await fs.mkdir(path.join(root, 'ML'))

    await expect(vault.importPdf('ML', source)).rejects.toThrow('not a PDF')
    await expect(vault.importPdf('', path.join(outside, 'a.pdf'))).rejects.toThrow('notebook')
  })

  it('reads a file as bytes', async () => {
    await write('ML/slides.pdf', 'pdf bytes')

    expect(Buffer.from(await vault.readFile('ML/slides.pdf')).toString()).toBe('pdf bytes')
    await expect(vault.readFile('ML/missing.pdf')).rejects.toThrow('does not exist')
  })
})

describe('last page', () => {
  it('remembers the page per PDF and follows renames, moves and trash', async () => {
    await write('ML/B2/slides.pdf')
    await write('ML/B3/other.pdf')
    await fs.mkdir(path.join(root, 'Stats'))

    await vault.setLastPage('ML/B2/slides.pdf', 12)
    await vault.setLastPage('ML/B3/other.pdf', 3)
    expect(await vault.lastPage('ML/B2/slides.pdf')).toBe(12)

    await vault.rename('ML/B2/slides.pdf', 'trees')
    expect(await vault.lastPage('ML/B2/trees.pdf')).toBe(12)

    await vault.rename('ML', 'Machine Learning')
    await vault.move('Machine Learning/B2', 'Stats')
    expect(await vault.lastPage('Stats/B2/trees.pdf')).toBe(12)

    await vault.trash('Machine Learning/B3/other.pdf')
    const state = JSON.parse(await fs.readFile(path.join(root, '.marginalia/state.json'), 'utf8'))
    expect(state).toEqual({ lastPage: { 'Stats/B2/trees.pdf': 12 } })
  })

  it('reads back a page saved a moment before', async () => {
    await write('ML/a.pdf')
    await vault.setLastPage('ML/a.pdf', 3)
    // Not awaited: lecture mode saves the old viewer's page and the new viewer reads it at once.
    void vault.setLastPage('ML/a.pdf', 12)
    expect(await vault.lastPage('ML/a.pdf')).toBe(12)
  })

  it('does not lose updates made at the same time', async () => {
    await write('ML/a.pdf')
    await write('ML/b.pdf')
    await write('ML/c.pdf')

    await Promise.all([
      vault.setLastPage('ML/a.pdf', 1),
      vault.setLastPage('ML/b.pdf', 2),
      vault.setLastPage('ML/c.pdf', 3),
      vault.setColor('ML', 'green')
    ])

    expect(await vault.lastPage('ML/a.pdf')).toBe(1)
    expect(await vault.lastPage('ML/b.pdf')).toBe(2)
    expect(await vault.lastPage('ML/c.pdf')).toBe(3)
    expect((await vault.tree()).colors).toEqual({ ML: 'green' })
  })
})

describe('notes linked to PDFs', () => {
  it('remembers the note per PDF and follows renames, moves and trash of both', async () => {
    await write('ML/les_1.pdf')
    await write('ML/les_2.pdf')
    await write('ML/les_1.md', '')
    await write('ML/Summary.md', '')
    await fs.mkdir(path.join(root, 'Stats'))

    await vault.linkNote('ML/les_1.pdf', 'ML/les_1.md', 'current')
    await vault.linkNote('ML/les_2.pdf', 'ML/Summary.md', 'current')
    expect(await vault.linkedNote('ML/les_1.pdf')).toBe('ML/les_1.md')
    expect(await vault.linkedPdf('ML/Summary.md')).toBe('ML/les_2.pdf')

    await vault.rename('ML/les_1.md', 'Lesson 1 notes')
    await vault.rename('ML/les_1.pdf', 'Lesson 1')
    expect(await vault.linkedNote('ML/Lesson 1.pdf')).toBe('ML/Lesson 1 notes.md')

    await vault.rename('ML', 'Machine Learning')
    expect(await vault.linkedNote('Machine Learning/les_2.pdf')).toBe('Machine Learning/Summary.md')
    await vault.move('Machine Learning/Summary.md', 'Stats')
    expect(await vault.linkedNote('Machine Learning/les_2.pdf')).toBe('Stats/Summary.md')

    await vault.trash('Stats/Summary.md')
    expect(await vault.linkedNote('Machine Learning/les_2.pdf')).toBeNull()
    const state = JSON.parse(await fs.readFile(path.join(root, '.marginalia/state.json'), 'utf8'))
    expect(state.notes).toEqual({
      'Machine Learning/Lesson 1.pdf': ['Machine Learning/Lesson 1 notes.md']
    })
  })

  it('keeps several notes per PDF, the last picked first', async () => {
    await write('ML/B2/slides.pdf')
    await write('ML/B2/slides.md', '')
    await write('ML/B2/Transcript.md', '')
    await write('ML/B2/Derivations.md', '')
    await write('ML/B2/Other.md', '')
    await fs.mkdir(path.join(root, 'ML/B3'))
    await vault.linkNote('ML/B2/slides.pdf', 'ML/B2/slides.md', 'current')
    await vault.linkNote('ML/B2/slides.pdf', 'ML/B2/Transcript.md', 'add')
    await vault.linkNote('ML/B2/slides.pdf', 'ML/B2/Derivations.md', 'current')
    expect((await vault.tree()).notes['ML/B2/slides.pdf']).toEqual([
      'ML/B2/Derivations.md',
      'ML/B2/slides.md',
      'ML/B2/Transcript.md'
    ])
    expect(await vault.linkedNote('ML/B2/slides.pdf')).toBe('ML/B2/Derivations.md')
    expect(await vault.linkedPdf('ML/B2/Transcript.md')).toBe('ML/B2/slides.pdf')

    // The PDF takes all of them along; a note that is not linked stays.
    await vault.move('ML/B2/slides.pdf', 'ML/B3')
    expect(await list('ML/B2')).toEqual(['Other.md'])
    expect((await vault.tree()).notes['ML/B3/slides.pdf']).toEqual([
      'ML/B3/Derivations.md',
      'ML/B3/slides.md',
      'ML/B3/Transcript.md'
    ])

    await vault.trash('ML/B3/Derivations.md')
    expect(await vault.linkedNote('ML/B3/slides.pdf')).toBe('ML/B3/slides.md')
    await vault.linkNote('ML/B3/slides.pdf', 'ML/B3/slides.md', 'remove')
    expect((await vault.tree()).notes).toEqual({ 'ML/B3/slides.pdf': ['ML/B3/Transcript.md'] })
  })

  it('reads links saved as one note per PDF', async () => {
    await write('ML/les_1.pdf')
    await write('ML/Summary.md', '')
    await write(
      '.marginalia/state.json',
      JSON.stringify({ notes: { 'ML/les_1.pdf': 'ML/Summary.md' } })
    )
    expect(await vault.linkedNote('ML/les_1.pdf')).toBe('ML/Summary.md')
    expect((await vault.tree()).notes).toEqual({ 'ML/les_1.pdf': ['ML/Summary.md'] })
    await vault.linkNote('ML/les_1.pdf', 'ML/Summary.md', 'current')
    const state = JSON.parse(await fs.readFile(path.join(root, '.marginalia/state.json'), 'utf8'))
    expect(state.notes).toEqual({ 'ML/les_1.pdf': ['ML/Summary.md'] })
  })
})

describe('hidden folders', () => {
  it('leaves hidden folders out of the tree and follows renames of a parent', async () => {
    await write('OvA/les_3/Inhoud.md', '')
    await write('OvA/les_3/assignment-repo/README.md', '')
    await vault.setHidden('OvA/les_3/assignment-repo', true)
    const names = async (): Promise<string[]> =>
      flatten((await vault.tree()).nodes).map((n) => n.path)
    expect(await names()).toEqual(['OvA', 'OvA/les_3', 'OvA/les_3/Inhoud.md'])
    expect((await vault.tree()).hidden).toEqual(['OvA/les_3/assignment-repo'])

    await vault.rename('OvA', 'Ontwerp van Algoritmen')
    expect((await vault.tree()).hidden).toEqual(['Ontwerp van Algoritmen/les_3/assignment-repo'])
    expect(await names()).not.toContain('Ontwerp van Algoritmen/les_3/assignment-repo')

    await vault.setHidden('Ontwerp van Algoritmen/les_3/assignment-repo', false)
    expect(await names()).toContain('Ontwerp van Algoritmen/les_3/assignment-repo/README.md')
    await expect(vault.setHidden('Nope', true)).rejects.toThrow('does not exist')
  })

  it('hides a single file, and a PDF together with its notes', async () => {
    await write('ML/les_1.pdf', '')
    await write('ML/les_1.md', '')
    await write('ML/Derivation.md', '')
    await write('ML/Other.md', '')
    await vault.linkNote('ML/les_1.pdf', 'ML/Derivation.md', 'add')
    const names = async (): Promise<string[]> =>
      flatten((await vault.tree()).nodes).map((n) => n.path)

    await vault.setHidden('ML/Other.md', true)
    expect(await names()).toEqual(['ML', 'ML/Derivation.md', 'ML/les_1.md', 'ML/les_1.pdf'])
    await vault.setHidden('ML/les_1.pdf', true)
    expect(await names()).toEqual(['ML'])
    expect((await vault.tree()).hidden).toEqual(['ML/Other.md', 'ML/les_1.pdf'])

    await vault.rename('ML/Other.md', 'Kept.md')
    expect((await vault.tree()).hidden).toEqual(['ML/Kept.md', 'ML/les_1.pdf'])
    await vault.setHidden('ML/les_1.pdf', false)
    expect(await names()).toContain('ML/Derivation.md')
  })
})

describe('course languages', () => {
  it('keeps a language per notebook that follows a rename', async () => {
    await write('OvA/les_1/slides.pdf', '')
    await vault.setCourseLanguage('OvA', 'nl')
    expect((await vault.tree()).languages).toEqual({ OvA: 'nl' })
    await vault.rename('OvA', 'Ontwerp van Algoritmen')
    expect((await vault.tree()).languages).toEqual({ 'Ontwerp van Algoritmen': 'nl' })
    await vault.setCourseLanguage('Ontwerp van Algoritmen', 'auto')
    expect((await vault.tree()).languages).toEqual({})
    await expect(vault.setCourseLanguage('OvA/les_1', 'en')).rejects.toThrow('notebook')
  })
})

describe('chat sessions', () => {
  it('keeps one conversation per section that follows renames, moves and trash', async () => {
    await fs.mkdir(path.join(root, 'ML/B2/Entropy'), { recursive: true })
    await fs.mkdir(path.join(root, 'ML/B3'), { recursive: true })
    await fs.mkdir(path.join(root, 'Stats'))

    await vault.setChatSession('ML/B2', 'session-b2')
    await vault.setChatSession('ML/B2/Entropy', 'session-entropy')
    await vault.setChatSession('ML/B3', 'session-b3')
    expect(await vault.chatSession('ML/B2')).toBe('session-b2')
    expect(await vault.chatSession('ML')).toBeNull()

    await vault.rename('ML/B2', 'B2 Trees')
    await vault.move('ML/B2 Trees', 'Stats')
    expect(await vault.chatSession('Stats/B2 Trees')).toBe('session-b2')
    expect(await vault.chatSession('Stats/B2 Trees/Entropy')).toBe('session-entropy')

    await vault.trash('ML/B3')
    await vault.setChatSession('Stats/B2 Trees/Entropy', null)
    const state = JSON.parse(await fs.readFile(path.join(root, '.marginalia/state.json'), 'utf8'))
    expect(state).toEqual({ chats: { 'Stats/B2 Trees': 'session-b2' } })
  })
})

describe('annotations', () => {
  const file: AnnotationFile = {
    version: 1,
    pdf: 'slides.pdf',
    pdfSha256: '',
    marginWidth: 0.6,
    pages: {
      '12': {
        strokes: [
          {
            id: 's_01',
            tool: 'pen',
            color: '#1f6feb',
            width: 1.5,
            points: [
              [412.1, 88, 0.52],
              [413, 90.2, 0.55]
            ],
            author: 'me'
          }
        ],
        highlights: [],
        textBoxes: [
          {
            id: 't_01',
            x: 620,
            y: 96,
            width: 220,
            markdown: 'weighted average! $\\frac{|S_i|}{|S|}$',
            author: 'claude'
          }
        ]
      }
    }
  }

  it('saves next to the PDF and reads back the same data', async () => {
    await write('ML/slides.pdf', 'pdf bytes')

    const empty = await vault.readAnnotations('ML/slides.pdf')
    expect(empty.file).toBeNull()
    expect(empty.pdfSha256).toMatch(/^[0-9a-f]{64}$/)

    await vault.writeAnnotations('ML/slides.pdf', { ...file, pdfSha256: empty.pdfSha256 })
    const loaded = await vault.readAnnotations('ML/slides.pdf')
    expect(loaded.file).toEqual({ ...file, pdfSha256: empty.pdfSha256 })
    expect(await list('ML')).toEqual(['slides.pdf', 'slides.pdf.annotations.json'])
  })

  it('keeps point arrays on one line', async () => {
    await write('ML/slides.pdf')
    await vault.writeAnnotations('ML/slides.pdf', file)

    const text = await fs.readFile(path.join(root, 'ML/slides.pdf.annotations.json'), 'utf8')
    expect(text).toContain('"points": [[412.1,88,0.52],[413,90.2,0.55]]')
  })

  it('reports a replaced PDF through a different hash', async () => {
    await write('ML/slides.pdf', 'version 1')
    const before = (await vault.readAnnotations('ML/slides.pdf')).pdfSha256
    await write('ML/slides.pdf', 'version 2')

    expect((await vault.readAnnotations('ML/slides.pdf')).pdfSha256).not.toBe(before)
  })

  it('refuses a damaged sidecar instead of treating it as empty', async () => {
    await write('ML/slides.pdf')
    await write('ML/slides.pdf.annotations.json', '{"version":1,"pages":')

    await expect(vault.readAnnotations('ML/slides.pdf')).rejects.toThrow('damaged')
    await expect(
      vault.writeAnnotations('ML/slides.pdf', { pages: 'nope' } as unknown as AnnotationFile)
    ).rejects.toThrow('invalid')
    expect(await fs.readFile(path.join(root, 'ML/slides.pdf.annotations.json'), 'utf8')).toBe(
      '{"version":1,"pages":'
    )
  })
})

describe('notes and assets', () => {
  it('reads and writes Markdown only', async () => {
    await write('ML/Summary.md', '# Decision trees\n')
    await write('ML/slides.pdf', 'pdf')

    expect(await vault.readText('ML/Summary.md')).toBe('# Decision trees\n')
    await vault.writeText('ML/Summary.md', '# Decision trees\n\n## Entropy\n')
    expect(await fs.readFile(path.join(root, 'ML/Summary.md'), 'utf8')).toContain('## Entropy')
    await expect(vault.writeText('ML/slides.pdf', 'oops')).rejects.toThrow('not a Markdown')
    expect(await fs.readFile(path.join(root, 'ML/slides.pdf'), 'utf8')).toBe('pdf')
  })

  it('does not recreate a note that was deleted while open', async () => {
    await expect(vault.writeText('ML/Gone.md', 'text')).rejects.toThrow('no longer exists')
    expect(await list()).toEqual([])
  })

  it('saves images in assets with a timestamp name and never overwrites', async () => {
    await write('ML/B2/Summary.md')

    const first = await vault.saveAsset('ML/B2/Summary.md', new Uint8Array([1]), 'png')
    const second = await vault.saveAsset('ML/B2/Summary.md', new Uint8Array([2]), '.PNG')

    expect(first).toMatch(/^assets\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?\.png$/)
    expect(second).not.toBe(first)
    expect(await list('ML/B2/assets')).toHaveLength(2)
    await expect(vault.saveAsset('ML/B2/Summary.md', new Uint8Array(), 'exe')).rejects.toThrow(
      'not images'
    )
  })

  it('formats timestamps like the spec', () => {
    expect(timestamp(new Date(2026, 9, 2, 14, 31, 5))).toBe('2026-10-02_14-31-05')
  })
})

describe('settings', () => {
  it('does not overwrite a settings file it cannot read', async () => {
    await write('ML/x.md')
    await write('.marginalia/settings.json', '{ half written')

    await expect(vault.setColor('ML', 'red')).rejects.toThrow('not valid JSON')
    expect(await fs.readFile(path.join(root, '.marginalia/settings.json'), 'utf8')).toBe(
      '{ half written'
    )
  })
})

describe('paths', () => {
  it('rejects paths that escape the vault', () => {
    expect(() => resolveInVault(root, '../outside')).toThrow('outside the vault')
    expect(() => resolveInVault(root, 'C:/Windows')).toThrow('outside the vault')
    expect(resolveInVault(root, 'ML/..hidden')).toBe(path.join(root, 'ML', '..hidden'))
  })

  it('trims names', () => {
    expect(validateName('  B2 Trees ')).toBe('B2 Trees')
  })
})

describe('writeFileAtomic', () => {
  it('replaces the content and leaves no temp files', async () => {
    const file = path.join(root, 'a.json')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')

    expect(await fs.readFile(file, 'utf8')).toBe('two')
    expect(await list()).toEqual(['a.json'])
  })
})

describe('watchVault', () => {
  it('reports a folder created outside the app within a second', async () => {
    let calls = 0
    const stop = watchVault(root, () => calls++)
    await new Promise((r) => setTimeout(r, 300))

    const start = Date.now()
    await fs.mkdir(path.join(root, 'Statistics'))
    while (calls === 0 && Date.now() - start < 1000) await new Promise((r) => setTimeout(r, 20))
    await stop()

    expect(calls).toBeGreaterThan(0)
  })

  it('does not lock folders, so they can still be renamed', async () => {
    await write('ML/B2 Trees/x.md')
    const stop = watchVault(root, () => {})
    await new Promise((r) => setTimeout(r, 300))

    await expect(vault.rename('ML/B2 Trees', 'B2 Decision trees')).resolves.toBe(
      'ML/B2 Decision trees'
    )
    await expect(vault.rename('ML', 'Machine Learning')).resolves.toBe('Machine Learning')
    await stop()
  })

  it('ignores changes inside hidden folders', async () => {
    let calls = 0
    const stop = watchVault(root, () => calls++)
    await new Promise((r) => setTimeout(r, 300))

    await write('.marginalia/settings.json', '{}')
    await new Promise((r) => setTimeout(r, 400))
    await stop()

    expect(calls).toBe(0)
  })
})

function flatten(nodes: VaultNode[]): VaultNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])])
}
