import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecordingStatus } from '../../shared/types'
import { Vault } from '../vault/vault'
import type { Transcriber } from './engine'
import { LiveSession } from './live'
import { LiveSession as Session, timelineName } from './live'
import {
  audioOf,
  clock,
  headerOf,
  NOT_TRANSCRIBED,
  slideAt,
  slideMarker,
  transcriptHeader,
  transcriptName,
  transcriptParagraph
} from './transcript'
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
      true,
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
    const session = await LiveSession.start(
      vault,
      engine,
      'ML/les_3',
      (s) => statuses.push(s),
      true
    )
    session.addChunk({ pcm: new Uint8Array(3200), at: 0, language: 'auto' })
    session.addChunk({ pcm: new Uint8Array(3200), at: 30, language: 'auto' })
    await session.stop()
    expect(statuses.some((s) => s.error === 'model missing')).toBe(true)
    expect(await vault.readText(session.transcript)).toContain('recovered')
  })
})

describe('recording without live transcription', () => {
  let root: string
  let vault: Vault
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'record-'))
    await fs.mkdir(path.join(root, 'ML', 'les_3'), { recursive: true })
    vault = new Vault(root, async () => undefined)
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('leaves a placeholder and keeps a slide timeline next to the audio', async () => {
    const engine = {} as Transcriber
    const session = await Session.start(vault, engine, 'ML/les_3', () => undefined, false)
    await session.addSlide({ at: 0, pdf: 'ML/les_3/B2.pdf', page: 1 })
    await session.addSlide({ at: 95, pdf: 'ML/les_3/B2.pdf', page: 4 })
    await session.addAudio(new Uint8Array([1]))
    await session.stop()
    const note = await vault.readText(session.transcript)
    expect(note).toContain(NOT_TRANSCRIBED)
    const audio = audioOf(note)!
    expect(audio).toBe(`assets/${session.audioName}`)
    const timeline = JSON.parse(
      await vault.readAsset(session.transcript, timelineName(session.audioName))
    )
    expect(timeline.slides).toEqual([
      { at: 0, pdf: 'ML/les_3/B2.pdf', page: 1 },
      { at: 95, pdf: 'ML/les_3/B2.pdf', page: 4 }
    ])
    expect(headerOf(note)).not.toContain(NOT_TRANSCRIBED)
  })
})

describe('slide links in transcripts', () => {
  const timeline = [
    { at: 0, pdf: 'ML/les_3/B2 trees.pdf', page: 1 },
    { at: 60, pdf: 'ML/les_3/B2 trees.pdf', page: 2 },
    { at: 300, pdf: 'ML/les_2/B1.pdf', page: 40 }
  ]

  it('finds the slide that was open at a moment', () => {
    expect(slideAt(timeline, 59)?.page).toBe(1)
    expect(slideAt(timeline, 60)?.page).toBe(2)
    expect(slideAt(timeline, 1000)?.pdf).toBe('ML/les_2/B1.pdf')
    expect(slideAt([{ at: 10, pdf: 'x.pdf', page: 1 }], 5)).toBeNull()
  })

  it('links relative to the note, also into another lesson', () => {
    expect(slideMarker('ML/les_3/Transcript.md', 'ML/les_3/B2 trees.pdf', 2)).toBe(
      '[slide 2](B2%20trees.pdf#page=2)'
    )
    expect(slideMarker('ML/les_3/Transcript.md', 'ML/les_2/B1.pdf', 40)).toBe(
      '[slide 40](../les_2/B1.pdf#page=40)'
    )
  })
})
