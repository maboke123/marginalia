import path from 'path'
import { watch } from 'chokidar'

/**
 * Calls `onChange` (debounced) whenever something in the vault changes on disk,
 * whether the app, Explorer, Obsidian or Claude made the change.
 */
export function watchVault(root: string, onChange: () => void, delay = 100): () => Promise<void> {
  let timer: NodeJS.Timeout | undefined

  const watcher = watch(root, {
    ignoreInitial: true,
    // Skips .marginalia, .obsidian, .git and our own temp files. The tree hides them anyway.
    ignored: (p) =>
      path
        .relative(root, p)
        .split(path.sep)
        .some((part) => part.startsWith('.'))
  })

  watcher.on('all', () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, delay)
  })

  return async () => {
    clearTimeout(timer)
    await watcher.close()
  }
}
