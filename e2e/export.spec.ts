import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import type { MarginaliaApi } from '../src/shared/types'
import { createEnv, launch, makeSlides, sha256, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

const section = 'Machine Learning/B2 Decision trees'

test.beforeEach(async () => {
  env = await createEnv()
  const dir = path.join(env.vault, section)
  await fs.mkdir(dir, { recursive: true })
  const pdf = path.join(dir, 'slides.pdf')
  await makeSlides(pdf, 3)
  // Annotations as the app saves them: a highlight, ink, and notes on the slide and in the margin.
  await fs.writeFile(
    `${pdf}.annotations.json`,
    JSON.stringify({
      version: 1,
      pdf: 'slides.pdf',
      pdfSha256: await sha256(pdf),
      marginWidth: 0.6,
      pages: {
        '1': {
          strokes: [
            {
              id: 's1',
              tool: 'pen',
              color: '#cf222e',
              width: 4.6,
              points: [
                [70, 330, 0.5],
                [200, 345, 0.5],
                [330, 335, 0.5],
                [480, 350, 0.5]
              ],
              author: 'me'
            }
          ],
          highlights: [
            {
              id: 'h1',
              color: '#ffd33d',
              text: 'Information gain',
              rects: [[58, 214, 200, 30]],
              author: 'me'
            }
          ],
          textBoxes: [
            {
              id: 't1',
              x: 975,
              y: 30,
              width: 540,
              fontSize: 22,
              markdown:
                '**Gain** = drop in entropy: $\\Delta H = H(S) - \\sum_v \\frac{|S_v|}{|S|} H(S_v)$',
              author: 'claude'
            },
            {
              id: 't2',
              x: 600,
              y: 420,
              width: 300,
              fontSize: 22,
              markdown: 'Vraag op examen!',
              author: 'me'
            }
          ]
        }
      }
    })
  )
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

test('exports a flattened copy and leaves the original alone', async () => {
  const original = path.join(env.vault, section, 'slides.pdf')
  const before = await sha256(original)
  const target = path.join(env.vault, section, 'slides (annotated).pdf')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, target)

  await page.locator('.tree-row', { hasText: 'Machine Learning' }).click()
  await page.locator('.tree-row', { hasText: 'B2 Decision trees' }).click()
  await page.locator('.tree-row', { hasText: 'slides.pdf' }).click()
  await page.getByRole('button', { name: 'Export annotated PDF' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to')

  const out = await PDFDocument.load(await fs.readFile(target))
  // The margin note makes every page 60% wider.
  expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([1536, 1536, 1536])
  expect(await sha256(original)).toBe(before)

  // The copy opens like any PDF; look at it.
  await page.locator('.tree-row', { hasText: 'slides (annotated).pdf' }).click()
  await expect(page.locator('.pdf-title')).toHaveText('slides (annotated).pdf')
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeAttached()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join('test-results', 'export.png') })
})

test('exports a note as a PDF with its math, chart and image', async () => {
  const dir = path.join(env.vault, section)
  await fs.mkdir(path.join(dir, 'assets'))
  const png = await app.evaluate(({ nativeImage }) => {
    const pixels = Buffer.alloc(120 * 60 * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set([200, 80, 40, 255], i)
    return nativeImage
      .createFromBitmap(pixels, { width: 120, height: 60 })
      .toPNG()
      .toString('base64')
  })
  await fs.writeFile(path.join(dir, 'assets', 'split plot.png'), Buffer.from(png, 'base64'))
  await fs.writeFile(
    path.join(dir, 'Summary.md'),
    [
      '---',
      'title: "RAND-1: The Hiring Problem"',
      'author: "Mathias Bouhon"',
      'geometry: margin=1.8cm',
      'fontsize: 10pt',
      '---',
      '',
      '# Randomized hiring',
      '',
      'Expected hires: $H_n = \\sum_{i=1}^n \\frac{1}{i}$, see [slide 2](slides.pdf#page=2).',
      '',
      '![plot](assets/split%20plot.png){width=49%}',
      '![plot](assets/split%20plot.png){width=49%}',
      '',
      '```mermaid',
      'graph LR',
      '  Interview --> Hire',
      '```',
      ''
    ].join('\n')
  )
  const target = path.join(dir, 'Summary.pdf')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, target)

  await page.locator('.tree-row', { hasText: 'Machine Learning' }).click()
  await page.locator('.tree-row', { hasText: 'B2 Decision trees' }).click()
  await page.locator('.tree-row', { hasText: 'Summary' }).click()
  await page.getByRole('button', { name: 'Export as PDF' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to', { timeout: 20_000 })

  await app.evaluate(({ shell }) => {
    const g = globalThis as { shown?: string[] }
    g.shown = []
    shell.openPath = async (p: string) => {
      g.shown!.push(`open ${p}`)
      return ''
    }
    shell.showItemInFolder = (p: string) => void g.shown!.push(`reveal ${p}`)
  })
  await page.getByRole('status').getByRole('button', { name: 'Open' }).click()
  await page.getByRole('status').getByRole('button', { name: 'Show in folder' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as { shown?: string[] }).shown))
    .toEqual([`open ${target}`, `reveal ${target}`])
  const refused = await page.evaluate(() =>
    (window as unknown as { api: MarginaliaApi }).api.vault
      .openExport('C:\\Windows\\notepad.exe')
      .then(
        () => 'opened',
        (err: Error) => err.message
      )
  )
  expect(refused).toContain('not exported here')

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(target)) }).promise
  const content = await (await doc.getPage(1)).getTextContent()
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
  expect(text).toContain('Randomized hiring')
  expect(text).toContain('Interview')
  expect(text).toContain('slide 2')
  // The front matter is a title block, not text, and the image sizes are applied.
  expect(text).toContain('RAND-1: The Hiring Problem')
  expect(text).not.toContain('title:')
  expect(text).not.toContain('{width')
  const title = content.items.find((item) => 'str' in item && item.str.startsWith('RAND-1'))
  const left = (title as { transform: number[] }).transform[4]
  expect(Math.round((left / 72) * 2.54 * 10) / 10).toBe(1.8)

  await page.locator('.tree-row', { hasText: 'Summary.pdf' }).click()
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeAttached()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join('test-results', 'export-note.png') })
})

test('a note can be previewed as a PDF before exporting it', async () => {
  const dir = path.join(env.vault, section)
  const paragraphs = Array.from(
    { length: 60 },
    (_, i) => `Paragraph ${i + 1}: the expected number of hires grows like the harmonic number.`
  )
  await fs.writeFile(path.join(dir, 'Report.md'), `# Report\n\n${paragraphs.join('\n\n')}\n`)

  await page.locator('.tree-row', { hasText: 'Machine Learning' }).click()
  await page.locator('.tree-row', { hasText: 'B2 Decision trees' }).click()
  await page.locator('.tree-row', { hasText: 'Report' }).click()
  await page.getByRole('button', { name: 'Preview as PDF' }).click()
  const dialog = page.getByRole('dialog', { name: 'PDF preview' })
  await expect(dialog.getByRole('status')).toHaveText('3 pages, A4', { timeout: 20_000 })
  await expect(dialog.locator('canvas.preview-page')).toHaveCount(3)
  await page.screenshot({ path: path.join('test-results', 'preview-note.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
