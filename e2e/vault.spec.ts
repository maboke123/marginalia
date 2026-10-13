import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { createEnv, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let vault: string
let app: ElectronApplication
let page: Page

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })

test.beforeEach(async () => {
  env = await createEnv()
  vault = env.vault
  const section = path.join(vault, 'Machine Learning', 'B2 Decision trees')
  await fs.mkdir(section, { recursive: true })
  await fs.writeFile(path.join(section, 'Summary.md'), '')
  await fs.writeFile(path.join(section, 'slides.pdf'), '')
  await fs.mkdir(path.join(vault, 'Machine Learning', 'B3 Ensembles'))
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

test('reopens the last vault and shows its notebooks', async () => {
  await expect(page.locator('.vault-switcher')).toHaveText('Notes')
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await expect(row('Summary')).toBeVisible()
  await expect(row('slides.pdf')).toBeVisible()
})

test('a note is shown right under the PDF it belongs to', async () => {
  const section = path.join(vault, 'Machine Learning', 'B2 Decision trees')
  await makeSlides(path.join(section, 'slides.pdf'), 3)
  await fs.writeFile(path.join(section, 'A first look.md'), '')
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  const order = (): Promise<string[]> =>
    page
      .locator('.tree-row')
      .evaluateAll((rows) =>
        rows.map((r) => `${r.classList.contains('paired') ? '  ' : ''}${r.textContent}`)
      )
  expect(await order()).toEqual([
    'Machine Learning',
    'B2 Decision trees',
    'A first look',
    'slides.pdf',
    'Summary',
    'B3 Ensembles'
  ])

  // Lecture mode links the lone PDF to a note; from then on that note sits under it.
  await row('slides.pdf').click()
  await page.getByRole('button', { name: 'Lecture mode' }).click()
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.getByRole('button', { name: 'Lecture mode' }).click()
  await expect(page.locator('.tree-row.paired')).toHaveText('A first look')
  expect(await order()).toEqual([
    'Machine Learning',
    'B2 Decision trees',
    'slides.pdf',
    '  A first look',
    'Summary',
    'B3 Ensembles'
  ])

  // A note with the same name as a PDF goes under it without any linking.
  await makeSlides(path.join(section, 'Exercises.pdf'), 1)
  await fs.writeFile(path.join(section, 'exercises.md'), '')
  await expect(page.locator('.tree-row.paired')).toHaveCount(2)
  expect(await order()).toEqual([
    'Machine Learning',
    'B2 Decision trees',
    'Exercises.pdf',
    '  exercises',
    'slides.pdf',
    '  A first look',
    'Summary',
    'B3 Ensembles'
  ])
  await page.locator('.sidebar').screenshot({ path: path.join('test-results', 'paired-notes.png') })

  // Dragging the PDF to another lesson takes its note along, still linked.
  await row('slides.pdf').dragTo(row('B3 Ensembles'))
  await expect
    .poll(() => fs.readdir(path.join(vault, 'Machine Learning', 'B3 Ensembles')))
    .toEqual(['A first look.md', 'slides.pdf'])
  await expect(row('B3 Ensembles').locator('xpath=following-sibling::*[1]')).toHaveText(
    'slides.pdf'
  )
  await expect(page.locator('.tree-row.paired', { hasText: 'A first look' })).toBeVisible()
  expect(await order()).toContain('  A first look')
})

test('feedback from the sidebar is saved with what was open', async () => {
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await row('Summary').click()
  await page.getByRole('button', { name: 'Feedback' }).click()
  await page.getByPlaceholder('What went wrong, or what should change?').fill('Sizes are too big')
  await page.screenshot({ path: path.join('test-results', 'feedback.png') })
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Feedback' })).toBeHidden()

  const saved = await fs.readFile(path.join(env.userData, 'feedback.md'), 'utf8')
  expect(saved).toMatch(
    /- \[ \] \*\*\d{4}-\d\d-\d\d \d\d:\d\d\*\* · Machine Learning\/B2 Decision trees\/Summary\.md\n {2}Sizes are too big\n/
  )
})

test('the sidebar can be hidden and brought back', async () => {
  const sidebar = page.locator('.sidebar')
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await row('Summary').click()
  await page.keyboard.press('Control+Backslash')
  await expect(sidebar).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the sidebar' }).click()
  await expect(sidebar).toBeVisible()

  await page.getByRole('button', { name: 'Hide the sidebar' }).click()
  await expect(sidebar).toHaveCount(0)
  await page.keyboard.press('Control+Backslash')
  await expect(sidebar).toBeVisible()
})

test('a section takes a colour from its menu', async () => {
  await row('Machine Learning').click()
  await row('B2 Decision trees').click({ button: 'right' })
  await page.getByRole('button', { name: 'Dark green' }).click()
  await expect(row('B2 Decision trees').locator('.tree-icon')).toHaveAttribute(
    'style',
    /--nb-darkgreen/
  )
  const settings = JSON.parse(
    await fs.readFile(path.join(vault, '.marginalia', 'settings.json'), 'utf8')
  )
  expect(settings.notebookColors).toEqual({ 'Machine Learning/B2 Decision trees': 'darkgreen' })
})

test('a folder can be hidden and shown again from Settings', async () => {
  await fs.mkdir(path.join(vault, 'Machine Learning', 'B3 Ensembles', 'assignment-repo'))
  await row('Machine Learning').click()
  await row('B3 Ensembles').click()
  await row('assignment-repo').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide folder' }).click()
  await expect(row('assignment-repo')).toHaveCount(0)

  // Still hidden after a restart.
  await app.close()
  ;({ app, page } = await launch(env))
  await expect(row('B3 Ensembles')).toBeVisible()
  await expect(row('assignment-repo')).toHaveCount(0)

  await page.keyboard.press('Control+Comma')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toContainText('Machine Learning/B3 Ensembles/assignment-repo')
  await dialog
    .getByRole('button', { name: 'Show Machine Learning/B3 Ensembles/assignment-repo' })
    .click()
  await expect(dialog).toContainText('None.')
  await page.keyboard.press('Escape')
  await expect(row('assignment-repo')).toBeVisible()
})

test('a notebook created in the app appears on disk', async () => {
  await page.getByRole('button', { name: 'New notebook' }).first().click()
  const input = page.locator('.rename-input')
  await input.fill('Statistics')
  await input.press('Enter')

  await expect(row('Statistics')).toBeVisible()
  expect((await fs.stat(path.join(vault, 'Statistics'))).isDirectory()).toBe(true)
})

test('a folder created outside the app appears within a second', async () => {
  await expect(row('Machine Learning')).toBeVisible()
  await fs.mkdir(path.join(vault, 'Linear Algebra'))
  await expect(row('Linear Algebra')).toBeVisible({ timeout: 1000 })
})

test('F2 renames and Delete goes through the recycle bin', async () => {
  await app.evaluate(({ dialog, shell }) => {
    const g = globalThis as { trashed?: string[] }
    g.trashed = []
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    shell.trashItem = async (p: string) => {
      g.trashed!.push(p)
    }
  })

  await row('Machine Learning').click()
  await page.keyboard.press('F2')
  await page.locator('.rename-input').fill('ML')
  await page.keyboard.press('Enter')
  await expect(row('ML')).toBeVisible()
  expect(await fs.readdir(vault)).toEqual(['ML'])

  await row('ML').click()
  await page.keyboard.press('Delete')
  await expect
    .poll(() => app.evaluate(() => (globalThis as { trashed?: string[] }).trashed))
    .toEqual([path.join(vault, 'ML')])
})

test('dragging a page into another section moves it on disk', async () => {
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()

  await row('Summary').dragTo(row('B3 Ensembles'))

  await expect
    .poll(() => fs.readdir(path.join(vault, 'Machine Learning', 'B3 Ensembles')))
    .toEqual(['Summary.md'])
  await page.screenshot({ path: path.join('test-results', 'sidebar.png') })
})
