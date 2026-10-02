import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { IpcResult, NotebookColor, Position, VaultInfo } from '../shared/types'
import { ConfigStore } from './config'
import { VaultError } from './vault/names'
import { Vault } from './vault/vault'
import { watchVault } from './vault/watcher'

// ipcMain.handle mangles thrown errors into "Error invoking remote method ...",
// so errors travel as plain values and the preload rethrows them.
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<R>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      if (!(err instanceof VaultError)) console.error(`[${channel}]`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

const info = (root: string): VaultInfo => ({ root, name: path.basename(root) })

export function registerIpc(getWindow: () => BrowserWindow | null, config: ConfigStore): void {
  let vault: Vault | null = null
  let stopWatching: (() => Promise<void>) | null = null

  async function open(root: string): Promise<VaultInfo> {
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory()) throw new VaultError(`Folder not found: ${root}`)
    await stopWatching?.()
    vault = new Vault(root, (p) => shell.trashItem(p))
    stopWatching = watchVault(root, () => getWindow()?.webContents.send('vault:changed'))
    await config.addRecentVault(root)
    return info(root)
  }

  function current(): Vault {
    if (!vault) throw new VaultError('No vault is open')
    return vault
  }

  handle('vault:current', () => (vault ? info(vault.root) : null))
  handle('vault:recent', async () => (await config.read()).recentVaults)
  handle('vault:open', (root: string) => open(root))
  handle('vault:pick', async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Open a folder as vault',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return open(result.filePaths[0])
  })

  handle('vault:tree', () => current().tree())
  handle('vault:createFolder', (parent: string, name: string) =>
    current().createFolder(parent, name)
  )
  handle('vault:createNote', (parent: string, name: string) => current().createNote(parent, name))
  handle('vault:rename', (p: string, name: string) => current().rename(p, name))
  handle('vault:move', (p: string, parent: string, before: Position) =>
    current().move(p, parent, before)
  )
  handle('vault:setColor', (notebook: string, color: NotebookColor | null) =>
    current().setColor(notebook, color)
  )
  handle('vault:reveal', (p: string) => shell.showItemInFolder(current().resolve(p)))
  handle('vault:readFile', (p: string) => current().readFile(p))
  handle('vault:lastPage', (p: string) => current().lastPage(p))
  handle('vault:setLastPage', (p: string, page: number) => current().setLastPage(p, page))

  handle('vault:pickPdfs', async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Import PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  handle('vault:importPdfs', async (parent: string, sources: string[]) => {
    const v = current()
    const imported: string[] = []
    for (const source of sources) imported.push(await v.importPdf(parent, source))
    return imported
  })

  handle('vault:trash', async (p: string) => {
    const v = current()
    const abs = v.resolve(p)
    const isDir = (await fs.stat(abs)).isDirectory()
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Move "${path.basename(abs)}" to the Recycle Bin?`,
      detail: isDir
        ? 'Everything inside it moves too. You can restore it from the Recycle Bin.'
        : 'You can restore it from the Recycle Bin.'
    }
    const win = getWindow()
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (response !== 0) return false
    await v.trash(p)
    return true
  })
}
