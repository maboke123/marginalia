import { createHash } from 'crypto'
import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { AnnotationFile } from '../shared/annotations'
import { settingsFrom, type AppSettings, type TranscribeLanguage } from '../shared/settings'
import type {
  CaptureRect,
  FeedbackEntry,
  IpcResult,
  LinkHow,
  NotebookColor,
  Position,
  VaultInfo
} from '../shared/types'
import { ConfigStore } from './config'
import { exportAnnotated } from './export/exportPdf'
import { appendFeedback, ensureFeedbackFile } from './feedback'
import { writeFileAtomic } from './vault/atomic'
import { SearchIndex } from './search/searchIndex'
import { VaultError } from './vault/names'
import { Vault } from './vault/vault'
import { watchVault } from './vault/watcher'

export type Handle = <A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => R | Promise<R>
) => void

// ipcMain.handle mangles thrown errors into "Error invoking remote method ...",
// so errors travel as plain values and the preload rethrows them.
export function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => R | Promise<R>
): void {
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

/** Returns a getter for the open vault, for the vault:// protocol. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  config: ConfigStore,
  dataDir: string
): () => Vault | null {
  let vault: Vault | null = null
  let search: SearchIndex | null = null
  let stopWatching: (() => Promise<void>) | null = null

  async function open(root: string): Promise<VaultInfo> {
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory()) throw new VaultError(`Folder not found: ${root}`)
    await stopWatching?.()
    await search?.flush()
    vault = new Vault(root, (p) => shell.trashItem(p))
    // One cache per vault, named after its path, outside the vault so it is not synced.
    const id = createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 16)
    search = new SearchIndex(vault, path.join(dataDir, 'search', `${id}.json`))
    stopWatching = watchVault(root, () => getWindow()?.webContents.send('vault:changed'))
    await config.addRecentVault(root)
    ipcMain.emit('vault:opened')
    return info(root)
  }

  function current(): Vault {
    if (!vault) throw new VaultError('No vault is open')
    return vault
  }

  // Things that went wrong, kept with the app's data so it works with any vault open.
  const feedbackFile = path.join(dataDir, 'feedback.md')
  handle('app:feedback', (entry: FeedbackEntry) => appendFeedback(feedbackFile, entry))
  handle('app:openFeedback', async () => {
    await ensureFeedbackFile(feedbackFile)
    const error = await shell.openPath(feedbackFile)
    if (error) throw new VaultError(`Could not open feedback.md: ${error}`)
  })

  handle('app:toggleFullScreen', () => {
    const win = getWindow()
    win?.setFullScreen(!win.isFullScreen())
  })

  handle('app:capture', async (rect: CaptureRect | null) => {
    const win = getWindow()
    if (!win || win.isMinimized()) throw new VaultError('The app window is minimized')
    const image = await win.webContents.capturePage(
      rect
        ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        : undefined
    )
    if (image.isEmpty()) throw new VaultError('The app window is not drawn right now')
    return new Uint8Array(image.toPNG())
  })

  handle('settings:get', async () => (await config.read()).settings)
  handle('settings:set', async (change: Partial<AppSettings>) => {
    let next: AppSettings | undefined
    await config.update((c) => {
      next = settingsFrom({ ...c.settings, ...change })
      return { ...c, settings: next }
    })
    // prefers-color-scheme in the window follows this, so the CSS tokens switch by themselves.
    nativeTheme.themeSource = next!.theme
    return next!
  })

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

  const searchIndex = (): SearchIndex => {
    current()
    return search!
  }
  handle('search:query', (query: string) => searchIndex().query(query))
  handle('search:pending', () => searchIndex().pending())
  handle('search:storePdf', (p: string, stamp: string, pages: string[]) =>
    searchIndex().storePdf(p, stamp, pages)
  )

  handle('vault:tree', () => current().tree())
  handle('vault:createFolder', (parent: string, name: string) =>
    current().createFolder(parent, name)
  )
  handle('vault:createNote', (parent: string, name: string) => current().createNote(parent, name))
  handle('vault:ensureTodo', () => current().ensureTodo())
  handle('vault:rename', (p: string, name: string) => current().rename(p, name))
  handle('vault:move', (p: string, parent: string, before: Position) =>
    current().move(p, parent, before)
  )
  handle('vault:setCourseLanguage', (notebook: string, language: TranscribeLanguage) =>
    current().setCourseLanguage(notebook, language)
  )
  handle('vault:setColor', (folder: string, color: NotebookColor | null) =>
    current().setColor(folder, color)
  )
  handle('vault:reveal', (p: string) => shell.showItemInFolder(current().resolve(p)))
  handle('vault:readFile', (p: string) => current().readFile(p))
  handle('vault:lastPage', (p: string) => current().lastPage(p))
  handle('vault:setLastPage', (p: string, page: number) => current().setLastPage(p, page))
  handle('vault:readText', (p: string) => current().readText(p))
  handle('vault:writeText', (p: string, text: string) => current().writeText(p, text))
  handle('vault:saveAsset', (p: string, data: Uint8Array, ext: string) =>
    current().saveAsset(p, data, ext)
  )
  handle('vault:importImages', async (note: string) => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Insert image',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const v = current()
    const links: string[] = []
    for (const file of result.filePaths) {
      links.push(await v.saveAsset(note, await fs.readFile(file), path.extname(file)))
    }
    return links
  })
  handle('vault:linkedNote', (p: string) => current().linkedNote(p))
  handle('vault:linkedPdf', (p: string) => current().linkedPdf(p))
  handle('vault:setHidden', (p: string, hidden: boolean) => current().setHidden(p, hidden))
  handle('vault:linkNote', (p: string, note: string, how: LinkHow) =>
    current().linkNote(p, note, how)
  )
  handle('vault:readAnnotations', (p: string) => current().readAnnotations(p))
  handle('vault:writeAnnotations', (p: string, file: AnnotationFile) =>
    current().writeAnnotations(p, file)
  )

  handle('vault:exportPdf', async (p: string) => {
    const v = current()
    const source = v.resolve(p)
    const loaded = await v.readAnnotations(p)
    const win = getWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'Export annotated PDF',
      defaultPath: source.replace(/\.pdf$/i, ' (annotated).pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const choice = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return null
    if (path.resolve(choice.filePath).toLowerCase() === source.toLowerCase()) {
      throw new VaultError('Choose another name: the original PDF is never overwritten')
    }
    const folder = p.slice(0, p.lastIndexOf('/') + 1)
    const result = await exportAnnotated(await v.readFile(p), loaded.file, (src) =>
      v.readFile(folder + src).catch(() => null)
    )
    await writeFileAtomic(choice.filePath, result.bytes)
    return {
      path: choice.filePath,
      skippedPages: result.skippedPages,
      missingImages: result.missingImages,
      pdfChanged: !!loaded.file && loaded.file.pdfSha256 !== loaded.pdfSha256
    }
  })

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

  return () => vault
}
