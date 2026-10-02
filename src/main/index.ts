import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron'
import path from 'path'
import { ConfigStore } from './config'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
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

  win.on('ready-to-show', () => win.show())
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

// The default menu binds Ctrl+Shift+I and Ctrl+R, which the app needs for its own hotkeys.
Menu.setApplicationMenu(null)

app.whenReady().then(() => {
  app.setAppUserModelId('be.kuleuven.mathiasbk.marginalia-poc')
  registerIpc(() => mainWindow, new ConfigStore(path.join(app.getPath('userData'), 'config.json')))
  createWindow()
})

app.on('window-all-closed', () => app.quit())
