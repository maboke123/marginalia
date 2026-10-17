import { app, shell } from 'electron'
import { VaultError } from './vault/names'

/** A new VS Code window needs a moment before it takes links; earlier ones go to another window. */
const WINDOW_READY_MS = 5000

/**
 * VS Code's own link for opening a folder, so no shell has to quote the path. Without
 * windowId=_blank it replaced the folder of the window I was working in.
 */
export function vscodeUrl(dir: string): string {
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const encoded = parts.map((part, i) =>
    i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
  )
  return `vscode://file/${encoded.join('/').replace(/^\//, '')}/?windowId=_blank`
}

/** Opens a conversation in the Claude Code extension's panel. */
export function claudeChatUrl(sessionId: string): string {
  return `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`
}

export function assertCodeInstalled(): void {
  if (!app.getApplicationNameForProtocol('vscode://')) {
    throw new VaultError('VS Code is not installed')
  }
}

export async function openInCode(dir: string, sessionId?: string): Promise<void> {
  assertCodeInstalled()
  await shell.openExternal(vscodeUrl(dir))
  if (!sessionId) return
  await new Promise((resolve) => setTimeout(resolve, WINDOW_READY_MS))
  await shell.openExternal(claudeChatUrl(sessionId))
}
