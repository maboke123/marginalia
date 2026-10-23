import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { createEnv, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

const section = 'Machine Learning/B2 Decision trees'

test.beforeEach(async () => {
  env = await createEnv()
  const dir = path.join(env.vault, section)
  await fs.mkdir(dir, { recursive: true })
  await makeSlides(path.join(dir, 'slides.pdf'), 3)
  await fs.writeFile(
    path.join(dir, 'Summary.md'),
    '# Decision trees\n\nSplit on information gain.\n'
  )
  await fs.writeFile(path.join(dir, 'Bagging.md'), '# Bagging\n\nAverage many trees.\n')
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const pane = (n: number): Locator => page.getByRole('region', { name: `Pane ${n}` })

test('files open side by side in panes, each where I last clicked', async () => {
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await row('slides.pdf').click()
  await expect(page.locator('.pdf-page[data-page="1"]')).toBeVisible()

  await page.getByRole('button', { name: 'Layout' }).click()
  await page.getByRole('menuitem', { name: 'Three side by side' }).click()
  await expect(page.locator('.grid-pane')).toHaveCount(3)
  // The panes get the whole window; what was open stays in the first one.
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(pane(1).locator('.pdf-viewer')).toBeVisible()
  // Fitted to its narrow pane, with nothing to scroll sideways.
  await expect
    .poll(() =>
      pane(1)
        .locator('.pdf-scroll')
        .evaluate((el) => el.scrollWidth - el.clientWidth)
    )
    .toBeLessThanOrEqual(0)

  // An empty pane offers recent files; the sidebar can come back for the others.
  await pane(2).locator('.grid-empty').click()
  await expect(pane(2)).toHaveClass(/focused/)
  await pane(2)
    .getByRole('button', { name: /Show the sidebar/ })
    .click()
  await row('Summary').click()
  await expect(pane(2).locator('.md-editor')).toContainText('Split on information gain')
  await pane(3).locator('.grid-empty').click()
  await row('Bagging').click()
  await expect(pane(3).locator('.md-editor')).toContainText('Average many trees')
  await page.screenshot({ path: path.join('test-results', 'grid-three.png') })

  // A file that is already open is not opened twice: its pane gets the focus.
  await row('slides.pdf').click()
  await expect(pane(1)).toHaveClass(/focused/)
  await expect(pane(3).locator('.md-editor')).toContainText('Average many trees')

  // The hotkey goes on to four panes, then back to one file: the focused one.
  await page.keyboard.press('Control+Alt+G')
  await expect(page.locator('.grid-pane')).toHaveCount(4)
  await page.keyboard.press('Control+Alt+G')
  await expect(page.locator('.grid-pane')).toHaveCount(0)
  await expect(page.locator('.pdf-viewer')).toBeVisible()
})
