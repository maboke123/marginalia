import { describe, expect, it } from 'vitest'
import { wavFromPcm } from './wav'
import { isSilent, pcmOfWav, pieceBounds } from './pieces'

const RATE = 1000

/** Loud sound everywhere except short pauses at the given seconds. */
function speech(seconds: number, pauses: number[]): Int16Array {
  const samples = new Int16Array(seconds * RATE).fill(8000)
  for (const p of pauses) samples.fill(0, p * RATE, p * RATE + RATE / 5)
  return samples
}

describe('pieceBounds', () => {
  it('cuts at the pause just before each piece is full', () => {
    const samples = speech(700, [296, 593])
    const bounds = pieceBounds(samples, RATE, 0, 300)
    expect(bounds).toHaveLength(4)
    expect(bounds[0]).toBe(0)
    expect(bounds[1] / RATE).toBeCloseTo(296.05, 1)
    expect(bounds[2] / RATE).toBeCloseTo(593.1, 1)
    expect(bounds[3]).toBe(samples.length)
  })

  it('starts where an earlier run stopped, and leaves a short recording whole', () => {
    const samples = speech(700, [593])
    const bounds = pieceBounds(samples, RATE, 296_050, 300)
    expect(bounds[0]).toBe(296_050)
    expect(bounds[1] / RATE).toBeCloseTo(593.1, 1)
    expect(pieceBounds(speech(20, []), RATE)).toEqual([0, 20 * RATE])
  })
})

describe('pcmOfWav', () => {
  it('reads the samples after any chunk before the data', () => {
    const samples = new Int16Array([1, -2, 3, 32000])
    const wav = wavFromPcm(samples, RATE)
    expect([...pcmOfWav(wav)]).toEqual([...samples])
    // ffmpeg writes a LIST chunk between fmt and data.
    const list = Buffer.concat([
      Buffer.from('LIST'),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from('INFO')
    ])
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)])
    expect([...pcmOfWav(withList)]).toEqual([...samples])
  })
})

describe('isSilent', () => {
  it('holds for a muted microphone, not for a quiet room', () => {
    expect(isSilent(new Int16Array(30 * RATE), RATE)).toBe(true)
    // Opus leaves a stray sample of noise in a muted recording.
    const muted = new Int16Array(30 * RATE)
    muted[1234] = 2
    expect(isSilent(muted, RATE)).toBe(true)
    const room = new Int16Array(30 * RATE)
    for (let i = 0; i < room.length; i++) room[i] = i % 2 ? 20 : -20
    expect(isSilent(room, RATE)).toBe(false)
    expect(isSilent(speech(30, []), RATE)).toBe(false)
  })
})
