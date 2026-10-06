import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { Vault } from '../vault/vault'
import type { Transcriber, TranscribeOptions } from './engine'
import { extractAudio, transcribeFile } from './fileJob'

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

describe.skipIf(!hasFfmpeg)('transcribeFile', () => {
  it('saves each piece and goes on from there after a stop', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-pieces-'))
    try {
      // Twelve minutes of tone: three pieces of about five minutes.
      const source = path.join(dir, 'lecture.webm')
      execFileSync('ffmpeg', [
        ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=720'],
        ...['-c:a', 'libopus', '-b:a', '16k', source]
      ])
      await fs.mkdir(path.join(dir, 'vault/ML'), { recursive: true })
      const vault = new Vault(path.join(dir, 'vault'), async () => undefined)
      const calls: { seconds: number; prompt?: string }[] = []
      let failOn = 2
      const engine = {
        async transcribe(wav: string, options: TranscribeOptions) {
          const seconds = ((await fs.stat(wav)).size - 44) / 32_000
          calls.push({ seconds, prompt: options.prompt })
          if (calls.length === failOn) throw new Error('Cancelled')
          return [{ from: 1000, to: 3000, text: ` Piece ${calls.length}.` }]
        }
      } as unknown as Transcriber
      const job = {
        folder: 'ML',
        source,
        model: 'small' as const,
        language: 'nl',
        checkpoints: path.join(dir, 'checkpoints'),
        signal: new AbortController().signal,
        onProgress: () => undefined
      }

      await expect(transcribeFile(vault, engine, job)).rejects.toThrow('Cancelled')
      expect(await fs.readdir(job.checkpoints)).toHaveLength(1)

      failOn = 0
      const note = await transcribeFile(vault, engine, job)
      // Piece 1 was kept; the run went on with piece 2 and 3, with the text so far as prompt.
      expect(calls).toHaveLength(4)
      expect(calls[2].prompt).toBe('Piece 1.')
      expect(calls.reduce((n, c, i) => (i === 1 ? n : n + c.seconds), 0)).toBeCloseTo(720, 0)
      const text = await vault.readText(note)
      expect(text).toMatch(/Piece 1\.[\s\S]*Piece 3\.[\s\S]*Piece 4\./)
      expect(await fs.readdir(job.checkpoints)).toHaveLength(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
