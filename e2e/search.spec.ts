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

test.beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-slides-'))
  slides = path.join(dir, 'slides.pdf')
  await makeSlides(slides, 12)
})

async function write(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(env.vault, rel)), { recursive: true })
  await fs.writeFile(path.join(env.vault, rel), text)
}

test.beforeEach(async () => {
  env = await createEnv()
  await write(
    `${section}/Summary.md`,
    '# Decision trees\n\nIntro.\n\n## Onzekerheid\n\nDe entropie meet de onzekerheid.\n'
  )
  await write('Statistiek/Les 1 Régressie/Notities.md', '# Régressie\n\nKleinste kwadraten.\n')
  await fs.copyFile(slides, path.join(env.vault, section, 'slides.pdf'))
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const searchBox = (): Locator => page.getByRole('textbox', { name: 'Search' })
const hits = (): Locator => page.locator('.search-hit')

test('finds words in notes and slides and opens the right place', async () => {
  await expect(page.locator('.tree-row', { hasText: 'Machine Learning' })).toBeVisible()
  await page.keyboard.press('Control+Shift+F')
  await searchBox().fill('ENTROPIE')
  await expect(hits()).toHaveCount(1)
  await expect(hits().first()).toContainText('line 7')
  await expect(hits().first().locator('mark')).toHaveText('entropie')
  await page.keyboard.press('Enter')

  // The note opens with the cursor on the paragraph that matched.
  await expect(page.locator('.overlay')).toHaveCount(0)
  await expect(page.locator('.md-editor .cm-content')).toBeFocused()
  const line = await page.evaluate(() => {
    const sel = window.getSelection()!
    return sel.anchorNode?.parentElement?.closest('.cm-line')?.textContent
  })
  expect(line).toBe('De entropie meet de onzekerheid.')

  // Accents do not matter, and slide text becomes searchable once it is read in the background.
  await page.keyboard.press('Control+Shift+F')
  await searchBox().fill('regressie')
  await expect(page.locator('.search-file')).toContainText('Notities.md')
  await searchBox().fill('slide 9')
  await expect(hits()).toHaveCount(1)
  await expect(hits().first()).toContainText('p.9')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue('9')
})

test('the quick switcher opens files by a few letters', async () => {
  await expect(page.locator('.tree-row', { hasText: 'Machine Learning' })).toBeVisible()
  await page.keyboard.press('Control+P')
  const input = page.getByRole('textbox', { name: 'Go to file' })
  await input.fill('b2 sum')
  await expect(page.locator('.overlay-item').first()).toContainText('Summary.md')
  await page.keyboard.press('Enter')
  await expect(page.locator('.md-editor .cm-content')).toBeVisible()

  // An empty query lists what was opened recently.
  await page.keyboard.press('Control+P')
  await expect(page.locator('.overlay-item')).toHaveText([
    'Summary.mdMachine Learning/B2 Decision trees'
  ])
  await page.keyboard.press('Escape')
  await expect(page.locator('.overlay')).toHaveCount(0)
})

test('searches a semester of slides in under a second', async () => {
  test.setTimeout(120_000)
  await app.close()
  // 10 lessons of 60 slides each, plus notes.
  const deck = path.join(env.dir, 'deck.pdf')
  await makeSlides(deck, 60)
  for (let i = 1; i <= 10; i++) {
    await fs.mkdir(path.join(env.vault, 'Semester', `Les ${i}`), { recursive: true })
    await fs.copyFile(deck, path.join(env.vault, 'Semester', `Les ${i}`, 'slides.pdf'))
    await write(`Semester/Les ${i}/Summary.md`, `# Les ${i}\n\nUniek woord kwartiel${i}.\n`)
  }
  ;({ app, page } = await launch(env))
  await expect(page.locator('.tree-row', { hasText: 'Semester' })).toBeVisible()
  await page.keyboard.press('Control+Shift+F')
  // Wait for the background indexing to finish: the 10 new decks have a slide 59.
  await searchBox().fill('slide 59')
  await expect(page.locator('.search-file')).toHaveCount(10, { timeout: 90_000 })
  await expect(page.locator('.overlay-footer')).not.toContainText('Reading slides')

  const queries = [
    ['kwartiel7', '1 result '],
    ['slide 42', '10 results'],
    // Every slide has this; the list stops at 200.
    ['information gain', '200+ results']
  ]
  for (const [word, count] of queries) {
    await searchBox().fill(word)
    await expect(page.locator('.overlay-footer')).toContainText(count)
    const footer = await page.locator('.overlay-footer').innerText()
    const ms = Number(/in (\d+) ms/.exec(footer)![1])
    console.log(`"${word}": ${footer.split('\n')[0]}`)
    expect(ms).toBeLessThan(1000)
  }
})
