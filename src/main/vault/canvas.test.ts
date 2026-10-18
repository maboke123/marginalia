import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canvasFrom, formatCanvas, type CanvasData, type FileNode } from '../../shared/canvas'
import { Vault } from './vault'

let root: string
let vault: Vault

async function write(rel: string, content = ''): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

const read = async (rel: string): Promise<CanvasData> =>
  canvasFrom(await fs.readFile(path.join(root, rel), 'utf8'))

const files = async (rel: string): Promise<string[]> =>
  (await read(rel)).nodes.filter((n): n is FileNode => n.type === 'file').map((n) => n.file)

function canvasWith(...paths: string[]): string {
  return formatCanvas({
    nodes: paths.map((file, i) => ({
      id: `n${i}`,
      type: 'file',
      file,
      x: i * 300,
      y: 0,
      width: 240,
      height: 160
    })),
    edges: []
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-canvas-'))
  vault = new Vault(root, async (abs) => fs.rm(abs, { recursive: true }))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('canvases in the vault', () => {
  it('shows .canvas files in the tree and makes new ones', async () => {
    await fs.mkdir(path.join(root, 'Design of Software Systems/les_1'), { recursive: true })
    const made = await vault.createCanvas('Design of Software Systems/les_1', 'Class diagram')
    expect(made).toBe('Design of Software Systems/les_1/Class diagram.canvas')
    expect(await read(made)).toEqual({ nodes: [], edges: [] })
    const again = await vault.createCanvas('Design of Software Systems/les_1', 'Class diagram')
    expect(again).toBe('Design of Software Systems/les_1/Class diagram (2).canvas')

    const { nodes } = await vault.tree()
    const lesson = nodes[0].children![0]
    expect(lesson.children!.map((n) => [n.name, n.kind])).toEqual([
      ['Class diagram (2).canvas', 'canvas'],
      ['Class diagram.canvas', 'canvas']
    ])
    expect(await vault.readText(made)).toContain('"nodes"')
  })

  it('follows a renamed folder in the paths of every canvas', async () => {
    await write('DSS/les_1/assets/board.png', 'png')
    await write('DSS/les_1/Classes.canvas', canvasWith('DSS/les_1/assets/board.png'))
    await write('DSS/Overview.canvas', canvasWith('DSS/les_1/assets/board.png', 'DSS/les_10/x.md'))
    await vault.rename('DSS/les_1', 'les_01')
    expect(await files('DSS/les_01/Classes.canvas')).toEqual(['DSS/les_01/assets/board.png'])
    // les_10 only starts like les_1; it stays.
    expect(await files('DSS/Overview.canvas')).toEqual([
      'DSS/les_01/assets/board.png',
      'DSS/les_10/x.md'
    ])
  })

  it('takes its images along when a canvas moves to another folder', async () => {
    await write('DSS/les_1/assets/board.png', 'mine')
    await write('DSS/les_2/assets/board.png', 'a different picture')
    await write('DSS/les_1/Classes.canvas', canvasWith('DSS/les_1/assets/board.png'))
    await vault.move('DSS/les_1/Classes.canvas', 'DSS/les_2')
    expect(await files('DSS/les_2/Classes.canvas')).toEqual(['DSS/les_2/assets/board-2.png'])
    expect(await fs.readFile(path.join(root, 'DSS/les_2/assets/board-2.png'), 'utf8')).toBe('mine')
    // The original stays where it was.
    expect(await fs.readFile(path.join(root, 'DSS/les_1/assets/board.png'), 'utf8')).toBe('mine')
  })

  it('leaves a damaged canvas untouched', async () => {
    await write('DSS/les_1/Broken.canvas', '{"nodes": [')
    await write('DSS/les_1/a.md', '')
    await vault.rename('DSS/les_1', 'les_01')
    expect(await fs.readFile(path.join(root, 'DSS/les_01/Broken.canvas'), 'utf8')).toBe(
      '{"nodes": ['
    )
  })
})
