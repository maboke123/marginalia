import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../vault/vault'
import { SearchIndex } from './searchIndex'

let dir: string
let root: string
let cache: string
let vault: Vault

async function write(rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true })
  await fs.writeFile(path.join(root, rel), content)
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-search-'))
  root = path.join(dir, 'vault')
  cache = path.join(dir, 'cache', 'index.json')
  await fs.mkdir(root)
  vault = new Vault(root, async () => {})
})

afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('SearchIndex', () => {
  it('finds words in notes and in indexed slides, notes first', async () => {
    await write('ML/B2/Summary.md', '# Trees\n\nEntropy is $H(S)$.\n\nGain uses entropy too.\n')
    await write('ML/B2/slides.pdf', 'pdf')
    const index = new SearchIndex(vault, cache)

    expect(await index.pending()).toEqual([{ path: 'ML/B2/slides.pdf', stamp: expect.any(String) }])
    const [{ stamp }] = await index.pending()
    await index.storePdf('ML/B2/slides.pdf', stamp, ['Slide one', 'Shannon ENTROPY and gain'])
    expect(await index.pending()).toEqual([])

    const result = await index.query('entropy')
    expect(result.hits.map((h) => [h.path, h.line ?? h.page])).toEqual([
      ['ML/B2/Summary.md', 3],
      ['ML/B2/Summary.md', 5],
      ['ML/B2/slides.pdf', 2]
    ])
    expect(result.unindexed).toBe(0)
    expect((await index.query('gain entropy')).hits).toHaveLength(2)
  })

  it('keeps PDF text in its cache between runs and notices changed or removed files', async () => {
    await write('ML/a.pdf', 'pdf a')
    await write('ML/b.pdf', 'pdf b')
    const first = new SearchIndex(vault, cache)
    for (const { path: p, stamp } of await first.pending())
      await first.storePdf(p, stamp, ['boosting'])
    await first.flush()

    const second = new SearchIndex(vault, cache)
    expect(await second.pending()).toEqual([])
    expect((await second.query('boosting')).hits).toHaveLength(2)

    await write('ML/a.pdf', 'a changed pdf')
    await fs.rm(path.join(root, 'ML/b.pdf'))
    expect((await second.pending()).map((p) => p.path)).toEqual(['ML/a.pdf'])
    // The old text is still searched until the new text arrives, and counted as unindexed.
    expect(await second.query('boosting')).toMatchObject({ unindexed: 1 })
  })

  it('reads a note again after it changed', async () => {
    await write('ML/Notes.md', 'bagging')
    const index = new SearchIndex(vault, cache)
    expect((await index.query('bagging')).hits).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 20))
    await write('ML/Notes.md', 'random forests, much longer now')
    expect((await index.query('bagging')).hits).toHaveLength(0)
    expect((await index.query('forests')).hits).toHaveLength(1)
  })
})
