import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

let vault: string
let userData: string
let app: ElectronApplication
let page: Page

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })

test.beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-e2e-'))
  vault = path.join(tmp, 'Notes')
  userData = path.join(tmp, 'profile')
  await fs.mkdir(path.join(vault, 'Machine Learning', 'B2 Decision trees'), { recursive: true })
  await fs.writeFile(path.join(vault, 'Machine Learning', 'B2 Decision trees', 'Summary.md'), '')
  await fs.writeFile(path.join(vault, 'Machine Learning', 'B2 Decision trees', 'slides.pdf'), '')
  await fs.mkdir(userData)
  await fs.writeFile(path.join(userData, 'config.json'), JSON.stringify({ recentVaults: [vault] }))

  // ELECTRON_RUN_AS_NODE is set when this runs from inside VS Code; it would start Electron as plain Node.
  const env = Object.fromEntries(
    Object.entries({ ...process.env, MARGINALIA_USER_DATA: userData }).filter(
      (e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined
    )
  )
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(path.dirname(vault), { recursive: true, force: true })
})

test('reopens the last vault and shows its notebooks', async () => {
  await expect(page.locator('.vault-switcher')).toHaveText('Notes')
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()
  await expect(row('Summary')).toBeVisible()
  await expect(row('slides.pdf')).toBeVisible()
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
  await fs.mkdir(path.join(vault, 'Machine Learning', 'B3 Ensembles'))
  await row('Machine Learning').click()
  await row('B2 Decision trees').click()

  await row('Summary').dragTo(row('B3 Ensembles'))

  await expect
    .poll(() => fs.readdir(path.join(vault, 'Machine Learning', 'B3 Ensembles')))
    .toEqual(['Summary.md'])
  await page.screenshot({ path: path.join('test-results', 'sidebar.png') })
})
