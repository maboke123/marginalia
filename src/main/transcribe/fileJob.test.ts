import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { extractAudio } from './fileJob'

// The slide matching worker starts on import; these tests do not need it.
vi.mock('./matchWorker?nodeWorker', () => ({ default: () => null }))

const hasFfmpeg = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasFfmpeg)('extractAudio', () => {
  it('reports the seconds read for a recording that does not say how long it is', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-extract-'))
    try {
      // Written to a pipe, like the app's recorder: the webm has no duration in it.
      const webm = execFileSync(
        'ffmpeg',
        ['-hide_banner', '-f', 'lavfi', '-i', 'sine=d=4', '-c:a', 'libopus', '-f', 'webm', '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const source = path.join(dir, 'recording.webm')
      await fs.writeFile(source, webm)
      const reports: [number | null, number][] = []
      await extractAudio(
        source,
        path.join(dir, 'audio.wav'),
        path.join(dir, 'audio.opus.webm'),
        new AbortController().signal,
        (percent, read) => reports.push([percent, read])
      )
      expect(reports.length).toBeGreaterThan(0)
      expect(reports.every(([percent]) => percent === null)).toBe(true)
      expect(reports.at(-1)![1]).toBeGreaterThan(3)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
