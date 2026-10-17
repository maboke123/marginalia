import { create } from 'zustand'
import type { ChatEvent, ClaudeSettings, ClaudeSettingsUpdate } from '../../../shared/claude'
import { findNode, isFolder, parentOf } from '../lib/tree'
import { useApp } from '../store'
import { buildPacket, currentChips } from './context'

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; label: string }
  | {
      kind: 'proposal'
      id: string
      label: string
      status: 'pending' | 'accepted' | 'rejected'
      canReveal?: boolean
    }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  parts: Part[]
  /** Labels of the context chips sent with a question. */
  context?: string[]
  error?: string
}

interface Chat {
  messages: Message[]
  loaded: boolean
  /** The slide page whose image was sent last, so the same image is not sent again. */
  lastImage: string | null
}

const EMPTY_CHAT: Chat = { messages: [], loaded: false, lastImage: null }

interface ChatState {
  open: boolean
  chats: Record<string, Chat>
  /** The chat that is waiting for an answer. */
  running: string | null
  settings: ClaudeSettings | null
  /** Chips taken out of the next message. */
  removedChips: string[]
  /** Files added with @ for the next message. */
  attached: string[]
  /** Text I selected in the chat, sent along with the next message. */
  quoted: string | null
  /** The chat whose running answer may edit without asking ("Accept all"). */
  acceptingAll: string | null

  setOpen(open: boolean): void
  load(chat: string): Promise<void>
  send(chat: string, question: string): Promise<void>
  stop(): void
  newChat(chat: string): Promise<void>
  /** Opens a folder in VS Code, taking its chat along. */
  openInCode(folder: string): Promise<void>
  removeChip(id: string): void
  attach(path: string): void
  quote(text: string | null): void
  loadSettings(): Promise<void>
  saveSettings(update: ClaudeSettingsUpdate): Promise<void>
  /**
   * Asks me to accept an edit. `show` draws the preview and returns a function that removes
   * it. `reveal` opens the file at the change, for when I click the proposal in the chat.
   * Resolves true at once when "ask before editing" is off.
   */
  confirm(
    label: string,
    show: (decide: (accept: boolean) => void) => () => void,
    reveal?: () => Promise<void>
  ): Promise<boolean>
  decide(id: string, accept: boolean): void
  /** Opens the file of a waiting change and shows its preview again. */
  reveal(id: string): Promise<void>
  /** Accepts what is waiting and every other edit until this answer is done. */
  acceptAll(): void
}

/** The chat for what I am looking at: one conversation per section (lesson folder). */
export function chatOf(state: ReturnType<typeof useApp.getState>): string {
  const { lectureMode, slidesFile, summaryFile, activeFile, selected, nodes } = state
  const file = lectureMode ? (slidesFile ?? summaryFile) : activeFile
  if (file) return parentOf(file)
  const node = selected ? findNode(nodes, selected) : null
  if (node) return isFolder(node) ? node.path : parentOf(node.path)
  return ''
}

const fileName = (path: unknown): string =>
  String(path ?? '')
    .split(/[\\/]/)
    .pop() ?? ''

function describeTool(name: string, input: Record<string, unknown>): string {
  const file = fileName(input.file ?? input.file_path)
  const page = input.page ? ` p.${input.page}` : ''
  switch (name) {
    case 'get_current_view':
      return 'Looked at what is on screen'
    case 'read_pdf_page':
      return `Read ${file}${page}`
    case 'read_pdf_text':
      return `Read the text of ${file}`
    case 'create_note':
      return `Making the note ${input.name}.md`
    case 'read_summary':
      return input.heading ? `Read ${file} › ${input.heading}` : `Read ${file}`
    case 'insert_into_summary':
      return input.heading ? `Writing in ${file} under ${input.heading}` : `Writing in ${file}`
    case 'replace_in_summary':
      return `Changing text in ${file}`
    case 'add_text_annotation':
      return `Adding a note to ${file}${page}`
    case 'add_highlight':
      return `Highlighting on ${file}${page}`
    case 'list_annotations':
      return `Looked at the annotations on ${file}${page}`
    case 'edit_annotation':
      return `Changing an annotation on ${file}${page}`
    case 'delete_annotations':
      return `Removing annotations from ${file}${page}`
    case 'add_blank_page':
      return `Adding a blank page to ${file} after p.${input.after_page}`
    case 'add_drawing':
      return `Drawing on ${file}${page}`
    case 'screenshot':
      return file ? `Looked at ${file}${page}` : 'Looked at the app'
    case 'goto':
      return `Opened ${file}${page}`
    case 'remember':
      return input.about === 'me'
        ? 'Updated what it remembers about you'
        : `Updated what it remembers about ${input.course || 'this course'}`
    case 'Read':
      return `Read ${file}`
    case 'Glob':
      return `Looked for files: ${input.pattern}`
    case 'Grep':
      return `Searched notes for "${input.pattern}"`
    case 'WebSearch':
      return `Searched the web: ${input.query}`
    case 'WebFetch':
      return `Opened ${input.url}`
    default:
      return name
  }
}

/** Moves the keyboard to the chat input (Ctrl+L). */
export function focusChatInput(): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('.claude-input textarea')?.focus()
  )
}

const decisions = new Map<string, (accept: boolean) => void>()
const reveals = new Map<string, () => Promise<void>>()
let nextId = 0
const id = (): string => `m${++nextId}`

export const useChat = create<ChatState>((set, get) => {
  function update(chat: string, fn: (c: Chat) => Chat): void {
    set((s) => ({ chats: { ...s.chats, [chat]: fn(s.chats[chat] ?? EMPTY_CHAT) } }))
  }

  /** Changes the answer being written, the last message of the running chat. */
  function updateAnswer(chat: string, fn: (m: Message) => Message): void {
    update(chat, (c) => {
      const last = c.messages[c.messages.length - 1]
      if (last?.role !== 'assistant') return c
      return { ...c, messages: [...c.messages.slice(0, -1), fn(last)] }
    })
  }

  // Text arrives in many small pieces; render at most once per frame.
  let buffered = ''
  let bufferedChat = ''
  let frame = 0
  function flushText(): void {
    cancelAnimationFrame(frame)
    frame = 0
    if (!buffered) return
    const text = buffered
    buffered = ''
    updateAnswer(bufferedChat, (m) => {
      const last = m.parts[m.parts.length - 1]
      const parts: Part[] =
        last?.kind === 'text'
          ? [...m.parts.slice(0, -1), { kind: 'text', text: last.text + text }]
          : [...m.parts, { kind: 'text', text }]
      return { ...m, parts }
    })
  }

  function onEvent(chat: string, event: ChatEvent): void {
    if (event.type === 'text') {
      buffered += event.text
      bufferedChat = chat
      if (!frame) frame = requestAnimationFrame(flushText)
      return
    }
    flushText()
    if (event.type === 'tool') {
      const label = describeTool(event.name, event.input)
      updateAnswer(chat, (m) => ({ ...m, parts: [...m.parts, { kind: 'tool', label }] }))
      return
    }
    // done
    for (const decide of [...decisions.values()]) decide(false)
    updateAnswer(chat, (m) => ({ ...m, ...(event.error ? { error: event.error } : {}) }))
    set({ running: null, acceptingAll: null })
  }

  window.api.claude.onEvent(onEvent)

  // Chats that went along to VS Code: what was said there shows when I come back.
  const inCode = new Set<string>()
  window.addEventListener('focus', () => {
    for (const chat of inCode) {
      if (get().running === chat || !get().chats[chat]?.loaded) continue
      update(chat, () => EMPTY_CHAT)
      void get().load(chat)
    }
  })

  return {
    open: false,
    chats: {},
    running: null,
    settings: null,
    removedChips: [],
    attached: [],
    quoted: null,
    acceptingAll: null,

    setOpen(open) {
      set({ open })
      if (open && !get().settings) void get().loadSettings()
    },

    async load(chat) {
      if (get().chats[chat]?.loaded) return
      update(chat, (c) => ({ ...c, loaded: true }))
      const history = await window.api.claude.history(chat).catch(() => [])
      update(chat, (c) => ({
        ...c,
        // Messages sent while the history was loading go after it.
        messages: [
          ...history.map((h): Message => ({
            id: id(),
            role: h.role,
            parts: [{ kind: 'text', text: h.text }]
          })),
          ...c.messages
        ]
      }))
    },

    async send(chat, question) {
      if (get().running || !question.trim()) return
      const { removedChips, attached, quoted } = get()
      const chips = currentChips(attached, quoted).filter((c) => !removedChips.includes(c.id))
      update(chat, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id: id(),
            role: 'user',
            parts: [{ kind: 'text', text: question.trim() }],
            context: chips.map((c) => c.label)
          },
          { id: id(), role: 'assistant', parts: [] }
        ]
      }))
      set({ running: chat, removedChips: [], attached: [], quoted: null })
      try {
        const lastImage = get().chats[chat]?.lastImage ?? null
        const packet = await buildPacket(chat, chips, question.trim(), lastImage)
        if (packet.imageKey) update(chat, (c) => ({ ...c, lastImage: packet.imageKey }))
        await window.api.claude.send({ chat, text: packet.text, images: packet.images })
      } catch (err) {
        if (get().running === chat) onEvent(chat, { type: 'done', error: (err as Error).message })
      }
    },

    stop() {
      for (const decide of [...decisions.values()]) decide(false)
      void window.api.claude.stop()
    },

    async newChat(chat) {
      if (get().running === chat) return
      await window.api.claude.newChat(chat)
      update(chat, () => ({ ...EMPTY_CHAT, loaded: true }))
    },

    async openInCode(folder) {
      const app = useApp.getState()
      app.showNotice('Opening in VS Code...')
      try {
        const chat = await window.api.claude.openInCode(folder)
        if (chat !== null) inCode.add(chat)
        app.showNotice(chat !== null ? 'Opened in VS Code, with the chat' : null)
      } catch (err) {
        app.showError(err instanceof Error ? err.message : String(err))
      }
    },

    removeChip: (chipId) => set((s) => ({ removedChips: [...s.removedChips, chipId] })),

    attach(path) {
      const { attached, removedChips } = get()
      set({
        attached: attached.includes(path) ? attached : [...attached, path],
        removedChips: removedChips.filter((c) => c !== `file:${path}`)
      })
    },

    quote(text) {
      set((s) => ({
        quoted: text,
        removedChips: s.removedChips.filter((c) => c !== 'chat-selection')
      }))
    },

    async loadSettings() {
      const settings = await window.api.claude.settings().catch(() => null)
      if (settings) set({ settings })
    },

    async saveSettings(change) {
      try {
        set({ settings: await window.api.claude.setSettings(change) })
      } catch (err) {
        useApp.getState().showError((err as Error).message)
      }
    },

    confirm(label, show, reveal) {
      const chat = get().running
      if (get().settings?.askBeforeEditing === false) return Promise.resolve(true)
      if (chat !== null && get().acceptingAll === chat) return Promise.resolve(true)
      const proposal = id()
      return new Promise((resolve) => {
        let hide = (): void => {}
        const decide = (accept: boolean): void => {
          if (!decisions.has(proposal)) return
          decisions.delete(proposal)
          reveals.delete(proposal)
          hide()
          if (chat !== null) {
            updateAnswer(chat, (m) => ({
              ...m,
              parts: m.parts.map((p) =>
                p.kind === 'proposal' && p.id === proposal
                  ? { ...p, status: accept ? 'accepted' : 'rejected' }
                  : p
              )
            }))
          }
          resolve(accept)
        }
        decisions.set(proposal, decide)
        if (reveal) {
          reveals.set(proposal, async () => {
            await reveal()
            // I may have decided while the file opened.
            if (!decisions.has(proposal)) return
            hide()
            hide = show(decide)
          })
        }
        if (chat !== null) {
          updateAnswer(chat, (m) => ({
            ...m,
            parts: [
              ...m.parts,
              { kind: 'proposal', id: proposal, label, status: 'pending', canReveal: !!reveal }
            ]
          }))
        }
        hide = show(decide)
      })
    },

    decide: (proposal, accept) => decisions.get(proposal)?.(accept),

    async reveal(proposal) {
      try {
        await reveals.get(proposal)?.()
      } catch (err) {
        useApp.getState().showError((err as Error).message)
      }
    },

    acceptAll() {
      set({ acceptingAll: get().running })
      for (const decide of [...decisions.values()]) decide(true)
    }
  }
})
