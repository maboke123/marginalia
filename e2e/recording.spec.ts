import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { createEnv, fakeLog, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

const section = 'Machine Learning/B2 Decision trees'
const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })

async function start(extra: Record<string, string> = {}): Promise<void> {
  env = await createEnv()
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

test('a recorded lecture becomes a transcript with slide links and kept audio', async () => {
  await start()
  await page.keyboard.press('Control+Shift+R')
  const bar = page.getByRole('status', { name: 'Recording' })
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
  const bar = page.getByRole('status', { name: 'Recording' })
  await expect(bar).toContainText('Recording 00:0')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(bar).toBeHidden()
})
