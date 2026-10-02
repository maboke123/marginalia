import { randomUUID } from 'crypto'
import { BrowserWindow, ipcMain, safeStorage } from 'electron'
import { pathToFileURL } from 'url'
import type {
  ChatEvent,
  ChatHistoryItem,
  ChatRequest,
  ClaudeSettings,
  ClaudeSettingsUpdate,
  ToolReply
} from '../../shared/claude'
import { claudeSettings, type ConfigStore } from '../config'
import { VaultError } from '../vault/names'
import type { Handle } from '../ipc'
import type { Vault } from '../vault/vault'
import { claudeAgent, type Agent } from './agent'
import { storedApiKey } from './cli'
import { toHistory } from './events'
import type { CallTool } from './tools'

/** UI tests load a scripted agent instead, so they never use the real Claude. */
interface AgentModule {
  agent: Agent
  history?(sessionId: string, vaultRoot: string): Promise<ChatHistoryItem[]>
}

async function loadAgent(): Promise<AgentModule> {
  const fake = process.env['MARGINALIA_FAKE_CLAUDE']
  if (fake) return import(/* @vite-ignore */ pathToFileURL(fake).href)
  return {
    agent: claudeAgent,
    history: async (sessionId, dir) => {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      return toHistory(await sdk.getSessionMessages(sessionId, { dir }))
    }
  }
}

const STALE_SESSION = /no conversation found/i

export function registerClaude(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  config: ConfigStore,
  getVault: () => Vault | null
): void {
  const agentModule = loadAgent()
  let running: AbortController | null = null
  const pendingTools = new Map<string, (reply: ToolReply) => void>()

  function vault(): Vault {
    const v = getVault()
    if (!v) throw new VaultError('No vault is open')
    return v
  }

  ipcMain.on('claude:tool-reply', (_event, reply: ToolReply) => {
    pendingTools.get(reply.id)?.(reply)
    pendingTools.delete(reply.id)
  })

  const callTool: CallTool = (name, args) =>
    new Promise((resolve) => {
      const id = randomUUID()
      const win = getWindow()
      if (!win || !running || running.signal.aborted) {
        resolve({ id, ok: false, text: 'Stopped' })
        return
      }
      pendingTools.set(id, resolve)
      win.webContents.send('claude:tool', { id, name, args })
    })

  async function settings(): Promise<ClaudeSettings> {
    const { claude, apiKey } = await config.read()
    return { ...claude, hasApiKey: !!apiKey }
  }

  handle('claude:settings', settings)

  handle('claude:setSettings', async (update: ClaudeSettingsUpdate) => {
    const { apiKey, ...rest } = update
    let encrypted: string | null | undefined = undefined
    if (apiKey === null || apiKey?.trim() === '') encrypted = null
    else if (apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new VaultError('Windows cannot encrypt the key right now, so it was not saved')
      }
      encrypted = safeStorage.encryptString(apiKey.trim()).toString('base64')
    }
    await config.update((c) => ({
      ...c,
      claude: claudeSettings({ ...c.claude, ...rest }),
      apiKey: encrypted === undefined ? c.apiKey : encrypted
    }))
    return settings()
  })

  handle('claude:send', async (request: ChatRequest) => {
    if (running) throw new VaultError('Claude is still answering')
    const v = vault()
    const controller = new AbortController()
    running = controller
    const emit = (event: ChatEvent): void =>
      getWindow()?.webContents.send('claude:event', request.chat, event)

    try {
      const { agent } = await agentModule
      const { claude } = await config.read()
      const apiKey = await storedApiKey(config)
      let sessionId = await v.chatSession(request.chat)
      for (let attempt = 0; attempt < 2; attempt++) {
        let done: ChatEvent | null = null
        let answered = false
        const events = agent({
          cwd: v.root,
          text: request.text,
          images: request.images,
          sessionId,
          settings: claude,
          apiKey,
          callTool,
          signal: controller.signal,
          onSession: (id) => void v.setChatSession(request.chat, id).catch(console.error)
        })
        for await (const event of events) {
          if (event.type === 'done') {
            done = event
            break
          }
          answered = true
          emit(event)
        }
        // The stored conversation is gone (say ~/.claude was cleaned up): start a new one.
        if (sessionId && !answered && done?.error && STALE_SESSION.test(done.error)) {
          await v.setChatSession(request.chat, null)
          sessionId = null
          continue
        }
        emit(done ?? { type: 'done', error: controller.signal.aborted ? undefined : 'No answer' })
        return
      }
    } catch (err) {
      if (!controller.signal.aborted) console.error('[claude:send]', err)
      emit({
        type: 'done',
        error: controller.signal.aborted ? undefined : (err as Error).message || String(err)
      })
    } finally {
      running = null
      for (const [id, resolve] of pendingTools) resolve({ id, ok: false, text: 'Stopped' })
      pendingTools.clear()
    }
  })

  handle('claude:stop', () => {
    running?.abort()
  })

  handle('claude:history', async (chat: string) => {
    const v = vault()
    const id = await v.chatSession(chat)
    const { history } = await agentModule
    if (!id || !history) return []
    return history(id, v.root).catch((err) => {
      console.error('[claude:history]', err)
      return []
    })
  })

  handle('claude:newChat', (chat: string) => vault().setChatSession(chat, null))
}
