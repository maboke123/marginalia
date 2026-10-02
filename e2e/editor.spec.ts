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
const summaryFile = (): string => path.join(env.vault, section, 'Summary.md')

test.beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-slides-'))
  slides = path.join(dir, 'slides.pdf')
  await makeSlides(slides, 8)
})

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.join(env.vault, section), { recursive: true })
  await fs.copyFile(slides, path.join(env.vault, section, 'slides.pdf'))
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const editor = (): Locator => page.locator('.md-editor .cm-content')
const readSummary = (): Promise<string> => fs.readFile(summaryFile(), 'utf8')

async function openSection(): Promise<void> {
  await row('Machine Learning').click()
  await row('B2 Decision trees').first().click()
}

test('math and tables render while typing, and the file stays plain Markdown', async () => {
  await fs.writeFile(summaryFile(), '')
  await openSection()
  await row('Summary').click()
  await expect(editor()).toBeFocused()

  await page.keyboard.type('# Information gain\n\nGain is $IG(S,t)$ for a split.\n\n$$')
  await page.keyboard.press('Enter')
  await page.keyboard.type('H(S) = -\\sum_i p_i \\log_2 p_i')
  // The formula renders under the block while the cursor is inside it.
  await expect(page.locator('.cm-math-preview .katex')).toBeVisible()

  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\n/tab')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Table')
  // CodeMirror ignores Enter for 75 ms after the list opens, against accidental picks.
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Split')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Gain')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Outlook')
  await page.keyboard.press('Tab')
  await page.keyboard.type('0.246')
  // Enter adds a row, Enter on that empty row leaves the table.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Outlook splits best.')

  await expect(page.locator('.cm-h1')).toHaveText('Information gain')
  await expect(page.locator('.cm-math-inline .katex')).toBeVisible()
  await expect(page.locator('.cm-math-block:not(.cm-math-preview) .katex-display')).toBeVisible()
  await expect(page.locator('.cm-table-preview td').first()).toHaveText('Outlook')
  await page.screenshot({ path: path.join('test-results', 'editor.png') })

  await expect
    .poll(readSummary)
    .toBe(
      [
        '# Information gain',
        '',
        'Gain is $IG(S,t)$ for a split.',
        '',
        '$$',
        'H(S) = -\\sum_i p_i \\log_2 p_i',
        '$$',
        '',
        '| Split   | Gain  |',
        '| ------- | ----- |',
        '| Outlook | 0.246 |',
        '',
        'Outlook splits best.',
        ''
      ].join('\n')
    )
})

test('lecture mode, slide links and snapshots', async () => {
  const notes = path.join(env.vault, section, 'slides.md')
  const readSummary = (): Promise<string> => fs.readFile(notes, 'utf8')
  await openSection()
  await row('slides.pdf').click()
  await page.keyboard.press('Control+Shift+M')

  // No note for these slides yet, so lecture mode makes one named after the PDF.
  await expect(page.locator('.lecture-pane')).toHaveCount(2)
  await expect.poll(() => fs.readFile(notes, 'utf8').catch(() => null)).toBe('')
  await expect(editor()).toBeVisible()

  await page.getByRole('textbox', { name: 'Page' }).fill('3')
  await page.getByRole('textbox', { name: 'Page' }).press('Enter')
  await editor().click()
  await page.keyboard.press('Control+Shift+L')
  await page.keyboard.press('Enter')
  await expect.poll(readSummary).toContain('[slide 3](slides.pdf#page=3)')

  // Back to slide 1, then follow the link.
  await page.getByRole('textbox', { name: 'Page' }).fill('1')
  await page.getByRole('textbox', { name: 'Page' }).press('Enter')
  await page.locator('.cm-link-text', { hasText: 'slide 3' }).click()
  await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue('3')

  await editor().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+Shift+S')
  const slide = (await page.locator('.pdf-page[data-page="3"]').boundingBox())!
  await page.mouse.click(slide.x + 100, slide.y + 100)
  await expect
    .poll(() => fs.readdir(path.join(env.vault, section, 'assets')).catch(() => []))
    .toHaveLength(1)
  await expect.poll(readSummary).toMatch(/!\[\]\(assets\/[\d_-]+\.png\)/)

  await page.keyboard.type('Snapshot above.')
  await expect(page.locator('img.cm-image')).toBeVisible()
  await expect
    .poll(() => page.locator('img.cm-image').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(100)
  await page.screenshot({ path: path.join('test-results', 'lecture.png') })
})

test('each PDF keeps its own note in lecture mode', async () => {
  for (const name of ['les_1.pdf', 'les_2.pdf']) {
    await fs.copyFile(slides, path.join(env.vault, section, name))
  }
  await fs.writeFile(summaryFile(), '# Overview\n')
  await openSection()
  const noteTitle = page.locator('.md-pane .pane-title')
  const slidesTitle = page.locator('.pdf-title')
  const lecture = async (pdf: string): Promise<void> => {
    await row(pdf).click()
    await expect(slidesTitle).toHaveText(pdf)
    await page.keyboard.press('Control+Shift+M')
    await expect(page.locator('.lecture-pane')).toHaveCount(2)
  }

  // Several PDFs share the folder, so each gets a note named after it.
  await lecture('les_1.pdf')
  await expect(noteTitle).toHaveText('les_1')
  await editor().click()
  await page.keyboard.type('Notes on lesson one')
  await expect
    .poll(() => fs.readFile(path.join(env.vault, section, 'les_1.md'), 'utf8').catch(() => ''))
    .toBe('Notes on lesson one')
  await page.keyboard.press('Control+Shift+M')

  await lecture('les_2.pdf')
  await expect(noteTitle).toHaveText('les_2')
  // Picking another note in lecture mode makes it the note for these slides.
  await page.keyboard.press('Control+P')
  await page.getByRole('textbox', { name: 'Go to file' }).fill('Summary')
  await page.keyboard.press('Enter')
  await expect(noteTitle).toHaveText('Summary')
  await page.keyboard.press('Control+Shift+M')

  // From the note, lecture mode finds its slides again; and les_1 still has its own note.
  await page.keyboard.press('Control+Shift+M')
  await expect(slidesTitle).toHaveText('les_2.pdf')
  await expect(noteTitle).toHaveText('Summary')
  await page.keyboard.press('Control+Shift+M')
  await lecture('les_1.pdf')
  await expect(noteTitle).toHaveText('les_1')
  await expect(editor()).toContainText('Notes on lesson one')
})

test('a heading from the slash menu leaves the cursor after the hashes', async () => {
  await fs.writeFile(summaryFile(), '')
  await openSection()
  await row('Summary').click()
  await expect(editor()).toBeFocused()

  await page.keyboard.type('/heading 2')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Heading 2')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Pruning')
  await expect.poll(readSummary).toBe('## Pruning')
})

test('picks up changes made outside the app', async () => {
  await fs.writeFile(summaryFile(), '# Before\n')
  await openSection()
  await row('Summary').click()
  await expect(page.locator('.cm-h1')).toHaveText('Before')

  await fs.writeFile(summaryFile(), '# Edited in Obsidian\n')
  await expect(page.locator('.cm-h1')).toHaveText('Edited in Obsidian')
})
