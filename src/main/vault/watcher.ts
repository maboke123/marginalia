import { watch } from 'fs'
import path from 'path'

/**
 * Calls `onChange` (debounced) whenever something in the vault changes on disk,
 * whether the app, Explorer, Obsidian or Claude made the change.
 *
 * Uses one recursive fs.watch instead of chokidar: on Windows chokidar keeps a handle
 * open on every subfolder, and Windows refuses to rename a folder with an open handle,
 * so renaming a section (in the app or in Explorer) failed with EPERM.
 */
export function watchVault(root: string, onChange: () => void, delay = 100): () => Promise<void> {
  let timer: NodeJS.Timeout | undefined

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    // Skips .marginalia, .obsidian, .git and our own temp files. The tree hides them anyway.
    if (filename && filename.split(path.sep).some((part) => part.startsWith('.'))) return
    clearTimeout(timer)
    timer = setTimeout(onChange, delay)
  })
  watcher.on('error', (err) => console.error('[watcher]', err))

  return async () => {
    clearTimeout(timer)
    watcher.close()
  }
}
