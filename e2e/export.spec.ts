import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
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
