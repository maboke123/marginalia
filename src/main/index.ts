import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { ConfigStore } from './config'
import { registerClaude } from './claude/service'
import { handle, registerIpc } from './ipc'
import { registerTerminal } from './terminal'

let mainWindow: BrowserWindow | null = null

// UI tests run while I use other apps: their window opens off screen and never takes focus.
const offscreen = process.env['MARGINALIA_OFFSCREEN'] === '1'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
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
}

// vault://local/<path in vault> serves images in notes. Only files inside the open vault.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// The default menu binds Ctrl+Shift+I and Ctrl+R, which the app needs for its own hotkeys.
Menu.setApplicationMenu(null)

app.whenReady().then(async () => {
  app.setAppUserModelId('be.kuleuven.mathiasbk.marginalia-poc')
  const config = new ConfigStore(path.join(app.getPath('userData'), 'config.json'))
  nativeTheme.themeSource = (await config.read()).settings.theme
  const currentVault = registerIpc(() => mainWindow, config, app.getPath('userData'))
  registerClaude(handle, () => mainWindow, config, currentVault)
  registerTerminal(handle, () => mainWindow, config, currentVault)
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
