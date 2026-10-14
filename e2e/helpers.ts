import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

export interface TestEnv {
  dir: string
  vault: string
  userData: string
}

/** A temp folder with an empty vault and a profile that reopens it on start. */
export async function createEnv(): Promise<TestEnv> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-e2e-'))
  const vault = path.join(dir, 'Notes')
  const userData = path.join(dir, 'profile')
  await fs.mkdir(vault)
  await fs.mkdir(userData)
  await fs.writeFile(
    path.join(userData, 'config.json'),
    JSON.stringify({ recentVaults: [vault], settings: { autoTranscribe: false } })
  )
  return { dir, vault, userData }
}

/** Where the fake agent writes what it received, per session. */
export const fakeLog = (env: TestEnv): string => path.join(env.dir, 'claude-log.json')

export async function launch(
  env: TestEnv,
  extra: Record<string, string> = {},
  args: string[] = []
): Promise<{ app: ElectronApplication; page: Page }> {
  // ELECTRON_RUN_AS_NODE is set when this runs from inside VS Code; it would start Electron as plain Node.
  const vars = Object.fromEntries(
    Object.entries({
      ...process.env,
      MARGINALIA_USER_DATA: env.userData,
      MARGINALIA_OFFSCREEN: process.env.MARGINALIA_SHOW_WINDOW ? '0' : '1',
      // Tests never talk to the real Claude: a scripted agent answers instead.
      MARGINALIA_FAKE_CLAUDE: path.resolve('e2e/fakeClaude.mjs'),
      MARGINALIA_FAKE_LOG: fakeLog(env),
      // Nor run whisper: a fake engine answers with numbered sentences.
      MARGINALIA_FAKE_WHISPER: '1',
      ...extra
    }).filter((e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined)
  )
  // Chromium's fake microphone (a beeping tone) and no permission prompt.
  const media = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  const app = await electron.launch({ args: ['.', ...media, ...args], env: vars })
  const page = await app.firstWindow()
  return { app, page }
}

/** A 16:9 slide deck like PowerPoint exports, with "Slide n" on every page. */
export async function makeSlides(file: string, count: number): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage([960, 540])
    page.drawText(`Slide ${i}`, { x: 60, y: 440, size: 48, font })
    page.drawText('Information gain = H(S) - sum |Sv|/|S| H(Sv)', { x: 60, y: 300, size: 24, font })
  }
  await fs.writeFile(file, await doc.save())
}

export async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex')
}
