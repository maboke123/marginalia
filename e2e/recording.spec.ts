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
  settings: Record<string, unknown> = {},
  args: (env: TestEnv) => Promise<string[]> = async () => []
): Promise<void> {
  env = await createEnv()
  const config = path.join(env.userData, 'config.json')
  const current = JSON.parse(await fs.readFile(config, 'utf8'))
  await fs.writeFile(
    config,
    JSON.stringify({ ...current, settings: { ...current.settings, ...settings } })
  )
  await fs.mkdir(path.join(env.vault, section), { recursive: true })
  await makeSlides(path.join(env.vault, section, 'slides.pdf'), 3)
  ;({ app, page } = await launch(env, extra, await args(env)))
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
  await expect(bar.getByRole('combobox', { name: 'Spoken language' })).toBeVisible()

  // The transcript appears in the lesson and cannot be edited while it is being written.
  await row('B2 Decision trees').getByRole('button', { name: 'Transcripts' }).click()
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
  // The language is chosen when the audio is transcribed.
  await expect(bar.getByRole('combobox', { name: 'Spoken language' })).toHaveCount(0)

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
  // Transcripts stay out of the tree until the lesson's badge shows them.
  await expect(page.locator('.tree-row', { hasText: 'Transcript ' })).toHaveCount(0)
  const badge = row('B2 Decision trees').getByRole('button', { name: 'Transcripts' })
  await expect(badge).toHaveText('2')
  await badge.click()
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

test('a muted microphone shows a warning with Unmute, also with the bar hidden', async () => {
  // A muted microphone in Windows records only zeros: the fake microphone plays a silent file.
  const silence = async (e: TestEnv): Promise<string[]> => {
    const wav = Buffer.alloc(44 + 16_000 * 2 * 5)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16_000, 24)
    wav.writeUInt32LE(32_000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(wav.length - 44, 40)
    const file = path.join(e.dir, 'silence.wav')
    await fs.writeFile(file, wav)
    return [`--use-file-for-fake-audio-capture=${file}`]
  }
  await start({}, { recordingBar: false }, silence)
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await page.keyboard.press('Control+Shift+R')
  await expect(bar).toContainText('No sound from the microphone', { timeout: 10_000 })
  await page.screenshot({ path: path.join('test-results', 'recording-muted.png') })
  await bar.getByRole('button', { name: 'Unmute' }).click()
  await expect(page.getByText('Microphone turned on in Windows')).toBeVisible()
  await bar.getByRole('button', { name: 'Stop' }).click()
})

test('transcriptions wait in a queue that can be reordered and emptied', async () => {
  await start({ MARGINALIA_FAKE_WHISPER_MS: '60000' })
  for (const name of ['week 1', 'week 2', 'week 3']) {
    const source = path.join(env.dir, `${name}.wav`)
    await toneWav(source, 2)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, source)
    await row('B2 Decision trees').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Transcribe a recording...' }).click()
    await page.getByRole('button', { name: 'Transcribe', exact: true }).click()
  }

  const bar = page.getByRole('status', { name: 'Transcribing' })
  await expect(bar).toContainText('week 1.wav')
  await expect(bar).toContainText('transcribing')
  await bar.getByRole('button', { name: 'Queue (2 waiting)' }).click()
  const queue = page.getByRole('dialog', { name: 'Transcription queue' })
  const items = queue.getByRole('listitem')
  await expect(items).toHaveText([
    /week 1\.wav.*Now/,
    /week 2\.wav.*Next/,
    /week 3\.wav.*2 in line/
  ])
  await page.screenshot({ path: path.join('test-results', 'queue.png') })

  await queue
    .getByRole('listitem', { name: 'week 3.wav' })
    .getByRole('button', { name: 'Sooner' })
    .click()
  await expect(items).toHaveText([/week 1/, /week 3/, /week 2/])
  await queue
    .getByRole('listitem', { name: 'week 2.wav' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(items).toHaveText([/week 1/, /week 3.*Next/])

  // Stopping the running one starts the next.
  await queue
    .getByRole('listitem', { name: 'week 1.wav' })
    .getByRole('button', { name: 'Stop' })
    .click()
  await expect(items).toHaveText([/week 3\.wav.*Now/])
  await queue.getByRole('button', { name: 'Close' }).click()
  await expect(bar).toContainText('week 3.wav')
  await bar.getByRole('button', { name: 'Cancel' }).click()
  await expect(bar).toBeHidden()
})

test('saved recordings are transcribed while plugged in, in the language of the course', async () => {
  await start({ MARGINALIA_FAKE_WHISPER_MS: '3000' })
  const power = (onBattery: boolean): Promise<void> =>
    app.evaluate(({ powerMonitor }, battery) => {
      powerMonitor.isOnBatteryPower = () => battery
      powerMonitor.emit(battery ? 'on-battery' : 'on-ac')
    }, onBattery)
  await power(true)
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await expect(bar).toContainText('Recording 00:0')
  await page.waitForTimeout(1500)
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('status', { name: 'Recording saved' })).toBeVisible()

  await page.keyboard.press('Control+Comma')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Language of Machine Learning' }).selectOption('nl')
  await settings.getByRole('checkbox', { name: 'By itself while the laptop is plugged in' }).check()
  await page.keyboard.press('Escape')
  const job = page.getByRole('status', { name: 'Transcribing' })
  await page.waitForTimeout(500)
  await expect(job).toHaveCount(0)

  await power(false)
  await expect(job).toContainText('transcribing')
  await expect(page.getByRole('status', { name: 'Recording saved' })).toHaveCount(0)
  await power(true)
  await expect(job).toContainText('Paused on battery power')
  await power(false)
  await expect(job).toContainText('Transcript ready', { timeout: 30_000 })

  const name = (await fs.readdir(path.join(env.vault, section))).find((f) =>
    f.startsWith('Transcript ')
  )!
  const text = await fs.readFile(path.join(env.vault, section, name), 'utf8')
  expect(text).not.toContain('Not transcribed yet')
  expect(text).toContain('language nl')
})

const power = (onBattery: boolean): Promise<void> =>
  app.evaluate(({ powerMonitor }, battery) => {
    powerMonitor.isOnBatteryPower = () => battery
    powerMonitor.emit(battery ? 'on-battery' : 'on-ac')
  }, onBattery)

async function recordTwice(): Promise<void> {
  const record = page.locator('.pdf-viewer').getByRole('button', { name: 'Record lecture' })
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  for (let i = 0; i < 2; i++) {
    await record.click()
    await expect(bar).toBeVisible()
    await page.waitForTimeout(1500)
    await record.click()
    await expect(bar).toBeHidden()
  }
}

test('plugging in queues each saved recording once', async () => {
  await start({ MARGINALIA_FAKE_WHISPER_MS: '3000' }, { autoTranscribe: true })
  await power(true)
  await recordTwice()
  // Several triggers at once used to scan side by side and queue everything twice.
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.isOnBatteryPower = () => false
    powerMonitor.emit('on-ac')
    powerMonitor.emit('on-ac')
    powerMonitor.emit('on-ac')
  })
  const job = page.getByRole('status', { name: 'Transcribing' })
  await expect(job).toContainText('Queue (1 waiting)')
  await page.waitForTimeout(1000)
  await expect(job).toContainText('Queue (1 waiting)')
})

test('the queue shows recordings not started yet, and starts them on battery', async () => {
  await start({ MARGINALIA_FAKE_WHISPER_MS: '3000' })
  await power(true)
  await recordTwice()

  await page.keyboard.press('Control+Comma')
  await page.getByRole('button', { name: 'Show the queue' }).click()
  const queue = page.getByRole('dialog', { name: 'Transcription queue' })
  await expect(queue).toContainText('Not started (2)')
  await expect(queue).toContainText('Transcribing by itself is off')
  await queue.getByRole('button', { name: 'Transcribe all now' }).click()
  await expect(queue).not.toContainText('Not started')
  await expect(queue.locator('.queue-item')).toHaveCount(2)

  // Started by hand, so unplugging does not pause them.
  await power(true)
  const job = page.getByRole('status', { name: 'Transcribing' }).first()
  await expect(job).toContainText('transcribing')
  await expect(page.getByText('Paused on battery power')).toHaveCount(0)
  await expect(queue).toContainText('Nothing left to transcribe.', { timeout: 30_000 })
})

test('recording stops and is kept when the laptop goes to sleep', async () => {
  await start()
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording', exact: true })
  await expect(bar).toContainText('Recording 00:0')
  await page.waitForTimeout(1500)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))

  await expect(bar).toBeHidden()
  await expect(page.getByText('Recording stopped because the laptop went to sleep')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Recording saved' })).toBeVisible()
  const assets = await fs.readdir(path.join(env.vault, section, 'assets'))
  expect(assets.some((f) => f.endsWith('.webm'))).toBe(true)
})
