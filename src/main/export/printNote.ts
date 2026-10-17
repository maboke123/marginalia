import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

/**
 * The print window has no vault:// protocol, so images point at their files instead.
 * `resolve` throws for paths outside the vault; such an image is left out.
 */
export function fileImages(html: string, resolve: (vaultPath: string) => string): string {
  return html.replace(/src="vault:\/\/local\/([^"]*)"/g, (_, encoded: string) => {
    try {
      const vaultPath = encoded.split('/').map(decodeURIComponent).join('/')
      return `src="${pathToFileURL(resolve(vaultPath)).href}"`
    } catch {
      return 'src=""'
    }
  })
}

/** A page of HTML as an A4 PDF, printed by Chromium in a window that is never shown. */
export async function printHtml(html: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-print-'))
  const file = path.join(dir, 'note.html')
  await fs.writeFile(file, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(file)
    // KaTeX's fonts may still be loading when the page itself has.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => {})
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 }
    })
  } finally {
    win.destroy()
    await fs.rm(dir, { recursive: true, force: true })
  }
}
