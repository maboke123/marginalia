import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { cpSync, existsSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import icon from '../../build/icon.ico?asset'
import { ConfigStore } from './config'
import { MemoryStore } from './claude/memory'
import { registerClaude } from './claude/service'
import { handle, registerIpc } from './ipc'
import { registerTerminal } from './terminal'
import { registerTranscription } from './transcribe/service'

let mainWindow: BrowserWindow | null = null

// UI tests run while I use other apps: their window opens off screen and never takes focus.
const offscreen = process.env['MARGINALIA_OFFSCREEN'] === '1'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon,
    show: false,
    ...(offscreen ? { x: -20000, y: 0, skipTaskbar: true } : {}),
    // Matches --bg in the renderer so the window does not flash white on start.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => (offscreen ? win.showInactive() : win.show()))
  win.on('closed', () => (mainWindow = null))

  // Give the renderer a moment to save annotations still waiting for their autosave.
  let canClose = false
  let closing = false
  const close = (): void => {
    canClose = true
    if (!win.isDestroyed()) win.close()
  }
  win.on('close', (event) => {
    if (canClose) return
    event.preventDefault()
    if (closing) return
    closing = true
    win.webContents.send('app:before-close')
    ipcMain.once('app:ready-to-close', close)
    // A renderer that hangs must not keep the window open forever.
    setTimeout(close, 3000)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Lets UI tests run against a throwaway profile instead of the real list of recent vaults.
if (process.env['MARGINALIA_USER_DATA']) {
  app.setPath('userData', process.env['MARGINALIA_USER_DATA'])
} else {
  adoptOldUserData()
}

// The app used to be called marginalia-poc, with its recent vaults, settings and saved key in
// that folder. Electron has already created the new folder by now, so look for config.json.
function adoptOldUserData(): void {
  const old = path.join(app.getPath('appData'), 'marginalia-poc')
  const current = app.getPath('userData')
  if (existsSync(path.join(current, 'config.json')) || !existsSync(path.join(old, 'config.json'))) {
    return
  }
  try {
    cpSync(old, current, { recursive: true, force: false })
  } catch (e) {
    console.error('Could not copy the data of marginalia-poc', e)
  }
}

// vault://local/<path in vault> serves images in notes. Only files inside the open vault.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// The default menu binds Ctrl+Shift+I and Ctrl+R, which the app needs for its own hotkeys.
Menu.setApplicationMenu(null)

// Asked once by the preload when a window opens; shown in Settings.
ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()))

app.whenReady().then(async () => {
  app.setAppUserModelId('io.github.maboke123.marginalia')
  const config = new ConfigStore(path.join(app.getPath('userData'), 'config.json'))
  nativeTheme.themeSource = (await config.read()).settings.theme
  const currentVault = registerIpc(() => mainWindow, config, app.getPath('userData'))
  const memory = new MemoryStore(path.join(app.getPath('userData'), 'memory'))
  registerClaude(handle, () => mainWindow, config, currentVault, memory)
  registerTerminal(handle, () => mainWindow, config, currentVault, memory)
  registerTranscription(handle, () => mainWindow, app.getPath('userData'), config, currentVault)
  protocol.handle('vault', (request) => {
    const vault = currentVault()
    if (!vault) return new Response('No vault open', { status: 404 })
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname.slice(1))
      return net.fetch(pathToFileURL(vault.resolve(rel)).toString())
    } catch {
      return new Response('Outside the vault', { status: 403 })
    }
  })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
