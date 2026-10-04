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
