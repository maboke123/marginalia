import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createEnv, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page
let slides: string

const pdfRel = 'Machine Learning/B2 Decision trees/slides.pdf'

test.beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-slides-'))
  slides = path.join(dir, 'slides.pdf')
  await makeSlides(slides, 3)
})

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.dirname(path.join(env.vault, pdfRel)), { recursive: true })
  await fs.copyFile(slides, path.join(env.vault, pdfRel))
  ;({ app, page } = await launch(env))
  await expect(row('Machine Learning')).toBeVisible()
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const readConfig = async (): Promise<{ settings: Record<string, unknown> }> =>
  JSON.parse(await fs.readFile(path.join(env.userData, 'config.json'), 'utf8'))

async function openSlides(): Promise<void> {
  // After a restart the folders may already be open; clicking would close them.
  await expect(row('Machine Learning')).toBeVisible()
  if (!(await row('slides.pdf').isVisible())) {
    await row('Machine Learning').click()
    await row('B2 Decision trees').click()
  }
  await row('slides.pdf').click()
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeAttached()
}

test('theme and hotkeys change at once and are kept', async () => {
  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('radio', { name: 'Dark' }).check()
  // Playwright pins prefers-color-scheme in the page, so ask Electron, which drives it.
  await expect
    .poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors))
    .toBe(true)

  // App-wide hotkeys must keep plain typing free.
  await dialog.getByRole('button', { name: 'Hotkey for Search everything' }).click()
  await page.keyboard.press('KeyF')
  await expect(dialog).toContainText('Needs Ctrl or Alt')
  await page.keyboard.press('Escape')

  await dialog.getByRole('button', { name: 'Hotkey for Pen' }).click()
  await page.keyboard.press('KeyB')
  await expect(dialog.getByRole('button', { name: 'Hotkey for Pen' })).toHaveText('B')
  await page.screenshot({ path: path.join('test-results', 'settings.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await openSlides()
  await page.keyboard.press('KeyB')
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect((await readConfig()).settings).toMatchObject({ theme: 'dark', hotkeys: { pen: 'B' } })
})

test('each PDF keeps its own margin width', async () => {
  await openSlides()
  const sheet = page.locator('.pdf-page[data-page="1"] canvas')
  const normal = (await sheet.boundingBox())!.width
  await page.getByRole('combobox', { name: 'Margin' }).selectOption('1')
  // Fit width: a wider margin leaves less room for the slide.
  await expect.poll(async () => (await sheet.boundingBox())!.width).not.toBe(normal)

  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  await expect
    .poll(async () => JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}')).marginWidth)
    .toBe(1)

  await app.close()
  ;({ app, page } = await launch(env))
  await openSlides()
  await expect(page.getByRole('combobox', { name: 'Margin' })).toHaveValue('1')
})
