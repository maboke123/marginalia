import { app, BrowserWindow, ipcMain } from 'electron'
import type { IPty } from 'node-pty'
import type { TerminalSession } from '../shared/types'
import { claudeEnvironment, claudeExecutable, storedApiKey } from './claude/cli'
import type { MemoryStore } from './claude/memory'
import { withInstructions, withMemory } from './claude/prompt'
import type { ConfigStore } from './config'
import type { Handle } from './ipc'
import { VaultError } from './vault/names'
import type { Vault } from './vault/vault'

// Enough to redraw the screen when the panel is opened again.
const SCROLLBACK = 200_000

/**
 * The terminal tab: the real Claude Code CLI in the vault folder (SPEC section 6, M5).
 * One session at a time; it keeps running while the panel is closed.
 */
export function registerTerminal(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  config: ConfigStore,
  getVault: () => Vault | null,
  memory: MemoryStore
): void {
  let term: IPty | null = null
  let output = ''

  const stop = (): void => {
    term?.kill()
    term = null
    output = ''
  }

  handle('terminal:start', async (cols: number, rows: number): Promise<TerminalSession> => {
    if (term) return { output }
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    const pty = await import('node-pty')
    // UI tests run a plain shell instead of starting a real Claude session.
    const testCommand = process.env['MARGINALIA_TERMINAL_COMMAND']
    const instructions = (await config.read()).claude.instructions.trim()
    // No course yet: the CLI is told where the course notes are and reads the one it needs.
    const me = { me: await memory.read(''), course: '', courseNote: '' }
    const append = withMemory(withInstructions('', instructions), me, { dir: memory.dir }).trim()
    const args = testCommand ? [] : ['--append-system-prompt', append]
    const started = pty.spawn(testCommand ?? claudeExecutable(), args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: vault.root,
      env: {
        ...(claudeEnvironment(await storedApiKey(config)) as Record<string, string>),
        // The classic renderer clears the scrollback and prints the whole chat again on a
        // repaint, which threw xterm back to the start of the chat. This one scrolls itself.
        CLAUDE_CODE_NO_FLICKER: '1'
      }
    })
    term = started
    started.onData((data) => {
      output = (output + data).slice(-SCROLLBACK)
      getWindow()?.webContents.send('terminal:data', data)
    })
    started.onExit(({ exitCode }) => {
      if (term !== started) return
      term = null
      output = ''
      getWindow()?.webContents.send('terminal:exit', exitCode)
    })
    return { output: '' }
  })

  ipcMain.on('terminal:input', (_event, data: string) => term?.write(data))
  ipcMain.on('terminal:resize', (_event, cols: number, rows: number) => {
    if (cols > 0 && rows > 0) term?.resize(cols, rows)
  })
  handle('terminal:stop', stop)

  // The CLI works in the vault folder; another vault needs a new session.
  ipcMain.on('vault:opened', stop)
  // A pty left running keeps the app process alive after the window closes.
  app.on('before-quit', stop)
}
