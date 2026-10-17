import { app, shell } from 'electron'
import { VaultError } from './vault/names'

/** VS Code's own link for opening a folder, so no shell has to quote the path. */
export function vscodeUrl(dir: string): string {
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const encoded = parts.map((part, i) =>
    i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
  )
  return `vscode://file/${encoded.join('/').replace(/^\//, '')}/`
}

export async function openInCode(dir: string): Promise<void> {
  if (!app.getApplicationNameForProtocol('vscode://')) {
    throw new VaultError('VS Code is not installed')
  }
  await shell.openExternal(vscodeUrl(dir))
}
