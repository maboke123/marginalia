import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultNode } from '../../shared/types'
import { writeFileAtomic } from './atomic'
import { resolveInVault, validateName } from './names'
import { Vault } from './vault'
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
