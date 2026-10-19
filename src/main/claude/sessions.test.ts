import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSession, moveSession, projectKey, projectsDir } from './sessions'

const ID = '10347662-06f9-4333-8106-2d4f101c2738'
let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function session(dir: string, withExtra = false): Promise<void> {
  await fs.mkdir(path.join(root, dir), { recursive: true })
  await fs.writeFile(path.join(root, dir, `${ID}.jsonl`), '{"type":"user"}\n')
  if (withExtra) {
    await fs.mkdir(path.join(root, dir, ID, 'subagents'), { recursive: true })
    await fs.writeFile(path.join(root, dir, ID, 'subagents', 'a.jsonl'), '{}\n')
  }
}

describe('projectKey', () => {
  it('names the folder like the CLI does', () => {
    expect(projectKey('C:\\Users\\mathi\\Notes\\Ontwerp van Algoritmen\\les_2')).toBe(
      'C--Users-mathi-Notes-Ontwerp-van-Algoritmen-les-2'
    )
  })

  it('gives up on paths the CLI would hash', () => {
    expect(projectKey('C:\\' + 'a'.repeat(250))).toBeNull()
  })
})

describe('projectsDir', () => {
  it('follows CLAUDE_CONFIG_DIR', () => {
    expect(projectsDir({ CLAUDE_CONFIG_DIR: 'D:\\claude' })).toBe(
      path.join('D:\\claude', 'projects')
    )
  })
})

describe('moveSession', () => {
  it('moves the chat and its subagents to the folder', async () => {
    await session('C--Notes', true)
    expect(await moveSession(root, ID, 'C:\\Notes\\les 1')).toBe(true)
    expect(existsSync(path.join(root, 'C--Notes-les-1', `${ID}.jsonl`))).toBe(true)
    expect(existsSync(path.join(root, 'C--Notes-les-1', ID, 'subagents', 'a.jsonl'))).toBe(true)
    expect(existsSync(path.join(root, 'C--Notes', `${ID}.jsonl`))).toBe(false)
    expect(await findSession(root, ID)).toBe(path.join(root, 'C--Notes-les-1'))
  })

  it('leaves a chat that is there already, whatever the case of the drive letter', async () => {
    await session('c--Notes-les-1')
    expect(await moveSession(root, ID, 'C:\\Notes\\les 1')).toBe(true)
    expect(existsSync(path.join(root, 'c--Notes-les-1', `${ID}.jsonl`))).toBe(true)
  })

  it('reports a chat it cannot find', async () => {
    expect(await moveSession(root, ID, 'C:\\Notes')).toBe(false)
  })
})

describe('a chat handed to VS Code', () => {
  it('is no longer marked as made through the SDK, so the Claude panel lists it', async () => {
    await fs.mkdir(path.join(root, 'C--Notes'), { recursive: true })
    const file = path.join(root, 'C--Notes', `${ID}.jsonl`)
    await fs.writeFile(
      file,
      '{"type":"user","entrypoint":"sdk-ts","cwd":"C:\\Notes"}\n{"type":"assistant","entrypoint":"sdk-ts"}\n'
    )
    expect(await moveSession(root, ID, 'C:\\Notes\\les 1')).toBe(true)
    const moved = await fs.readFile(path.join(root, 'C--Notes-les-1', `${ID}.jsonl`), 'utf8')
    expect(moved).toBe(
      '{"type":"user","entrypoint":"cli","cwd":"C:\\Notes"}\n{"type":"assistant","entrypoint":"cli"}\n'
    )
  })
})
