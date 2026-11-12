import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { zipFiles } from './zip'

describe('zipFiles', () => {
  it('makes a zip that Windows unpacks, folders and accents included', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-zip-'))
    try {
      const text = 'Beslissingsbomen splitsen op informatiewinst. '.repeat(50)
      const random = new Uint8Array(2000).map((_, i) => (i * 7919) % 251)
      const zip = path.join(dir, 'les_1.zip')
      await fs.writeFile(
        zip,
        zipFiles([
          { name: 'les_1/Samenvatting é.pdf', data: Buffer.from(text) },
          { name: 'les_1/oefeningen/Sheet 1.pdf', data: random }
        ])
      )
      const out = path.join(dir, 'out')
      await fs.mkdir(out)
      // tar.exe (bsdtar) ships with Windows 10 and later, and reads zips.
      const tar = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
      execFileSync(tar, ['-xf', zip, '-C', out])
      expect(await fs.readFile(path.join(out, 'les_1/Samenvatting é.pdf'), 'utf8')).toBe(text)
      const back = await fs.readFile(path.join(out, 'les_1/oefeningen/Sheet 1.pdf'))
      expect(new Uint8Array(back)).toEqual(random)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
