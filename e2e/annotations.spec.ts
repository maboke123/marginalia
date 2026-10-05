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

test('a blank page below a slide takes notes and can be removed', async () => {
  await openSlides()
  await page.getByRole('button', { name: 'Add blank page' }).click()
  const blank = page.locator('.pdf-page.blank[data-page="1.1"]')
  await expect(blank).toBeVisible()
  await expect(blank.locator('.textLayer')).toHaveCount(0)
  // The PDF's own second page comes after it.
  const order = await page
    .locator('.pdf-page')
    .evaluateAll((els) => els.slice(0, 3).map((el) => (el as HTMLElement).dataset.page))
  expect(order).toEqual(['1', '1.1', '2'])

  await page.keyboard.press('t')
  const sheet = (await blank.boundingBox())!
  await page.mouse.click(sheet.x + sheet.width * 0.1, sheet.y + sheet.height * 0.2)
  await page.keyboard.type('More room for the proof')
  await page.keyboard.press('Escape')
  await expect(blank.locator('.text-box')).toHaveText('More room for the proof')
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1.1'])
    .toMatchObject({ blank: true, textBoxes: [{ markdown: 'More room for the proof' }] })

  await page.keyboard.press('v')
  await blank.click({ button: 'right', position: { x: 20, y: 20 } })
  await page.getByRole('menuitem', { name: /Remove this blank page/ }).click()
  await expect(blank).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(blank.locator('.text-box')).toHaveText('More room for the proof')
  await page.screenshot({ path: path.join('test-results', 'blank-page.png') })
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

test('text boxes snap onto lines of slide text, unless Alt is held or snapping is off', async () => {
  await openSlides()
  const span = firstPage().locator('.textLayer span', { hasText: 'Information gain' })
  // Measured each time: switching tools can make the toolbar wrap and move the page.
  const line = async (): Promise<{ right: number; middle: number }> => {
    const r = (await span.boundingBox())!
    return { right: r.x + r.width, middle: r.y + r.height / 2 }
  }
  const firstLineMiddle = async (box: Locator): Promise<number> => {
    const r = (await box.locator('.text-box-content > :first-child').boundingBox())!
    return r.y + r.height / 2
  }

  // Put next to the line, a little too high: it lands on the line.
  await page.keyboard.press('t')
  let l = await line()
  await page.mouse.click(l.right + 60, l.middle - 2)
  await page.keyboard.type('Gain')
  await page.keyboard.press('Escape')
  const box = firstPage().locator('.text-box')
  expect(Math.abs((await firstLineMiddle(box)) - (await line()).middle)).toBeLessThan(1.5)

  // Dragged a few pixels with Alt held, it stays where it is dropped.
  await page.keyboard.press('Escape')
  const b = (await box.boundingBox())!
  await page.keyboard.down('Alt')
  await page.mouse.move(b.x + 10, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + 10, b.y + b.height / 2 + 5, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  expect((await firstLineMiddle(box)) - (await line()).middle).toBeGreaterThan(3)

  // Without Alt it goes back onto the line.
  const c = (await box.boundingBox())!
  await page.mouse.move(c.x + 10, c.y + c.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + 10, c.y + c.height / 2 - 3, { steps: 5 })
  await expect(firstPage().locator('.snap-guide')).toHaveCount(1)
  await page.screenshot({ path: path.join('test-results', 'snapping.png') })
  await page.mouse.up()
  await expect(firstPage().locator('.snap-guide')).toHaveCount(0)
  expect(Math.abs((await firstLineMiddle(box)) - (await line()).middle)).toBeLessThan(1.5)

  // With snapping switched off, a new box stays where it is put.
  await page.getByRole('button', { name: 'Snapping' }).click()
  await expect(page.getByRole('button', { name: 'Snapping' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await page.keyboard.press('t')
  l = await line()
  await page.mouse.click(l.right - 100, l.middle + 4)
  await page.keyboard.type('Free')
  await page.keyboard.press('Escape')
  const free = firstPage().locator('.text-box', { hasText: 'Free' })
  // Its first line of text is where I clicked.
  expect(Math.abs((await firstLineMiddle(free)) - ((await line()).middle + 4))).toBeLessThan(1.5)
})

test('V goes back to the select tool', async () => {
  await openSlides()
  const tool = (name: string): Locator =>
    page
      .getByRole('toolbar', { name: 'Annotation tools' })
      .getByRole('button', { name, exact: true })
  await page.keyboard.press('t')
  await expect(tool('Text box')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('v')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Select')).toHaveAttribute('title', 'Select (V or Esc)')
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

test('a text box keeps its text when I scroll away while typing', async () => {
  await openSlides()
  await page.keyboard.press('t')
  await drawOnPage([0.7, 0.2], [0.7, 0.2])
  await page.keyboard.type('Gini impurity')
  const scroller = page.locator('.pdf-scroll')
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(firstPage().locator('.page-overlay')).toHaveCount(0)
  await scroller.evaluate((el) => (el.scrollTop = 0))

  const box = firstPage().locator('.text-box')
  await expect(box).toHaveText('Gini impurity')
  await expect(box.locator('textarea')).toHaveCount(0)
  await expect
    .poll(async () => (await readSidecar().catch(() => null))?.pages['1']?.textBoxes?.length)
    .toBe(1)

  // Closing the app while still typing in a second box.
  await drawOnPage([0.7, 0.6], [0.7, 0.6])
  await page.keyboard.type('Entropy')
  await app.close()
  expect((await readSidecar()).pages['1'].textBoxes).toMatchObject([
    { markdown: 'Gini impurity' },
    { markdown: 'Entropy' }
  ])
  ;({ app, page } = await launch(env))
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

test('selected slide text goes away with Escape or a click elsewhere', async () => {
  await openSlides()
  const span = firstPage().locator('.textLayer span', { hasText: 'Information gain' })
  const select = async (): Promise<void> => {
    const box = (await span.boundingBox())!
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.selection-action')).toBeVisible()
  }
  const selected = (): Promise<string> => page.evaluate(() => String(window.getSelection()))

  await select()
  await page.keyboard.press('Escape')
  await expect(page.locator('.selection-action')).toBeHidden()
  expect(await selected()).toBe('')

  // A click in the margin, where there is no slide text.
  await select()
  const sheet = (await firstPage().boundingBox())!
  await page.mouse.click(sheet.x + sheet.width * 0.95, sheet.y + sheet.height * 0.5)
  await expect(page.locator('.selection-action')).toBeHidden()
  expect(await selected()).toBe('')
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
