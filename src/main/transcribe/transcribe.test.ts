import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecordingStatus } from '../../shared/types'
import { Vault } from '../vault/vault'
import type { Transcriber } from './engine'
import { LiveSession } from './live'
import { clock, transcriptHeader, transcriptName, transcriptParagraph } from './transcript'
import { wavFromPcm } from './wav'

describe('transcript text', () => {
  it('writes times like a video player', () => {
    expect(clock(5)).toBe('00:05')
    expect(clock(754.9)).toBe('12:34')
    expect(clock(3754)).toBe('1:02:34')
  })

  it('names transcripts by date, safely for Windows', () => {
    expect(transcriptName(new Date(2026, 9, 6, 10, 5))).toBe('Transcript 2026-10-06 10-05.md')
  })

  it('makes one paragraph per chunk with its time and slide, as plain text', () => {
    const p = transcriptParagraph(
      754,
      [
        { from: 0, to: 2000, text: ' The gain is $5 or *more*' },
        { from: 2000, to: 4000, text: '  than   before. ' }
      ],
      '[slide 14](B2.pdf#page=14)'
    )
    expect(p).toBe(
      '\n**12:34** · [slide 14](B2.pdf#page=14) The gain is \\$5 or \\*more\\* than before.\n'
    )
    expect(transcriptParagraph(0, [{ from: 0, to: 1, text: '  ' }])).toBe('')
  })

  it('links the audio from the header', () => {
    const header = transcriptHeader({
      date: new Date(2026, 9, 6, 10, 5),
      source: 'Recorded live.',
      audio: 'assets/recording-2026-10-06_10-05-00.webm'
    })
    expect(header).toBe(
      '# Transcript 6 October 2026, 10:05\n\nRecorded live.\n' +
        'Audio: [recording-2026-10-06_10-05-00.webm](assets/recording-2026-10-06_10-05-00.webm)\n'
    )
  })
})

describe('wavFromPcm', () => {
  it('writes a 16 kHz mono header', () => {
    const wav = wavFromPcm(new Int16Array([1, -1, 300]))
    expect(wav.length).toBe(44 + 6)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt32LE(40)).toBe(6)
    expect(wav.readInt16LE(48)).toBe(300)
  })
})

describe('LiveSession', () => {
  let root: string
  let vault: Vault

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-'))
    await fs.mkdir(path.join(root, 'ML', 'les_3'), { recursive: true })
    vault = new Vault(root, async () => undefined)
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('adds each chunk to the transcript in order and keeps the audio', async () => {
    let calls = 0
    const engine: Transcriber = {
      status: async () => ({ installed: {}, sizes: {} }) as never,
      install: async () => undefined,
      // The first chunk is slow, so the second finishes first unless they are queued.
      transcribe: async (_wav, options) => {
        const n = ++calls
        await new Promise((r) => setTimeout(r, n === 1 ? 60 : 1))
        return [{ from: 0, to: 1000, text: ` part ${n} in ${options.language}` }]
      }
    }
    const statuses: RecordingStatus[] = []
    const session = await LiveSession.start(
      vault,
      engine,
      'ML/les_3',
      (s) => statuses.push(s),
      new Date(2026, 9, 6, 10, 5)
    )
    expect(session.transcript).toBe('ML/les_3/Transcript 2026-10-06 10-05.md')

    const second = new Uint8Array(32_000)
    session.addChunk({ pcm: second, at: 0, language: 'nl', marker: '[slide 2](x.pdf#page=2)' })
    session.addChunk({ pcm: second, at: 31, language: 'en' })
    await session.addAudio(new Uint8Array([1, 2]))
    await session.addAudio(new Uint8Array([3]))
    await session.stop()

    const text = await vault.readText(session.transcript)
    expect(text).toContain('**00:00** · [slide 2](x.pdf#page=2) part 1 in nl\n')
    expect(text.indexOf('part 1')).toBeLessThan(text.indexOf('**00:31** part 2 in en'))
    const audio = await fs.readFile(path.join(root, 'ML/les_3/assets', session.audioName))
    expect([...audio]).toEqual([1, 2, 3])
    expect(statuses.at(-1)).toMatchObject({ pending: 0, transcribedTo: 32, error: null })
  })

  it('reports a failed chunk and goes on with the next', async () => {
    let calls = 0
    const engine: Transcriber = {
      status: async () => ({ installed: {}, sizes: {} }) as never,
      install: async () => undefined,
      transcribe: async () => {
        if (++calls === 1) throw new Error('model missing')
        return [{ from: 0, to: 1000, text: ' recovered' }]
      }
    }
    const statuses: RecordingStatus[] = []
    const session = await LiveSession.start(vault, engine, 'ML/les_3', (s) => statuses.push(s))
    session.addChunk({ pcm: new Uint8Array(3200), at: 0, language: 'auto' })
    session.addChunk({ pcm: new Uint8Array(3200), at: 30, language: 'auto' })
    await session.stop()
    expect(statuses.some((s) => s.error === 'model missing')).toBe(true)
    expect(await vault.readText(session.transcript)).toContain('recovered')
  })
})
