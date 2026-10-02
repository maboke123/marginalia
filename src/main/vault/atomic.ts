import { promises as fs } from 'fs'
import path from 'path'

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

// On Windows, antivirus scanners, the search indexer and OneDrive briefly lock
// files they are reading. A rename that hits such a lock fails with EPERM/EBUSY
// and usually succeeds a few milliseconds later.
export async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || !code || !RETRY_CODES.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** i))
    }
  }
}

/**
 * Writes to a temp file next to the target, flushes it to disk and renames it over the target.
 * A crash halfway leaves either the old file or the new one, never a half-written file.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}-${Date.now()}.tmp`
  )
  const handle = await fs.open(tmp, 'wx')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await renameWithRetry(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}
