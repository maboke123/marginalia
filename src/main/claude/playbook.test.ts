import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../vault/vault'
import { courseSources, notLearned, PlaybookStore } from './playbook'

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

describe('PlaybookStore', () => {
  it('keeps a playbook per course, outside the vault', async () => {
    expect(await store.read('uml', 'DSS')).toBe('')
    await store.write('uml', 'DSS', '## My rules\n- No getters and setters')
    expect(await store.read('uml', 'DSS')).toBe('## My rules\n- No getters and setters\n')
    expect(await fs.readdir(path.join(dir, 'skills', 'uml', 'courses'))).toEqual(['DSS.md'])
    await expect(store.write('uml', '', 'x')).rejects.toThrow('course')
    await expect(store.write('summary', 'DSS', 'x')).rejects.toThrow('does not learn')
  })

  it('knows which files of the course it read, and offers new and changed ones', async () => {
    await write('DSS/les_1/1 Intro.pdf', 'pdf')
    await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases.')
    await write('DSS/les_1/Summary.md', 'my notes')
    await write('DSS/les_2/2 Class diagrams.pdf', 'pdf')
    await write('ML/B2/slides.pdf', 'pdf')
    const sources = await courseSources(vault, 'DSS')
    expect(Object.keys(sources)).toEqual([
      'DSS/les_1/1 Intro.pdf',
      'DSS/les_1/Transcript 2026-09-24 10-30.md',
      'DSS/les_2/2 Class diagrams.pdf'
    ])

    await store.markLearned('uml', 'DSS', {
      'DSS/les_1/1 Intro.pdf': sources['DSS/les_1/1 Intro.pdf'],
      'DSS/les_1/Transcript 2026-09-24 10-30.md':
        sources['DSS/les_1/Transcript 2026-09-24 10-30.md']
    })
    const learned = await store.learned('uml', 'DSS')
    expect(notLearned(sources, learned)).toEqual(['DSS/les_2/2 Class diagrams.pdf'])

    // A transcript that got longer is read again.
    await write('DSS/les_1/Transcript 2026-09-24 10-30.md', 'Today: use cases. And actors.')
    expect(notLearned(await courseSources(vault, 'DSS'), learned)).toEqual([
      'DSS/les_1/Transcript 2026-09-24 10-30.md',
      'DSS/les_2/2 Class diagrams.pdf'
    ])
  })
})
