import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createEnv, launch, makeSlides, sha256, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page
let downloads: string
let source: string
let errors: string[]

test.beforeAll(async () => {
  downloads = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-downloads-'))
  source = path.join(downloads, 'B2 Decision trees.pdf')
  await makeSlides(source, 120)
})

test.afterAll(async () => {
  await fs.rm(downloads, { recursive: true, force: true })
})

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.join(env.vault, 'Machine Learning', 'B2 Decision trees'), { recursive: true })
  ;({ app, page } = await launch(env))
  errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const pageInput = (): Locator => page.getByRole('textbox', { name: 'Page' })

async function importIntoSection(): Promise<number> {
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  const start = Date.now()
  await page.getByRole('button', { name: 'Import PDF' }).click()
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeVisible()
  // Wait until pdf.js has actually drawn into the canvas.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pdf-page[data-page="1"] canvas')
    return !!canvas && canvas.width > 300
  })
  return Date.now() - start
}

test('imports a copy and opens 120 slides in under 2 seconds', async () => {
  const before = await sha256(source)

  const ms = await importIntoSection()
  console.log(`120-slide PDF imported and first page drawn in ${ms} ms`)

  expect(ms).toBeLessThan(2000)
  await expect(pageInput()).toHaveValue('1')
  await expect(page.locator('.pdf-page-input')).toContainText('/ 120')
  expect(await sha256(source)).toBe(before)
  expect(
    await sha256(path.join(env.vault, 'Machine Learning/B2 Decision trees/B2 Decision trees.pdf'))
  ).toBe(before)
  await page.screenshot({ path: path.join('test-results', 'viewer.png') })
  expect(errors).toEqual([])
})

test('tracks the current page and only draws pages near the view', async () => {
  await importIntoSection()

  await pageInput().fill('50')
  await pageInput().press('Enter')

  await expect(pageInput()).toHaveValue('50')
  await expect(page.locator('.pdf-page[data-page="50"] canvas')).toBeVisible()
  expect(await page.locator('.pdf-page canvas').count()).toBeLessThan(15)

  await page.locator('.pdf-scroll').press('ArrowRight')
  await expect(pageInput()).toHaveValue('51')
})

test('zooms and fits the width again', async () => {
  await importIntoSection()
  const zoomLevel = page.locator('.pdf-zoom-level')
  const fitted = await zoomLevel.textContent()

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoomLevel).not.toHaveText(fitted!)
  await expect(page.getByRole('button', { name: 'Fit width' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )

  await page.getByRole('button', { name: 'Fit width' }).click()
  await expect(zoomLevel).toHaveText(fitted!)
})

test('remembers the last page after a restart', async () => {
  await importIntoSection()
  await pageInput().fill('37')
  await pageInput().press('Enter')
  await expect(pageInput()).toHaveValue('37')
  await expect
    .poll(async () => {
      const state = await fs
        .readFile(path.join(env.vault, '.marginalia/state.json'), 'utf8')
        .catch(() => '{}')
      return JSON.parse(state).lastPage
    })
    .toEqual({ 'Machine Learning/B2 Decision trees/B2 Decision trees.pdf': 37 })

  await app.close()
  ;({ app, page } = await launch(env))
  await row('B2 Decision trees.pdf').click()
  await expect(pageInput()).toHaveValue('37')
})

test('adds a suffix when the same PDF is imported twice', async () => {
  await importIntoSection()
  await page.keyboard.press('Control+Shift+I')

  await expect(row('B2 Decision trees (2).pdf')).toBeVisible()
  expect(await fs.readdir(path.join(env.vault, 'Machine Learning/B2 Decision trees'))).toEqual([
    'B2 Decision trees (2).pdf',
    'B2 Decision trees.pdf'
  ])
})

test('Ctrl+F finds text on the slides and in text boxes', async () => {
  const pdf = path.join(env.vault, 'Machine Learning/B2 Decision trees/slides.pdf')
  await fs.copyFile(source, pdf)
  const box = { id: 't1', x: 980, y: 60, width: 200, markdown: 'Like **Slide 7**', author: 'me' }
  await fs.writeFile(
    `${pdf}.annotations.json`,
    JSON.stringify({
      version: 1,
      pdf: 'slides.pdf',
      pdfSha256: await sha256(pdf),
      marginWidth: 0.3,
      pages: { '12': { strokes: [], highlights: [], textBoxes: [box] } }
    })
  )
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await row('slides.pdf').click()
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeVisible()

  await page.keyboard.press('Control+F')
  const find = page.getByRole('textbox', { name: 'Find in slides and text boxes' })
  const count = page.locator('.find-count')
  await expect(find).toBeFocused()
  // Slide 7, slides 70 to 79 (spaces do not count), and the text box on slide 12.
  await find.fill('slide 7')
  await expect(count).toHaveText('1 of 12')
  await expect(pageInput()).toHaveValue('7')
  await expect(page.locator('.pdf-page[data-page="7"] .find-hit.current')).toBeVisible()

  await find.press('Enter')
  await expect(count).toHaveText('2 of 12')
  await expect(pageInput()).toHaveValue('12')
  await expect(page.locator('.text-box.found.current')).toContainText('Like Slide 7')
  await page.screenshot({ path: path.join('test-results', 'find.png') })

  await find.press('Shift+Enter')
  await find.press('Shift+Enter')
  await expect(count).toHaveText('12 of 12')
  await expect(pageInput()).toHaveValue('79')

  await find.press('Escape')
  await expect(find).toHaveCount(0)
  await expect(page.locator('.find-hit')).toHaveCount(0)
  await expect(page.locator('.pdf-scroll')).toBeFocused()
  expect(errors).toEqual([])
})
