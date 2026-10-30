import { describe, expect, it } from 'vitest'
import { parseCaptions, transcriptParts } from './captions'

describe('imported transcripts', () => {
  it('reads WebVTT cues without their markup', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE made by the lecture capture',
      '',
      '1',
      '00:00:01.000 --> 00:00:04.500 align:start',
      '<v Roel>Today we look at <i>GRASP</i>.</v>',
      '',
      '00:00:04.500 --> 00:00:08.000',
      'Low coupling &amp; high cohesion.',
      ''
    ].join('\n')
    expect(parseCaptions(vtt)).toEqual([
      { from: 1000, to: 4500, text: 'Today we look at GRASP.' },
      { from: 4500, to: 8000, text: 'Low coupling & high cohesion.' }
    ])
  })

  it('reads SubRip, and leaves out the lines rolling captions repeat', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      'the creator pattern',
      '',
      '2',
      '00:00:03,000 --> 00:00:05,000',
      'the creator pattern',
      'says who makes an object',
      ''
    ].join('\r\n')
    expect(parseCaptions(srt).map((s) => s.text)).toEqual([
      'the creator pattern',
      'says who makes an object'
    ])
  })

  it('makes paragraphs of cues, timed from the start of the video', () => {
    const cues = Array.from(
      { length: 30 },
      (_, i) =>
        `00:00:${String(i * 2).padStart(2, '0')}.000 --> 00:00:${String(i * 2 + 2).padStart(2, '0')}.000\nline ${i}`
    )
    const parts = transcriptParts('lecture.vtt', `WEBVTT\n\n${cues.join('\n\n')}`)
    expect(parts.map((p) => p.at)).toEqual([0, 46])
    expect(parts[0].text).toMatch(/^line 0 line 1 /)
  })

  it('reads times at the start of lines, as copied from a video page', () => {
    const text = '0:00\nWelcome back.\n0:42 Today: GRASP.\n[1:02:05] Questions?\n'
    expect(transcriptParts('notes.txt', text)).toEqual([
      { at: 0, text: 'Welcome back. Today: GRASP.' },
      { at: 3725, text: 'Questions?' }
    ])
  })

  it('cuts untimed text into paragraphs of a readable size', () => {
    const sentence = 'The information expert gets the responsibility because it has the data. '
    const text = `${sentence.repeat(30)}\n\nShort one.\n\nAnother short one.`
    const parts = transcriptParts('lecture.txt', text)
    expect(parts.every((p) => p.at === null)).toBe(true)
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) expect(p.text.split(' ').length).toBeLessThanOrEqual(160)
    expect(parts.at(-1)!.text).toContain('Short one. Another short one.')
  })
})
