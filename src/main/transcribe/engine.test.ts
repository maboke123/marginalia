import path from 'path'
import { describe, expect, it } from 'vitest'
import { WhisperEngine } from './engine'

// Runs the real whisper.cpp; needs downloads, so only when asked:
// MARGINALIA_WHISPER_DIR=<folder> MARGINALIA_WHISPER_WAV=<16 kHz wav> npx vitest run engine
const dir = process.env['MARGINALIA_WHISPER_DIR']
const wav = process.env['MARGINALIA_WHISPER_WAV']

describe.skipIf(!dir || !wav)('WhisperEngine (real)', { timeout: 300_000 }, () => {
  it('installs what is missing and transcribes speech', async () => {
    const engine = new WhisperEngine(dir!)
    await engine.install(['program', 'vad', 'small'], () => undefined)
    const { installed } = await engine.status()
    expect(installed).toMatchObject({ program: true, vad: true, small: true })
    const segments = await engine.transcribe(path.resolve(wav!), {
      model: 'small',
      language: 'auto',
      prompt: 'Decision trees: entropy, information gain, C4.5'
    })
    const text = segments.map((s) => s.text).join(' ')
    expect(text).toMatch(/information gain/i)
    expect(text).toMatch(/sort the values/i)
    expect(segments[0].from).toBeLessThan(segments.at(-1)!.to)
  })
})
