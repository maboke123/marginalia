import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createEnv, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page
let slides: string

const section = 'Machine Learning/B2 Decision trees'
const pdfRel = `${section}/slides.pdf`
const sidecar = (): string => path.join(env.vault, `${pdfRel}.annotations.json`)

test.beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-slides-'))
  slides = path.join(dir, 'slides.pdf')
  await makeSlides(slides, 10)
})

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.join(env.vault, section), { recursive: true })
  await fs.mkdir(path.join(env.vault, 'Machine Learning/B3 Ensembles'))
  await fs.copyFile(slides, path.join(env.vault, pdfRel))
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const firstPage = (): Locator => page.locator('.pdf-page[data-page="1"]')
const strokes = (): Locator => firstPage().locator('svg.ink > path')

async function openSlides(): Promise<void> {
  await row('Machine Learning').click()
  await row('B2 Decision trees').first().click()
  await row('slides.pdf').click()
  await expect(firstPage().locator('.textLayer span').first()).toBeAttached()
}

/** Drags the mouse across page 1, from and to fractions of the page box. */
async function drawOnPage(from: [number, number], to: [number, number]): Promise<void> {
  const box = (await firstPage().boundingBox())!
  const at = ([fx, fy]: [number, number]): [number, number] => [
    box.x + fx * box.width,
    box.y + fy * box.height
  ]
  await page.mouse.move(...at(from))
  await page.mouse.down()
  await page.mouse.move(...at(to), { steps: 12 })
  await page.mouse.up()
}

async function readSidecar(): Promise<{ pages: Record<string, Record<string, unknown[]>> }> {
  return JSON.parse(await fs.readFile(sidecar(), 'utf8'))
}

test('annotations survive closing the app right away', async () => {
  await openSlides()

  await page.keyboard.press('p')
  await drawOnPage([0.1, 0.3], [0.4, 0.5])
  await expect(strokes()).toHaveCount(1)

  await page.keyboard.press('t')
  await drawOnPage([0.75, 0.2], [0.75, 0.2])
  await page.keyboard.type('weighted average $\\frac{|S_i|}{|S|}$')
  await page.keyboard.press('Escape')
  await expect(firstPage().locator('.text-box .katex')).toBeVisible()
  await page.screenshot({ path: path.join('test-results', 'annotations.png') })

  // Closing well within the one-second autosave delay.
  await app.close()
  const saved = await readSidecar()
  expect(saved.pages['1'].strokes).toHaveLength(1)
  expect(saved.pages['1'].textBoxes).toMatchObject([
    { markdown: 'weighted average $\\frac{|S_i|}{|S|}$', author: 'me' }
  ])

  ;({ app, page } = await launch(env))
  await row('slides.pdf').click()
  await expect(strokes()).toHaveCount(1)
  await expect(firstPage().locator('.text-box .katex')).toBeVisible()
})

test('annotations follow the PDF to another section', async () => {
  await openSlides()
  await page.keyboard.press('p')
  await drawOnPage([0.1, 0.3], [0.4, 0.5])
  await expect
    .poll(() =>
      fs.access(sidecar()).then(
        () => true,
        () => false
      )
    )
    .toBe(true)

  await row('slides.pdf').dragTo(row('B3 Ensembles'))
  await expect
    .poll(() => fs.readdir(path.join(env.vault, 'Machine Learning/B3 Ensembles')))
    .toEqual(['slides.pdf', 'slides.pdf.annotations.json'])

  await row('slides.pdf').click()
  await expect(strokes()).toHaveCount(1)
})

test('a pasted screenshot goes where I clicked and follows the PDF', async () => {
  await openSlides()
  await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
    const width = 400
    const height = 200
    const pixels = Buffer.alloc(width * height * 4, 0x90)
    const png = nativeImage.createFromBitmap(pixels, { width, height }).toPNG()
    const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
  const box = (await firstPage().boundingBox())!
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3)
  await page.keyboard.press('Control+v')

  const image = firstPage().locator('.page-image')
  await expect(image.locator('img')).toBeVisible()
  await expect(image).toHaveClass(/selected/)
  const placed = (await image.boundingBox())!
  expect(placed.x).toBeCloseTo(box.x + box.width * 0.2, -1)
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1']?.images?.length)
    .toBe(1)
  const [saved] = (await readSidecar()).pages['1'].images as { src: string; width: number }[]
  expect(saved.src).toMatch(/^assets\/.+\.png$/)
  await fs.access(path.join(env.vault, section, saved.src))

  // The corner grip makes it bigger and keeps its shape.
  const grip = (await image.locator('.page-image-resize').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 60, grip.y + grip.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect
    .poll(async () => ((await readSidecar()).pages['1'].images?.[0] as { width: number }).width)
    .toBeGreaterThan(saved.width + 20)
  const resized = (await image.boundingBox())!
  expect(resized.width / resized.height).toBeCloseTo(2, 1)

  await page.keyboard.press('Delete')
  await expect(image).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(image).toHaveCount(1)

  // Moved to another section, the image comes along.
  await expect.poll(async () => (await readSidecar()).pages['1']?.images?.length).toBe(1)
  await row('slides.pdf').dragTo(row('B3 Ensembles'))
  await row('slides.pdf').click()
  await expect(firstPage().locator('.page-image img')).toBeVisible()
  await fs.access(path.join(env.vault, 'Machine Learning/B3 Ensembles', saved.src))
})

test('undo, redo and the eraser', async () => {
  await openSlides()
  await page.keyboard.press('p')
  await drawOnPage([0.1, 0.3], [0.4, 0.3])
  await drawOnPage([0.1, 0.6], [0.4, 0.6])
  await expect(strokes()).toHaveCount(2)

  await page.keyboard.press('Control+z')
  await expect(strokes()).toHaveCount(1)
  await page.keyboard.press('Control+y')
  await expect(strokes()).toHaveCount(2)

  // The partial eraser cuts the top line in two.
  await page.keyboard.press('e')
  await drawOnPage([0.25, 0.2], [0.25, 0.4])
  await expect(strokes()).toHaveCount(3)
  await page.keyboard.press('Control+z')
  await expect(strokes()).toHaveCount(2)

  await page.getByRole('button', { name: 'Whole' }).click()
  await drawOnPage([0.25, 0.2], [0.25, 0.4])
  await expect(strokes()).toHaveCount(1)
})

test('text boxes can be resized, change text size and use bold', async () => {
  await openSlides()
  await page.keyboard.press('t')
  await drawOnPage([0.7, 0.2], [0.7, 0.2])
  await page.keyboard.type('Entropy ')
  await page.keyboard.type('max')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Control+b')
  await page.keyboard.press('Escape')
  const box = firstPage().locator('.text-box')
  await expect(box.locator('strong')).toHaveText('Entropy max')

  await page.keyboard.press('Escape')
  await box.click()
  const before = (await box.boundingBox())!
  const grip = box.locator('.text-box-resize')
  const g = (await grip.boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + 80, g.y + g.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await box.boundingBox())!.width).toBeGreaterThan(before.width + 60)

  const fontBefore = await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  await page.getByRole('combobox', { name: 'Text size' }).selectOption('21')
  await expect
    .poll(() => box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(fontBefore * 1.4)
  await page.getByRole('combobox', { name: 'Text size' }).selectOption('6')
  await expect
    .poll(() => box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeLessThan(fontBefore * 0.5)
})

test('in text mode a click on a box carries on typing in it', async () => {
  await openSlides()
  await page.keyboard.press('t')
  await drawOnPage([0.7, 0.2], [0.7, 0.2])
  await page.keyboard.type('Entropy')
  // Clicking elsewhere on the slide ends the box and starts a new one; Escape drops that.
  await drawOnPage([0.3, 0.7], [0.3, 0.7])
  await page.keyboard.press('Escape')
  const box = firstPage().locator('.text-box')
  await expect(box).toHaveCount(1)

  await box.click()
  await expect(box.locator('textarea')).toBeFocused()
  await page.keyboard.type(' is uncertainty')
  await page.keyboard.press('Escape')
  await expect(box).toHaveText('Entropy is uncertainty')
  await expect(box).toHaveCount(1)
})

test('text boxes take a colour from the toolbar', async () => {
  await openSlides()
  await page.keyboard.press('t')
  await page.getByRole('button', { name: 'Red', exact: true }).click()
  await drawOnPage([0.7, 0.2], [0.7, 0.2])
  await page.keyboard.type('Overfits')
  await page.keyboard.press('Escape')
  const box = firstPage().locator('.text-box')
  await expect(box).toHaveCSS('color', 'rgb(207, 34, 46)')

  // Changing the colour of a selected box is one undo step.
  await page.keyboard.press('Escape')
  await box.click()
  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  await expect(box).toHaveCSS('color', 'rgb(31, 111, 235)')
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1']?.textBoxes[0])
    .toMatchObject({ color: '#1f6feb', markdown: 'Overfits' })
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(box).toHaveCSS('color', 'rgb(207, 34, 46)')
})

test('selected slide text becomes a highlight', async () => {
  await openSlides()
  const span = firstPage().locator('.textLayer span', { hasText: 'Information gain' })
  const box = (await span.boundingBox())!

  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.selection-action')).toBeVisible()
  await page.keyboard.press('h')

  await expect(firstPage().locator('.hl')).toHaveCount(1)
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1']?.highlights)
    .toMatchObject([{ text: expect.stringContaining('Information'), author: 'me' }])
})

test('selected slide text can be underlined', async () => {
  await openSlides()
  const span = firstPage().locator('.textLayer span', { hasText: 'Information gain' })
  const box = (await span.boundingBox())!

  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: /Underline/ }).click()

  await expect(firstPage().locator('.hl.underline')).toHaveCount(1)
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1']?.highlights)
    .toMatchObject([{ style: 'underline', color: '#1f6feb' }])
})

test('hides annotations when the PDF was replaced', async () => {
  await fs.writeFile(
    sidecar(),
    JSON.stringify({
      version: 1,
      pdf: 'slides.pdf',
      pdfSha256: 'hash-of-an-older-version',
      marginWidth: 0.6,
      pages: {
        '1': {
          strokes: [
            {
              id: 's_old',
              tool: 'pen',
              color: '#1f6feb',
              width: 2,
              points: [
                [100, 100, 0.5],
                [200, 150, 0.5]
              ],
              author: 'me'
            }
          ],
          highlights: [],
          textBoxes: []
        }
      }
    })
  )
  await openSlides()

  await expect(page.locator('.pdf-banner')).toContainText('changed since you annotated it')
  await expect(strokes()).toHaveCount(0)
  await page.getByRole('button', { name: 'Show annotations anyway' }).click()
  await expect(strokes()).toHaveCount(1)
})
