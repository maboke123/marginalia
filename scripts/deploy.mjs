// Builds the installer from the current commit and installs it over the app on this laptop.
// Usage: npm run deploy [-- --no-start]
import { execFileSync, execSync, spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const programs = path.join(process.env.LOCALAPPDATA, 'Programs')
const installed = path.join(programs, 'marginalia', 'marginalia.exe')
// The app was called marginalia-poc before; that install is closed and removed once.
const oldUninstaller = path.join(programs, 'marginalia-poc', 'Uninstall marginalia-poc.exe')
const start = !process.argv.includes('--no-start')

// VS Code sets this; it would make Electron start as plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env })
const out = (cmd) => execSync(cmd, { cwd: root, env }).toString().trim()
const step = (text) => console.log(`\n== ${text}`)

// What gets installed is always a commit, never half-finished work.
const dirty = out('git status --porcelain --untracked-files=no')
if (dirty) {
  console.error(`Not deploying: these files have changes that are not committed:\n${dirty}`)
  process.exit(1)
}
const commit = out('git rev-parse --short HEAD')
const version = `0.1.${out('git rev-list --count HEAD')}`

step(`Checking ${commit} (version ${version})`)
run('npm run typecheck')
run('npx vitest run')

step('Building the installer')
for (const f of existsSync(dist) ? readdirSync(dist) : []) {
  if (/-setup\.exe(\.blockmap)?$/.test(f)) rmSync(path.join(dist, f))
}
run('npx electron-vite build')
run(`npx electron-builder --win -c.extraMetadata.version=${version}`)
const installer = path.join(dist, `marginalia-${version}-setup.exe`)
if (!existsSync(installer)) throw new Error(`Installer not found: ${installer}`)

step('Starting the built app once, off screen')
{
  const { _electron: electron } = await import('@playwright/test')
  const profile = mkdtempSync(path.join(os.tmpdir(), 'marginalia-smoke-'))
  writeFileSync(path.join(profile, 'config.json'), '{}')
  const app = await electron.launch({
    executablePath: path.join(dist, 'win-unpacked', 'marginalia.exe'),
    env: { ...env, MARGINALIA_USER_DATA: profile, MARGINALIA_OFFSCREEN: '1' }
  })
  const window = await app.firstWindow()
  await window.getByRole('heading', { name: 'Open a vault' }).waitFor({ timeout: 30_000 })
  await app.close()
  rmSync(profile, { recursive: true, force: true })
  console.log('It starts.')
}

step('Closing the running app')
const exes = ['marginalia.exe', 'marginalia-poc.exe']
const isRunning = (exe) => {
  try {
    return out(`tasklist /FI "IMAGENAME eq ${exe}" /NH`).includes(exe)
  } catch {
    return false
  }
}
const running = () => exes.some(isRunning)
if (running()) {
  // Without /F Windows asks the window to close, so the app saves everything first.
  for (const exe of exes.filter(isRunning)) {
    try {
      execFileSync('taskkill', ['/IM', exe], { stdio: 'ignore' })
    } catch {
      // It may already be closing.
    }
  }
  const until = Date.now() + 20_000
  while (running() && Date.now() < until) await new Promise((r) => setTimeout(r, 500))
  if (running()) {
    console.error('The app did not close within 20 seconds. Close it yourself and run this again.')
    process.exit(1)
  }
  console.log('Closed.')
} else {
  console.log('Not running.')
}

if (existsSync(oldUninstaller)) {
  step('Removing marginalia-poc (the new app copies its data on first start)')
  execFileSync(oldUninstaller, ['/S'], { stdio: 'inherit' })
}

step('Installing')
execFileSync(installer, ['/S'], { stdio: 'inherit' })
if (!existsSync(installed)) throw new Error(`Not installed at ${installed}`)
console.log(`Installed version ${version} (${commit}).`)

if (start) {
  spawn(installed, [], { detached: true, stdio: 'ignore', env }).unref()
  console.log('Started.')
}
