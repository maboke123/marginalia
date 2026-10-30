import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SlideText } from '../../shared/textMatch'
import { Vault } from '../vault/vault'
import { importTranscriptFile, linkByText } from './importText'

let dir: string
let vault: Vault

const write = async (rel: string, text = ''): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, 'vault', rel)), { recursive: true })
  await fs.writeFile(path.join(dir, 'vault', rel), text)
}

const slides: SlideText[] = [
  'GRASP: general responsibility assignment software patterns',
  'Information expert: give the responsibility to the class with the information',
  'Creator: B creates A when B contains or aggregates A'
].map((text, i) => ({ pdf: 'DSS/les_4/8 GRASP (part 1).pdf', page: i + 1, group: 'here', text }))

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-import-text-'))
  vault = new Vault(path.join(dir, 'vault'), async () => {})
  await write('DSS/les_4/8 GRASP (part 1).pdf', 'pdf')
})

afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('a transcript made elsewhere', () => {
  it('comes in as a transcript note, linked to its slides paragraph by paragraph', async () => {
    const source = path.join(dir, 'GRASP lecture.vtt')
    await fs.writeFile(
      source,
      [
        'WEBVTT',
        '',
        '00:00:01.000 --> 00:00:05.000',
        'Welcome, today the GRASP patterns, general responsibility assignment.',
        '',
        '00:01:00.000 --> 00:01:05.000',
        'The information expert: the class with the information gets the responsibility.',
        '',
        '00:02:00.000 --> 00:02:05.000',
        'Then the creator: B creates A when B contains A, and $5 is not a formula.',
        ''
      ].join('\n')
    )
    const { note, pdf } = await importTranscriptFile(vault, {
      folder: 'DSS/les_4',
      source,
      slides
    })
    expect(note).toBe('DSS/les_4/Transcript GRASP lecture.md')
    expect(pdf).toBe('DSS/les_4/8 GRASP (part 1).pdf')
    const text = await vault.readText(note)
    expect(text).toMatch(/^# Transcript GRASP lecture\n\nImported from GRASP lecture\.vtt\./)
    const link = (page: number): string =>
      `[slide ${page}](8%20GRASP%20(part%201).pdf#page=${page})`
    expect(text).toContain(`**00:01** · ${link(1)} Welcome`)
    expect(text).toContain(`**01:00** · ${link(2)} The information expert`)
    expect(text).toContain(`**02:00** · ${link(3)} Then the creator`)
    expect(text).toContain('\\$5')
    expect(await vault.linkedNote(pdf!)).toBe(note)
  })

  it('without times, starts each paragraph with its slide', async () => {
    const source = path.join(dir, 'Transcript week 4.txt')
    // Paragraphs of a spoken length; short ones would be joined.
    const expert = 'The information expert gets the responsibility, it has the information. '
    const creator = 'The creator creates instances it contains or aggregates, says the slide. '
    await fs.writeFile(source, `${expert.repeat(6)}\n\n${creator.repeat(6)}`)
    const { note } = await importTranscriptFile(vault, { folder: 'DSS/les_4', source, slides })
    expect(note).toBe('DSS/les_4/Transcript week 4.md')
    const text = await vault.readText(note)
    expect(text).not.toContain('Times are from')
    const link = (page: number): string =>
      `\n[slide ${page}](8%20GRASP%20(part%201).pdf#page=${page})`
    expect(text).toContain(`${link(2)} The information expert`)
    expect(text).toContain(`${link(3)} The creator`)
  })

  it('refuses a file without text', async () => {
    const source = path.join(dir, 'empty.srt')
    await fs.writeFile(source, '\n\n')
    await expect(
      importTranscriptFile(vault, { folder: 'DSS/les_4', source, slides })
    ).rejects.toThrow('has no text')
  })
})

describe('linking a recorded transcript by its words', () => {
  it('replaces the slide that was on my screen with the one being discussed', async () => {
    const stuck = '[slide 1](8%20GRASP%20(part%201).pdf#page=1)'
    await write(
      'DSS/les_4/Transcript 2026-10-16 10-30.md',
      [
        '# Transcript 16 October 2026, 10:30',
        '',
        'Recorded live with the microphone.',
        'Audio: [r.webm](assets/r.webm)',
        '',
        `**00:10** · ${stuck} Today GRASP, general responsibility assignment patterns.`,
        '',
        `**00:55** · ${stuck} The information expert has the information.`,
        '',
        '**01:40** The creator: B creates A when B contains A.',
        ''
      ].join('\n')
    )
    const note = 'DSS/les_4/Transcript 2026-10-16 10-30.md'
    expect(await linkByText(vault, note, slides)).toBe(3)
    const text = await vault.readText(note)
    expect(text).toContain('Audio: [r.webm](assets/r.webm)\n')
    expect(text).toContain('**00:55** · [slide 2](8%20GRASP%20(part%201).pdf#page=2) The info')
    expect(text).toContain('**01:40** · [slide 3](8%20GRASP%20(part%201).pdf#page=3) The creator')
    expect(await vault.linkedPdf(note)).toBe('DSS/les_4/8 GRASP (part 1).pdf')
  })
})
