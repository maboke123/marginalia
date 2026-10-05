import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import { PDFDocument } from 'pdf-lib'
import path from 'path'
import { createEnv, fakeLog, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

const section = 'Machine Learning/B2 Decision trees'
const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })

async function start(
  extra: Record<string, string> = {},
  settings: Record<string, unknown> = {}
): Promise<void> {
  env = await createEnv()
  const config = path.join(env.userData, 'config.json')
  const current = JSON.parse(await fs.readFile(config, 'utf8'))
  await fs.writeFile(config, JSON.stringify({ ...current, settings }))
  await fs.mkdir(path.join(env.vault, section), { recursive: true })
  await makeSlides(path.join(env.vault, section, 'slides.pdf'), 3)
  ;({ app, page } = await launch(env, extra))
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await row('slides.pdf').click()
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeAttached()
}

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

test('with live transcription on, the transcript is written while recording', async () => {
  await start({}, { transcribeLive: true })
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await expect(bar).toContainText('Recording 00:0')

  // The transcript appears in the lesson and cannot be edited while it is being written.
  await expect(row('Transcript ')).toBeVisible()
  await row('Transcript ').click()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByText('Being written while you record')).toBeVisible()

  // The kept audio is written every 5 seconds.
  await page.waitForTimeout(6000)
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(bar).toBeHidden()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')

  const files = await fs.readdir(path.join(env.vault, section))
  const name = files.find((f) => f.startsWith('Transcript '))!
  expect(name).toMatch(/^Transcript \d{4}-\d\d-\d\d \d\d-\d\d\.md$/)
  const text = await fs.readFile(path.join(env.vault, section, name), 'utf8')
  expect(text).toMatch(/^# Transcript /)
  expect(text).toMatch(
    /\*\*00:00\*\* · \[slide 1\]\(slides\.pdf#page=1\) Spoken part 1, \d seconds, language auto\./
  )
  const audio = text.match(/Audio: \[[^\]]+\]\((assets\/recording-[^)]+\.webm)\)/)![1]
  expect((await fs.stat(path.join(env.vault, section, audio))).size).toBeGreaterThan(1000)
  // It shows in the note as it was written, without a restart.
  await expect(page.locator('.cm-content')).toContainText('Spoken part 1')

  // Claude is told about the lesson's transcripts, for questions about the lecture.
  await page.keyboard.press('Control+L')
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await input.fill('What did he say about entropy?')
  await input.press('Enter')
  await expect
    .poll(async () =>
      JSON.stringify(JSON.parse(await fs.readFile(fakeLog(env), 'utf8').catch(() => '{}')))
    )
    .toContain(`${section}/${name}`)
  const log = JSON.stringify(JSON.parse(await fs.readFile(fakeLog(env), 'utf8')))
  expect(log).toContain('Transcripts of this lesson')
})

test('recording starts without asking, even when speech to text was missing', async () => {
  await start({ MARGINALIA_FAKE_WHISPER: 'missing' })
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await expect(bar).toContainText('Recording 00:0')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(bar).toBeHidden()
})

/** A WAV of a few seconds of tone, as a stand-in for a lecture recording. */
async function toneWav(file: string, seconds: number): Promise<void> {
  const rate = 16000
  const samples = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < seconds * rate; i++) {
    samples.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples.length, 40)
  await fs.writeFile(file, Buffer.concat([header, samples]))
}

test('a recording file is transcribed in the background into the lesson', async () => {
  await start()
  const source = path.join(env.dir, 'lecture 2.wav')
  await toneWav(source, 4)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)

  await row('B2 Decision trees').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Transcribe a recording...' }).click()
  const dialog = page.getByRole('dialog', { name: 'Transcribe a recording' })
  await expect(dialog).toContainText('Transcribe lecture 2.wav')
  await dialog.getByRole('radio', { name: /Fast/ }).check()
  await dialog.getByRole('button', { name: 'Transcribe' }).click()

  const job = page.getByRole('status', { name: 'Transcribing' })
  await expect(job).toContainText('Transcript ready', { timeout: 30_000 })
  const name = (await fs.readdir(path.join(env.vault, section))).find((f) =>
    f.startsWith('Transcript ')
  )!
  const text = await fs.readFile(path.join(env.vault, section, name), 'utf8')
  expect(text).toContain('Transcribed from lecture 2.wav.')
  expect(text).toMatch(/\*\*00:00\*\* Spoken part 1, 4 seconds, language auto\./)
  const audio = text.match(/Audio: \[[^\]]+\]\((assets\/recording-[^)]+\.webm)\)/)![1]
  expect((await fs.stat(path.join(env.vault, section, audio))).size).toBeGreaterThan(1000)

  await job.getByRole('button', { name: 'Show transcript' }).click()
  await expect(page.locator('.cm-content')).toContainText('Spoken part 1')
  await expect(job).toBeHidden()
})

test('by default only the audio is recorded, and transcribed afterwards with slide links', async () => {
  await start()
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await expect(bar).toContainText('Saving the audio and which slide is open')
  await expect(bar.getByRole('checkbox', { name: 'Live transcript' })).not.toBeChecked()

  // Slide 2 from about 3 s on: the timeline gives the transcript its slide links.
  await page.waitForTimeout(3000)
  await page.getByRole('textbox', { name: 'Page' }).fill('2')
  await page.getByRole('textbox', { name: 'Page' }).press('Enter')
  await page.waitForTimeout(3500)
  await bar.getByRole('button', { name: 'Stop' }).click()

  const name = (await fs.readdir(path.join(env.vault, section))).find((f) =>
    f.startsWith('Transcript ')
  )!
  const note = path.join(env.vault, section, name)
  expect(await fs.readFile(note, 'utf8')).toContain('Not transcribed yet')
  const timeline = (await fs.readdir(path.join(env.vault, section, 'assets'))).find((f) =>
    f.endsWith('.json')
  )!
  const slides = JSON.parse(
    await fs.readFile(path.join(env.vault, section, 'assets', timeline), 'utf8')
  ).slides
  expect(slides.map((s: { page: number }) => s.page)).toEqual([1, 2])

  const offer = page.getByRole('status', { name: 'Recording saved' })
  await offer.getByRole('button', { name: 'Transcribe now' }).click()
  const dialog = page.getByRole('dialog', { name: 'Transcribe a recording' })
  await expect(dialog).toContainText('with links to the slides you had open')
  await dialog.getByRole('button', { name: 'Transcribe' }).click()
  const job = page.getByRole('status', { name: 'Transcribing' })
  await expect(job).toContainText('Transcript ready', { timeout: 30_000 })

  const text = await fs.readFile(note, 'utf8')
  expect(text).not.toContain('Not transcribed yet')
  expect(text).toMatch(/^# Transcript /)
  expect(text).toMatch(/\*\*00:00\*\* · \[slide 1\]\(slides\.pdf#page=1\) Spoken part 1/)
})

test('a lecture video gets links to the slides it shows, also out of order', async () => {
  await start()
  // Three very different pictures as slides, and a video that shows 1, then 3, then 2.
  const dir = path.join(env.dir, 'video')
  await fs.mkdir(dir)
  const sources = ['testsrc', 'smptebars', 'mandelbrot']
  for (const [i, src] of sources.entries()) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `${src}=size=960x540`,
      '-frames:v',
      '1',
      path.join(dir, `${i + 1}.png`)
    ])
  }
  const pdf = await PDFDocument.create()
  for (let i = 1; i <= 3; i++) {
    const png = await pdf.embedPng(await fs.readFile(path.join(dir, `${i}.png`)))
    pdf.addPage([960, 540]).drawImage(png, { x: 0, y: 0, width: 960, height: 540 })
  }
  const deck = path.join(env.vault, section, 'pictures.pdf')
  await fs.writeFile(deck, await pdf.save())
  const video = path.join(dir, 'lecture.mp4')
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y'],
    ...['-loop', '1', '-t', '8', '-i', path.join(dir, '1.png')],
    ...['-loop', '1', '-t', '8', '-i', path.join(dir, '3.png')],
    ...['-loop', '1', '-t', '8', '-i', path.join(dir, '2.png')],
    ...['-f', 'lavfi', '-t', '24', '-i', 'sine=frequency=440'],
    ...['-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]'],
    ...['-map', '[v]', '-map', '3:a', '-r', '10', '-shortest', video]
  ])

  await expect(row('pictures.pdf')).toBeVisible()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, video)
  await row('pictures.pdf').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Transcribe a recording of this...' }).click()
  const dialog = page.getByRole('dialog', { name: 'Transcribe a recording' })
  await expect(dialog.getByRole('checkbox', { name: /Link to the slides/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Transcribe' }).click()

  const job = page.getByRole('status', { name: 'Transcribing' })
  await expect(job).toContainText('Transcript ready', { timeout: 60_000 })
  const name = (await fs.readdir(path.join(env.vault, section))).find((f) =>
    f.startsWith('Transcript ')
  )!
  const text = await fs.readFile(path.join(env.vault, section, name), 'utf8')
  expect(text).toContain('Transcribed from lecture.mp4.')
  const links = [...text.matchAll(/\*\*(\d\d:\d\d)\*\* · \[slide (\d)\]\(pictures\.pdf#page=\d\)/g)]
  expect(links.map((m) => `${m[1]} ${m[2]}`)).toEqual(['00:00 1', '00:08 3', '00:16 2'])
})

test('recording works from the slides toolbar, and twice in a row gives two transcripts', async () => {
  // Within one minute: the second note gets "(2)" in its name, its audio has seconds in it.
  await start()
  const record = page.locator('.pdf-viewer').getByRole('button', { name: 'Record lecture' })
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  for (let i = 0; i < 2; i++) {
    await record.click()
    await expect(bar).toBeVisible()
    await expect(record).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(1500)
    await record.click()
    await expect(bar).toBeHidden()
  }
  const transcripts = (await fs.readdir(path.join(env.vault, section))).filter((f) =>
    f.startsWith('Transcript ')
  )
  expect(transcripts).toHaveLength(2)
  await expect(page.locator('.tree-row', { hasText: 'Transcript ' })).toHaveCount(2)
})

test('the recording bar can be hidden, and stays hidden for the next recording', async () => {
  await start()
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  const chip = page.locator('.pdf-viewer .recording-chip')
  await page.keyboard.press('Control+Shift+R')
  await bar.getByRole('button', { name: 'Hide' }).click()
  await expect(bar).toBeHidden()
  await expect(chip).toContainText('00:0')
  await page.screenshot({ path: path.join('test-results', 'recording-hidden.png') })

  await page.keyboard.press('Control+Shift+R')
  await expect(chip).toBeHidden()
  await page.keyboard.press('Control+Shift+R')
  await expect(chip).toBeVisible()
  await expect(bar).toBeHidden()
  await chip.click()
  await expect(bar).toBeVisible()
  await expect(chip).toBeHidden()
  await bar.getByRole('button', { name: 'Stop' }).click()
})
