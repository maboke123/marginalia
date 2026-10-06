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

  await expect(page.locator('.cm-content .cm-h1')).toHaveText('Information gain')
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

test('a wide formula scrolls inside a narrow note pane', async () => {
  const sum = Array.from({ length: 30 }, (_, i) => `C_{${i}}`).join(' + ')
  await fs.writeFile(path.join(env.vault, section, 'slides.md'), `Intro\n\n$$\n${sum}\n$$\n`)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
  await openSection()
  await row('slides.pdf').click()
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.cm-math-block .katex')).toBeVisible()

  const pane = (await page.locator('.lecture-pane').nth(1).boundingBox())!
  const editorBox = (await page.locator('.md-editor .cm-editor').boundingBox())!
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
  const math = page.locator('.cm-math-block')
  expect(await math.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})

test('mermaid and vega-lite blocks draw as charts', async () => {
  const chart = {
    data: { sequence: { start: 2, stop: 100, step: 7, as: 'n' } },
    transform: [{ calculate: '1.39 * datum.n * log(datum.n) / log(2)', as: 'C' }],
    mark: 'point',
    encoding: {
      x: { field: 'n', type: 'quantitative' },
      y: { field: 'C', type: 'quantitative' }
    }
  }
  await fs.writeFile(
    summaryFile(),
    '# Quicksort\n\n```mermaid\ngraph TD\n  A[Pivot] --> B[Left]\n  A --> C[Right]\n```\n\n' +
      '```vega-lite\n' +
      JSON.stringify(chart, null, 2) +
      '\n```\n\nEnd\n'
  )
  await openSection()
  await row('Summary').click()
  await expect(page.locator('.cm-diagram .diagram svg')).toHaveCount(2)
  await expect(page.locator('.diagram.failed')).toHaveCount(0)
  // One point per n from 2 to 100 in steps of 7, computed by the chart itself.
  await expect(page.locator('[data-lang="vega-lite"] .mark-symbol path')).toHaveCount(14)

  // A broken chart says why and keeps its source in view.
  await fs.writeFile(summaryFile(), '```vega-lite\n{ not json\n```\n\nEnd\n')
  await expect(page.locator('.diagram.failed .diagram-error')).toBeVisible()
  await expect(page.locator('.diagram.failed .diagram-source')).toContainText('{ not json')
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

test('the slash menu offers the heading level that comes next first', async () => {
  await fs.writeFile(summaryFile(), '# Decision trees\n\n')
  await openSection()
  await row('Summary').click()
  await expect(editor()).toBeFocused()

  await page.keyboard.type('/')
  const first = page.locator('.cm-tooltip-autocomplete li').first()
  await expect(first).toContainText('Heading 2')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Entropy\n\nMeasures impurity.\n\n/')
  // After a section with text, the same level again.
  await expect(first).toContainText('Heading 2')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Pruning')
  await expect
    .poll(readSummary)
    .toBe('# Decision trees\n\n## Entropy\n\nMeasures impurity.\n\n## Pruning')
})

test('a heading folds its section, and the fold is kept when the note opens again', async () => {
  await fs.writeFile(
    summaryFile(),
    [
      '# Entropy',
      '',
      'Impurity of a set.',
      '',
      '## Formula',
      '',
      '$$',
      'H(S) = -\\sum_i p_i \\log_2 p_i',
      '$$',
      '',
      '| Split | Gain |',
      '| --- | --- |',
      '| Outlook | 0.246 |',
      '',
      '# Pruning',
      '',
      'Cut back the tree.'
    ].join('\n')
  )
  await fs.writeFile(path.join(env.vault, section, 'Other.md'), 'Other note')
  await openSection()
  await row('Summary').click()
  await expect(editor()).toContainText('Outlook')

  const markers = page.locator('.cm-foldGutter .cm-fold-marker:visible')
  await expect(markers).toHaveCount(3)
  await markers.first().click()
  await expect(editor()).not.toContainText('Impurity')
  await expect(editor()).not.toContainText('Outlook')
  await expect(editor()).toContainText('Cut back the tree.')
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1)
  // Folding only hides; the file is unchanged.
  await expect.poll(readSummary).toContain('Impurity of a set.')

  await row('Other').click()
  await expect(editor()).toContainText('Other note')
  await row('Summary').click()
  await expect(editor()).toContainText('Cut back the tree.')
  await expect(editor()).not.toContainText('Impurity')

  await page.locator('.cm-foldPlaceholder').click()
  await expect(editor()).toContainText('Impurity of a set.')
  await expect(editor()).toContainText('Outlook')
})

test('tasks tick, selected text takes a colour, and the menu has deeper headings', async () => {
  await fs.writeFile(summaryFile(), '- [ ] Revise entropy\n\nGain is high')
  await openSection()
  await row('Summary').click()
  await expect(editor()).toBeFocused()

  await page.locator('.cm-task').click()
  await expect.poll(readSummary).toContain('- [x] Revise entropy')

  await page.keyboard.press('Control+End')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.getByRole('button', { name: 'Red text' }).click()
  await expect
    .poll(readSummary)
    .toBe('- [x] Revise entropy\n\nGain is <span style="color: red">high</span>')
  // The tags stay hidden; only the colour shows.
  await expect(editor().locator('.tc-red')).toHaveText('high')
  await expect(editor()).not.toContainText('<span')

  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\n/heading 5')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Heading 5')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Details')
  await expect.poll(readSummary).toMatch(/\n\n##### Details$/)
})

test('slides can have several notes and remember which one I picked', async () => {
  const dir = path.join(env.vault, section)
  await fs.writeFile(path.join(dir, 'slides.md'), 'My summary')
  await fs.writeFile(path.join(dir, 'Derivations.md'), 'Proof of the bound')
  await openSection()
  await row('slides.pdf').click()
  await page.keyboard.press('Control+Shift+M')
  const title = page.locator('.md-pane .pane-title')
  await expect(title).toHaveText('slides')

  // A note from the folder gets linked and shown.
  await title.click()
  await page.getByRole('menuitem', { name: 'Derivations' }).click()
  await expect(title).toHaveText('Derivations')
  await expect(editor()).toContainText('Proof of the bound')

  // Lecture mode opens it again next time.
  await page.keyboard.press('Control+Shift+M')
  await row('slides.pdf').click()
  await page.keyboard.press('Control+Shift+M')
  await expect(title).toHaveText('Derivations')

  // Both show under the PDF in the sidebar.
  await page.keyboard.press('Control+Shift+M')
  const names = await page.locator('.tree-row').allTextContents()
  const at = names.findIndex((n) => n.includes('slides.pdf'))
  expect(names.slice(at + 1, at + 3).map((n) => n.trim())).toEqual(['Derivations', 'slides'])
  await page.keyboard.press('Control+Shift+M')

  // A new note, then unlinking it goes back to the next linked note.
  await title.click()
  await page.getByRole('textbox', { name: 'New note' }).fill('Exam questions')
  await page.getByRole('textbox', { name: 'New note' }).press('Enter')
  await expect(title).toHaveText('Exam questions')
  await expect.poll(() => fs.readFile(path.join(dir, 'Exam questions.md'), 'utf8')).toBe('')
  await title.click()
  await page.getByRole('menuitem', { name: 'Unlink Exam questions' }).click()
  await expect(title).toHaveText('Derivations')

  const state = JSON.parse(
    await fs.readFile(path.join(env.vault, '.marginalia/state.json'), 'utf8')
  )
  expect(state.notes[`${section}/slides.pdf`]).toEqual([
    `${section}/Derivations.md`,
    `${section}/slides.md`
  ])
})

test('picks up changes made outside the app', async () => {
  await fs.writeFile(summaryFile(), '# Before\n')
  await openSection()
  await row('Summary').click()
  await expect(page.locator('.cm-content .cm-h1')).toHaveText('Before')

  await fs.writeFile(summaryFile(), '# Edited in Obsidian\n')
  await expect(page.locator('.cm-content .cm-h1')).toHaveText('Edited in Obsidian')
})
