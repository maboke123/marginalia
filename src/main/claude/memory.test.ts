import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { courseOf, courseOfFile, MemoryStore } from './memory'
import { withMemory } from './prompt'

let dir: string
let store: MemoryStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-memory-'))
  store = new MemoryStore(path.join(dir, 'memory'))
})

afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('MemoryStore', () => {
  it('keeps a note about me and one per course', async () => {
    expect(await store.all()).toEqual({ '': '' })
    await store.write('', '- Writes in Dutch and English')
    await store.write('Distributed Systems', '  - Wants diagrams of message flows  ')
    expect(await store.read('Distributed Systems')).toBe('- Wants diagrams of message flows\n')
    expect(await store.all()).toEqual({
      '': '- Writes in Dutch and English\n',
      'Distributed Systems': '- Wants diagrams of message flows\n'
    })
  })

  it('removes a note written empty', async () => {
    await store.write('Machine Learning', '- Short answers')
    await store.write('Machine Learning', '  ')
    expect(await store.all()).toEqual({ '': '' })
  })

  it('refuses a course name that would leave the memory folder', async () => {
    await expect(store.write('../config', 'x')).rejects.toThrow()
    await expect(store.write('a/b', 'x')).rejects.toThrow()
  })
})

it('finds the course of a folder and of a file', () => {
  expect(courseOf('Machine Learning/B2 Decision trees')).toBe('Machine Learning')
  expect(courseOf('')).toBe('')
  expect(courseOfFile('Machine Learning/B2/slides.pdf')).toBe('Machine Learning')
  expect(courseOfFile('Todo.md')).toBe('')
})

describe('withMemory', () => {
  const memory = { me: '- Dutch', course: 'ML', courseNote: '- Charts as vega-lite' }

  it('adds the notes and how to keep them', () => {
    const chat = withMemory('Prompt', memory, { tool: true })
    expect(chat).toContain('remember tool')
    expect(chat).toContain('<memory about="me">\n- Dutch\n</memory>')
    expect(chat).toContain('<memory about="course ML">\n- Charts as vega-lite\n</memory>')
    expect(withMemory('Prompt', memory, { dir: 'C:\\m' })).toContain('C:\\m\\me.md')
  })

  it('leaves a one-off prompt alone when there is nothing to remember', () => {
    expect(withMemory('Prompt', { me: '', course: 'ML', courseNote: '' }, null)).toBe('Prompt')
    expect(withMemory('Prompt', memory, null)).not.toContain('remember tool')
  })
})
