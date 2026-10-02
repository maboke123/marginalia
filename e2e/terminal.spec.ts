import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { createEnv, launch, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

// A plain shell stands in for the Claude Code CLI, so no real session starts.
test.beforeEach(async () => {
  env = await createEnv()
  ;({ app, page } = await launch(env, { MARGINALIA_TERMINAL_COMMAND: 'cmd.exe' }))
  await expect(page.locator('.sidebar-header')).toBeVisible()
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const screen = (): Locator => page.locator('.claude-terminal .xterm-rows')

test('runs in the vault folder and keeps its screen when the panel closes', async () => {
  await page.keyboard.press('Control+L')
  await page.getByRole('tab', { name: 'Terminal' }).click()
  // cmd prints its working directory in the prompt: the vault.
  await expect(screen()).toContainText(`${env.vault}>`)

  await page.keyboard.type('echo hello from the terminal')
  await page.keyboard.press('Enter')
  await expect(screen()).toContainText('hello from the terminal', { timeout: 10_000 })

  // Closing the panel leaves the session running; reopening shows what was there.
  await page.getByRole('button', { name: 'Close' }).click()
  await page.keyboard.press('Control+L')
  await page.getByRole('tab', { name: 'Terminal' }).click()
  await expect(screen()).toContainText('hello from the terminal')

  await page.locator('.claude-terminal .xterm').click()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.locator('.claude-terminal-ended')).toContainText('stopped')
})
