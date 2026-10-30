import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { pathToFileURL } from 'url'
import type {
  CompleteRequest,
  ChatEvent,
  ChatHistoryItem,
  ChatInfo,
  ChatRequest,
  ClaudeSettings,
  ClaudeSettingsUpdate,
  Playbook,
  PlaybookContext,
  ToolReply
} from '../../shared/claude'
import { claudeSettings, type ConfigStore } from '../config'
import { VaultError } from '../vault/names'
import type { Handle } from '../ipc'
import type { Vault } from '../vault/vault'
import { openInCode, assertCodeInstalled } from '../vscode'
import {
  claudeAgent,
  claudeComplete,
  claudeHandOff,
  claudeLearn,
  type Agent,
  type Complete,
  type HandOff,
  type Learn
} from './agent'
import { storedApiKey } from './cli'
import { courseOf, courseOfFile, type MemoryStore } from './memory'
import { Learner } from './learner'
import {
  afterDrawing,
  courseSources,
  editsOf,
  editsTaken,
  LEARNING_SKILLS,
  notLearned,
  type Part,
  type PlaybookStore
} from './playbook'
import type { Memory } from './prompt'
import { toHistory } from './events'
import { findSession, projectsDir } from './sessions'
import type { CallTool } from './tools'

/** UI tests load a scripted agent instead, so they never use the real Claude. */
interface AgentModule {
  agent: Agent
  complete?: Complete
  handOff?: HandOff
  learn?: Learn
  history?(sessionId: string): Promise<ChatHistoryItem[]>
}

async function loadAgent(): Promise<AgentModule> {
  const fake = process.env['MARGINALIA_FAKE_CLAUDE']
  if (fake) return import(/* @vite-ignore */ pathToFileURL(fake).href)
  return {
    agent: claudeAgent,
    complete: claudeComplete,
    handOff: claudeHandOff,
    learn: claudeLearn,
    // Without a folder: a chat continued in VS Code is saved with that folder's conversations.
    history: async (sessionId) => {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      return toHistory(await sdk.getSessionMessages(sessionId))
    }
  }
}

const STALE_SESSION = /no conversation found/i
const STOP_GRACE_MS = 1500
// The first look a while after start, then every few minutes; a look without new files only
// reads the folder.
const LEARN_FIRST_MS = 2 * 60_000
const LEARN_EVERY_MS = 5 * 60_000

/** The folder and the folders around it, nearest first. */
function foldersUp(folder: string): string[] {
  const parts = folder.split('/')
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('/'))
}

const handOffText = (folder: string): string =>
  `I am continuing this conversation in VS Code, in the folder "${folder}" of my notes, to ` +
  'work on the code there. Reply with one short line.'

export function registerClaude(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  config: ConfigStore,
  getVault: () => Vault | null,
  memory: MemoryStore,
  playbooks: PlaybookStore
): void {
  const agentModule = loadAgent()
  let running: AbortController | null = null
  // A chat and a learning run may both wait on the renderer; each call knows whose it is.
  const pendingTools = new Map<string, { resolve(reply: ToolReply): void; signal: AbortSignal }>()

  /** Answers the calls still waiting for a chat or run that ended or stopped. */
  function stopTools(signal: AbortSignal | undefined): void {
    for (const [id, call] of pendingTools) {
      if (call.signal !== signal) continue
      pendingTools.delete(id)
      call.resolve({ id, ok: false, text: 'Stopped' })
    }
  }

  function vault(): Vault {
    const v = getVault()
    if (!v) throw new VaultError('No vault is open')
    return v
  }

  ipcMain.on('claude:tool-reply', (_event, reply: ToolReply) => {
    pendingTools.get(reply.id)?.resolve(reply)
    pendingTools.delete(reply.id)
  })

  // The memory and the playbooks write about the course of the chat (or run) by default.
  async function remember(args: Record<string, unknown>, current: string): Promise<ToolReply> {
    const id = randomUUID()
    const course = args.about === 'me' ? '' : String(args.course ?? '').trim() || current
    if (args.about !== 'me' && !course) {
      return { id, ok: false, text: 'Name the course: no course is open' }
    }
    try {
      await memory.write(course, String(args.note ?? ''))
      return {
        id,
        ok: true,
        text: course ? `Saved the note about ${course}` : 'Saved the note about me'
      }
    } catch (err) {
      return { id, ok: false, text: (err as Error).message }
    }
  }

  /** What a skill knows of a course, and from which of its files. */
  async function playbookOf(skill: string, course: string): Promise<Playbook> {
    const [text, rules, state, sources] = await Promise.all([
      playbooks.read(skill, course, 'text'),
      playbooks.read(skill, course, 'rules'),
      playbooks.state(skill, course),
      course ? courseSources(vault(), course) : {}
    ])
    const pending = notLearned(sources, state.learned).map((p) => p.path)
    const total = Object.keys(sources).length
    return {
      text,
      rules,
      learning: state.learning,
      learned: total - pending.length,
      total,
      pending,
      log: state.log,
      error: state.error
    }
  }

  // My changes to its diagrams that a /uml message carries, taken in once Claude answered it
  // (a message that fails shows them again next time).
  const offers = new Map<string, { skill: string; course: string; seen: Record<string, string> }>()

  /**
   * The playbook for a /uml message, with my changes to its diagrams since it last saw them.
   * The first /uml in a course starts learning it.
   */
  async function playbookContext(skill: string, course: string): Promise<PlaybookContext> {
    const v = vault()
    let state = await playbooks.state(skill, course)
    const started = !state.learning
    if (started) {
      state = await playbooks.update(skill, course, (st) => ({ ...st, learning: true }))
      if (!learner.status()) startLearning(skill, course)
    }
    const [text, rules] = await Promise.all([
      playbooks.read(skill, course, 'text'),
      playbooks.read(skill, course, 'rules')
    ])
    const edits: PlaybookContext['edits'] = []
    const seen: Record<string, string> = {}
    for (const file of Object.keys(state.drawn)) {
      const current = await fs.readFile(v.resolve(file), 'utf8').catch(() => null)
      const changes = current === null ? null : editsOf(state, file, current)
      if (current !== null && changes?.length) {
        edits.push({ path: file, changes })
        seen[file] = current
      }
    }
    let offer: string | null = null
    if (edits.length) {
      for (const [id, o] of offers) if (o.skill === skill && o.course === course) offers.delete(id)
      offer = randomUUID()
      offers.set(offer, { skill, course, seen })
    }
    const pending = notLearned(await courseSources(v, course), state.learned).length
    return { text, rules, started, pending, edits, offer }
  }

  async function takeOffer(id: string): Promise<void> {
    const offer = offers.get(id)
    offers.delete(id)
    if (offer) await playbooks.update(offer.skill, offer.course, (st) => editsTaken(st, offer.seen))
  }

  async function updatePlaybook(
    args: Record<string, unknown>,
    current: string
  ): Promise<ToolReply> {
    const id = randomUUID()
    const skill = String(args.skill ?? 'uml')
    const course = String(args.course ?? '').trim() || current
    if (!course) return { id, ok: false, text: 'Name the course: no course is open' }
    try {
      await playbooks.write(skill, course, 'text', String(args.playbook ?? ''))
      return { id, ok: true, text: `Saved the /${skill} playbook for ${course}.` }
    } catch (err) {
      return { id, ok: false, text: (err as Error).message }
    }
  }

  async function addRule(args: Record<string, unknown>, current: string): Promise<ToolReply> {
    const id = randomUUID()
    const skill = String(args.skill ?? 'uml')
    const course = String(args.course ?? '').trim() || current
    if (!course) return { id, ok: false, text: 'Name the course: no course is open' }
    const rule = String(args.rule ?? '').trim()
    const replaces = args.replaces === undefined ? undefined : String(args.replaces)
    const from = args.from === undefined ? undefined : String(args.from)
    try {
      const { found } = await playbooks.addRule(skill, course, rule, replaces, from)
      const what = !found
        ? `There was no rule like "${replaces}"; ${rule ? 'added it as a new one' : 'nothing removed'}`
        : !rule
          ? 'Removed the rule'
          : replaces
            ? 'Replaced the rule'
            : 'Added the rule'
      return { id, ok: true, text: `${what} in the /${skill} playbook for ${course}.` }
    } catch (err) {
      return { id, ok: false, text: (err as Error).message }
    }
  }

  /** Keeps the canvases Claude draws in a course being learned, so my later changes show. */
  async function noteDrawing(drawn: NonNullable<ToolReply['drawn']>): Promise<void> {
    const course = courseOfFile(drawn.path)
    if (!course) return
    for (const skill of LEARNING_SKILLS) {
      if (!(await playbooks.state(skill, course)).learning) continue
      await playbooks.update(skill, course, (st) =>
        afterDrawing(st, drawn.path, drawn.before, drawn.after)
      )
    }
  }

  async function memoryFor(course: string): Promise<Memory> {
    const [me, courseNote] = await Promise.all([memory.read(''), course ? memory.read(course) : ''])
    return { me, course, courseNote }
  }

  /** The tools of a chat or a learning run: the memory and the playbooks live in main. */
  const toolsFor =
    (signal: AbortSignal, course: string): CallTool =>
    async (name, args) => {
      if (name === 'remember') return remember(args, course)
      if (name === 'update_playbook') return updatePlaybook(args, course)
      if (name === 'add_rule') return addRule(args, course)
      const reply = await rendererTool(name, args, signal)
      if (reply.ok && reply.drawn) await noteDrawing(reply.drawn).catch(console.error)
      return reply
    }

  // Every other tool runs in the renderer, where the open documents are.
  const rendererTool = (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ToolReply> =>
    new Promise((resolve) => {
      const id = randomUUID()
      const win = getWindow()
      if (!win || signal.aborted) {
        resolve({ id, ok: false, text: 'Stopped' })
        return
      }
      pendingTools.set(id, { resolve, signal })
      signal.addEventListener('abort', () => stopTools(signal), { once: true })
      win.webContents.send('claude:tool', { id, name, args })
    })

  const learner = new Learner({
    playbooks,
    vault: getVault,
    learn: async () => (await agentModule).learn,
    tools: toolsFor,
    input: async (course) => ({
      settings: (await config.read()).claude,
      memory: await memoryFor(course),
      apiKey: await storedApiKey(config)
    }),
    emit: (status) => getWindow()?.webContents.send('claude:learning', status)
  })
  setTimeout(() => void learner.tick(), LEARN_FIRST_MS)
  setInterval(() => void learner.tick(), LEARN_EVERY_MS)
  app.on('before-quit', () => learner.stop())

  /** Starts a run in the background; a run of another course has to finish first. */
  function startLearning(skill: string, course: string): void {
    const current = learner.status()
    if (current && current.course !== course) {
      throw new VaultError(`Still learning ${current.course}; try again when it is done`)
    }
    void learner.run(skill, course, false).catch((err) => console.error('[learn]', err))
  }

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
          memory: await memoryFor(courseOf(request.chat)),
          apiKey,
          callTool: toolsFor(controller.signal, courseOf(request.chat)),
          signal: controller.signal,
          onSession: (id) => void v.setChatSession(request.chat, id).catch(console.error)
        })
        const iterator = events[Symbol.asyncIterator]()
        // After Stop the SDK may stay blocked (a tool reply, a stuck process): give up on it.
        const gaveUp = new Promise<'gaveUp'>((resolve) => {
          const give = (): void => void setTimeout(() => resolve('gaveUp'), STOP_GRACE_MS)
          if (controller.signal.aborted) give()
          else controller.signal.addEventListener('abort', give, { once: true })
        })
        for (;;) {
          const next = await Promise.race([iterator.next(), gaveUp])
          if (next === 'gaveUp') {
            void iterator.return?.(undefined)?.catch(() => {})
            break
          }
          if (next.done) break
          const event = next.value
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
        if (request.offer && done && !done.error)
          await takeOffer(request.offer).catch(console.error)
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
      stopTools(controller.signal)
    }
  })

  // Several /claude requests may run at once, each in its own CLI process.
  const completing = new Map<string, AbortController>()

  handle('claude:complete', async (request: CompleteRequest) => {
    const v = vault()
    const { complete } = await agentModule
    if (!complete) throw new VaultError('Writing in notes is not available')
    const controller = new AbortController()
    completing.set(request.id, controller)
    try {
      const text = await complete({
        cwd: v.root,
        text: request.text,
        images: request.images,
        settings: (await config.read()).claude,
        memory: await memoryFor(courseOfFile(request.file ?? '')),
        apiKey: await storedApiKey(config),
        signal: controller.signal
      })
      if (controller.signal.aborted) throw new VaultError('Cancelled')
      return text
    } catch (err) {
      if (controller.signal.aborted) throw new VaultError('Cancelled')
      throw err
    } finally {
      completing.delete(request.id)
    }
  })

  handle('claude:cancelComplete', (id: string) => {
    completing.get(id)?.abort()
  })

  handle('claude:stop', () => {
    running?.abort()
  })

  handle('claude:history', async (chat: string) => {
    const v = vault()
    const id = await v.chatSession(chat)
    const { history } = await agentModule
    if (!id || !history) return []
    return history(id).catch((err) => {
      console.error('[claude:history]', err)
      return []
    })
  })

  handle('claude:chats', async (): Promise<ChatInfo[]> => {
    const sessions = await vault().chatSessions()
    const root = projectsDir()
    return Promise.all(
      Object.entries(sessions).map(async ([folder, id]) => {
        const dir = await findSession(root, id)
        const stat = dir ? await fs.stat(path.join(dir, `${id}.jsonl`)).catch(() => null) : null
        return { folder, updated: stat?.mtimeMs ?? null }
      })
    )
  })

  // The chat of the folder (or the lesson around it) goes along, and the app goes on with the
  // same copy, so what is said in VS Code is in the app's chat afterwards.
  handle('claude:openInCode', async (folder: string): Promise<string | null> => {
    const v = vault()
    const dir = v.resolve(folder)
    assertCodeInstalled()
    const { handOff } = await agentModule
    for (const chat of foldersUp(folder)) {
      const sessionId = await v.chatSession(chat)
      if (!sessionId || !handOff) continue
      if (running) throw new VaultError('Wait until Claude has answered')
      running = new AbortController()
      try {
        const copy = await handOff({
          cwd: dir,
          sessionId,
          text: handOffText(folder),
          title: `${folder.split('/').pop()} (from Marginalia)`,
          apiKey: await storedApiKey(config)
        })
        await v.setChatSession(chat, copy)
        await openInCode(dir, copy)
        return chat
      } finally {
        running = null
      }
    }
    await openInCode(dir)
    return null
  })

  handle('claude:memory', () => memory.all())
  handle('claude:setMemory', (course: string, note: string) => memory.write(course, note))
  handle('claude:playbook', (skill: string, course: string) => playbookOf(skill, course))
  handle('claude:setPlaybook', (skill: string, course: string, part: Part, text: string) =>
    playbooks.write(skill, course, part === 'rules' ? 'rules' : 'text', text)
  )
  handle('claude:playbookContext', (skill: string, course: string) =>
    playbookContext(skill, course)
  )
  handle('claude:setLearning', async (skill: string, course: string, on: boolean) => {
    await playbooks.update(skill, course, (st) => ({ ...st, learning: on }))
    if (on) startLearning(skill, course)
    else if (learner.status()?.course === course) learner.stop()
  })
  handle('claude:learnNow', (skill: string, course: string) => startLearning(skill, course))
  handle('claude:stopLearning', () => learner.stop())
  handle('claude:learningStatus', () => learner.status())

  handle('claude:newChat', (chat: string) => vault().setChatSession(chat, null))
}
