import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EFFORTS, MODELS, type EffortChoice, type ModelChoice } from '../../../shared/claude'
import type { VaultNode } from '../../../shared/types'
import { ContextMenu } from '../components/ContextMenu'
import { Icon, type IconName } from '../components/Icon'
import { resolveLink } from '../editor/links'
import { RenderedHtml } from '../components/RenderedHtml'
import { renderChatMarkdown } from '../lib/markdown'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { chatOf, useChat, type Message, type Part } from './chat'
import { currentChips } from './context'
import { selectedText } from './selectedText'
import { SKILLS } from './skills'
import { TerminalView } from './TerminalView'

const HEIGHT_KEY = 'claude-height'
const EMPTY: Message[] = []

const QUICK_ACTIONS = [
  { label: 'Explain this slide', prompt: 'Explain this slide.' },
  {
    label: 'Add this slide to my summary',
    prompt:
      'Add the key points of this slide to my summary, under the most relevant heading. ' +
      'Keep it short and add a link to the slide.'
  },
  {
    label: 'Write this as LaTeX',
    prompt: 'Write the formula on this slide (or the text I selected) as LaTeX.'
  },
  {
    label: 'Quiz me on this section',
    prompt:
      'Quiz me on this lesson: ask one question at a time, wait for my answer, then tell me ' +
      'what was right or missing.'
  }
]

const MODEL_LABELS: Record<ModelChoice, string> = {
  default: 'Default',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku'
}

const EFFORT_LABELS: Record<EffortChoice, string> = {
  default: 'Default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

function loadHeight(): number {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY))
    return value >= 160 ? value : 300
  } catch {
    return 300
  }
}

export function ClaudePanel(): React.JSX.Element {
  const chat = useApp(chatOf)
  const vaultName = useApp((s) => s.vault?.name ?? '')
  const messages = useChat((s) => s.chats[chat]?.messages ?? EMPTY)
  const running = useChat((s) => s.running)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [height, setHeight] = useState(loadHeight)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  // Mounted on first use and then kept, so switching tabs does not clear its screen.
  const [terminalUsed, setTerminalUsed] = useState(false)

  useEffect(() => {
    void useChat.getState().load(chat)
  }, [chat])

  const startResize = (e: React.PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startHeight = height
    let latest = height
    const onMove = (ev: PointerEvent): void => {
      latest = Math.round(
        Math.min(window.innerHeight * 0.75, Math.max(160, startHeight + startY - ev.clientY))
      )
      setHeight(latest)
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      try {
        localStorage.setItem(HEIGHT_KEY, String(latest))
      } catch {
        // ignore
      }
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp, { once: true })
  }

  const title = chat ? chat.split('/').pop() : vaultName

  return (
    <section className="claude-panel" style={{ height }} aria-label="Claude">
      <div className="claude-resize" role="separator" onPointerDown={startResize} />
      <header className="claude-header">
        <span className="claude-title">Claude</span>
        <div className="claude-tabs" role="tablist">
          {(['chat', 'terminal'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'text-button pressed' : 'text-button'}
              onClick={() => {
                setTab(t)
                if (t === 'terminal') setTerminalUsed(true)
              }}
            >
              {t === 'chat' ? 'Chat' : 'Terminal'}
            </button>
          ))}
        </div>
        {tab === 'chat' && (
          <span className="muted claude-chat-name" title={chat || vaultName}>
            {title}
          </span>
        )}
        <span className="spacer" />
        {tab === 'chat' && (
          <button
            className="text-button"
            disabled={running === chat}
            onClick={() => void useChat.getState().newChat(chat)}
          >
            New chat
          </button>
        )}
        <button
          className={settingsOpen ? 'icon-button pressed' : 'icon-button'}
          title="Claude settings"
          aria-label="Claude settings"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Icon name="settings" />
        </button>
        <button
          className="icon-button"
          title={`Close (${useApp.getState().settings.hotkeys.claude})`}
          aria-label="Close"
          onClick={() => useChat.getState().setOpen(false)}
        >
          <Icon name="close" />
        </button>
      </header>
      {settingsOpen && <SettingsView onDone={() => setSettingsOpen(false)} />}
      {!settingsOpen && tab === 'chat' && (
        <>
          <MessageList messages={messages} running={running === chat} />
          <ChatInput chat={chat} busy={running !== null} />
        </>
      )}
      {terminalUsed && (
        <div className="claude-terminal-tab" hidden={settingsOpen || tab !== 'terminal'}>
          <TerminalView />
        </div>
      )}
    </section>
  )
}

function MessageList({
  messages,
  running
}: {
  messages: Message[]
  running: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)

  // Follow the answer as it streams in, unless I scrolled up to read something.
  useLayoutEffect(() => {
    const el = ref.current!
    if (pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    const copy = target.closest('.copy-code')
    if (copy) {
      const code = copy.parentElement?.querySelector('pre')?.textContent ?? ''
      void navigator.clipboard.writeText(code)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1500)
      return
    }
    const link = target.closest('a')
    if (!link) return
    e.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      window.open(href)
      return
    }
    // Claude links slides by vault path: [slide 12](ML/B2/slides.pdf#page=12).
    const target_ = resolveLink('_.md', href)
    const { nodes, openFile } = useApp.getState()
    if (target_ && findNode(nodes, target_.path)) openFile(target_.path, target_.page ?? undefined)
  }

  /** Text selected in the messages, or "" when the selection is elsewhere or empty. */
  const selected = (): string => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !ref.current?.contains(selection.anchorNode)) {
      return ''
    }
    return selectedText(selection.getRangeAt(0))
  }

  // Selected text goes along with the next question as a chip, since clicking into the input
  // ends the selection. Ctrl+C or the right-click menu copies it.
  const onMouseUp = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    useChat.getState().quote(selected() || null)
  }

  const onCopy = (e: React.ClipboardEvent): void => {
    const text = selected()
    if (!text) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', text)
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    const text = selected()
    if (!text) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, text })
  }

  return (
    <div
      className="claude-messages"
      ref={ref}
      onClick={onClick}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      onCopy={onCopy}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {messages.length === 0 && (
        <p className="muted claude-empty">
          Ask about the slide or your summary. What you are looking at is sent along automatically;
          remove a chip below to leave it out.
        </p>
      )}
      {messages.map((m, i) => (
        <MessageView key={m.id} message={m} streaming={running && i === messages.length - 1} />
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Copy',
              hint: 'Ctrl+C',
              onSelect: () => void navigator.clipboard.writeText(menu.text)
            },
            {
              label: 'Ask about this',
              onSelect: () => {
                useChat.getState().quote(menu.text)
                document.querySelector<HTMLTextAreaElement>('.claude-input textarea')?.focus()
              }
            }
          ]}
        />
      )}
    </div>
  )
}

const MessageView = memo(function MessageView({
  message,
  streaming
}: {
  message: Message
  streaming: boolean
}): React.JSX.Element {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('')
    return (
      <div className="claude-message user">
        <div className="claude-question">{text}</div>
        {!!message.context?.length && (
          <div className="claude-sent-context muted">{message.context.join(' · ')}</div>
        )}
      </div>
    )
  }
  return (
    <div className="claude-message assistant">
      {message.parts.map((part, i) => (
        <PartView key={i} part={part} />
      ))}
      {streaming && !message.parts.length && <p className="muted">Thinking...</p>}
      {message.error && <p className="claude-error">{message.error}</p>}
    </div>
  )
})

function PartView({ part }: { part: Part }): React.JSX.Element {
  const html = useMemo(() => (part.kind === 'text' ? renderChatMarkdown(part.text) : ''), [part])
  if (part.kind === 'text') {
    return <RenderedHtml className="claude-answer" html={html} surface="app" delay={400} />
  }
  if (part.kind === 'tool') return <div className="claude-tool muted">{part.label}</div>
  return (
    <div className={`claude-proposal ${part.status}`}>
      {part.status === 'pending' && part.canReveal ? (
        <button
          className="claude-proposal-label"
          title="Show this change"
          onClick={() => void useChat.getState().reveal(part.id)}
        >
          {part.label}
        </button>
      ) : (
        <span className="claude-proposal-label">{part.label}</span>
      )}
      {part.status === 'pending' ? (
        <>
          <button
            className="button primary"
            onClick={() => useChat.getState().decide(part.id, true)}
          >
            Accept
          </button>
          <button
            className="button"
            title="Accept this and every other change in this answer"
            onClick={() => useChat.getState().acceptAll()}
          >
            Accept all
          </button>
          <button className="button" onClick={() => useChat.getState().decide(part.id, false)}>
            Reject
          </button>
        </>
      ) : (
        <span className="muted">{part.status === 'accepted' ? 'Accepted' : 'Rejected'}</span>
      )}
    </div>
  )
}

function flatten(nodes: VaultNode[], out: VaultNode[] = []): VaultNode[] {
  for (const node of nodes) {
    if (node.children) flatten(node.children, out)
    else out.push(node)
  }
  return out
}

interface Option {
  key: string
  icon: IconName
  text: string
  detail?: string
  pick(): void
}

function ChatInput({ chat, busy }: { chat: string; busy: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  // @ picks a file to send along, / at the start a skill.
  const [picker, setPicker] = useState<{ kind: '@' | '/'; query: string; index: number } | null>(
    null
  )
  const ref = useRef<HTMLTextAreaElement>(null)
  const nodes = useApp((s) => s.nodes)
  // Chips follow what is on screen.
  useApp((s) => s.pdfView)
  useApp((s) => s.pdfSelection)
  useApp((s) => s.noteCursor)
  const attached = useChat((s) => s.attached)
  const quoted = useChat((s) => s.quoted)
  const removed = useChat((s) => s.removedChips)
  const chips = currentChips(attached, quoted).filter((c) => !removed.includes(c.id))

  const matches = useMemo((): Option[] => {
    if (!picker) return []
    const q = picker.query.toLowerCase()
    if (picker.kind === '/') {
      return SKILLS.filter((skill) => skill.name.startsWith(q)).map((skill) => ({
        key: skill.name,
        icon: 'chat',
        text: `/${skill.name}`,
        detail: skill.label,
        pick: () => {
          setText(`/${skill.name} `)
          setPicker(null)
        }
      }))
    }
    return flatten(nodes)
      .filter((n) => n.path.toLowerCase().includes(q))
      .slice(0, 8)
      .map((node) => ({
        key: node.path,
        icon: node.kind === 'pdf' ? 'pdf' : 'page',
        text: node.path,
        pick: () => pick(node)
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, nodes])

  const grow = (): void => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const send = (question: string): void => {
    if (busy || !question.trim()) return
    void useChat.getState().send(chat, question)
    setText('')
    setPicker(null)
    requestAnimationFrame(grow)
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    grow()
    const before = e.target.value.slice(0, e.target.selectionStart)
    const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
    const slash = /^\/([a-z-]*)$/i.exec(before)
    if (at) setPicker({ kind: '@', query: at[1], index: 0 })
    else if (slash) setPicker({ kind: '/', query: slash[1], index: 0 })
    else setPicker(null)
  }

  const pick = (node: VaultNode): void => {
    const el = ref.current!
    const before = text.slice(0, el.selectionStart).replace(/@[^\s@]*$/, '')
    setText(before + text.slice(el.selectionStart))
    setPicker(null)
    useChat.getState().attach(node.path)
    el.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (picker && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setPicker({ ...picker, index: (picker.index + step + matches.length) % matches.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        matches[picker.index].pick()
        return
      }
    }
    if (e.key === 'Escape' && picker) {
      e.preventDefault()
      setPicker(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(text)
    }
  }

  return (
    <div className="claude-compose">
      <div className="claude-quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="text-button"
            disabled={busy}
            onClick={() => send(action.prompt)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="claude-chips" aria-label="Sent with your message">
          {chips.map((chip) => (
            <span key={chip.id} className="chip" title={chip.title}>
              {chip.label}
              <button
                className="chip-remove"
                aria-label={`Leave out ${chip.label}`}
                onClick={() => useChat.getState().removeChip(chip.id)}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="claude-input">
        {picker && matches.length > 0 && (
          <ul className="claude-picker menu" role="listbox">
            {matches.map((option, i) => (
              <li
                key={option.key}
                role="option"
                aria-selected={i === picker.index}
                className={i === picker.index ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  option.pick()
                }}
              >
                <Icon name={option.icon} />
                <span>{option.text}</span>
                {option.detail && <span className="muted">{option.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Ask Claude, @ to add a file, / for skills"
          aria-label="Message to Claude"
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => setPicker(null)}
        />
        {busy ? (
          <button
            className="icon-button"
            title="Stop"
            aria-label="Stop"
            onClick={() => useChat.getState().stop()}
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            className="icon-button"
            title="Send (Enter)"
            aria-label="Send"
            disabled={!text.trim()}
            onClick={() => send(text)}
          >
            <Icon name="send" />
          </button>
        )}
      </div>
    </div>
  )
}

/** What Claude remembers about me and per course; it writes these itself, I can edit them. */
function MemoryField(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const activeFile = useApp((s) => s.activeFile)
  const [notes, setNotes] = useState<Record<string, string> | null>(null)
  const [course, setCourse] = useState('')
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    void window.api.claude.memory().then((loaded) => {
      setNotes(loaded)
      // Start at the course on screen when it has a note.
      const current = activeFile?.includes('/') ? activeFile.split('/')[0] : ''
      if (current && loaded[current]) setCourse(current)
    })
    // Only when the settings open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const notebooks = nodes.filter((n) => n.kind === 'notebook').map((n) => n.name)
  const courses = [...new Set([...notebooks, ...Object.keys(notes ?? {})])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const saved = notes?.[course] ?? ''

  return (
    <div className="field">
      <span>Memory</span>
      <div className="claude-instructions">
        <select
          aria-label="Memory about"
          value={course}
          onChange={(e) => {
            setDraft(null)
            setCourse(e.target.value)
          }}
        >
          <option value="">About me</option>
          {courses.map((c) => (
            <option key={c} value={c}>
              {notes?.[c] ? c : `${c} (empty)`}
            </option>
          ))}
        </select>
        <textarea
          aria-label="Memory"
          rows={6}
          value={draft ?? saved}
          disabled={!notes}
          placeholder="Nothing yet. Claude adds what it learns about how you like to work."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && draft !== saved) {
              const text = draft.trim()
              void window.api.claude
                .setMemory(course, text)
                .then(() => setNotes((n) => ({ ...n, [course]: text })))
                .catch((err: Error) => useApp.getState().showError(err.message))
            }
            setDraft(null)
          }}
        />
        <p className="muted">
          Claude keeps these notes itself as it learns how you like things, and reads them in the
          chat, /claude and the terminal. Only on this computer, not in your vault.
        </p>
      </div>
    </div>
  )
}

function SettingsView({ onDone }: { onDone(): void }): React.JSX.Element {
  const settings = useChat((s) => s.settings)
  const save = useChat((s) => s.saveSettings)
  const [key, setKey] = useState('')
  // Edited text until the field loses focus; null shows what is saved.
  const [instructions, setInstructions] = useState<string | null>(null)

  if (!settings) return <p className="muted claude-empty">Loading settings...</p>
  return (
    <div className="claude-settings">
      <label className="field">
        <span>Model</span>
        <select
          value={settings.model}
          onChange={(e) => void save({ model: e.target.value as ModelChoice })}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Effort</span>
        <select
          value={settings.effort}
          onChange={(e) => void save({ effort: e.target.value as EffortChoice })}
        >
          {EFFORTS.map((m) => (
            <option key={m} value={m}>
              {EFFORT_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.askBeforeEditing}
          onChange={(e) => void save({ askBeforeEditing: e.target.checked })}
        />
        Ask before Claude changes my notes
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.webSearch}
          onChange={(e) => void save({ webSearch: e.target.checked })}
        />
        Allow web search
      </label>
      <div className="field">
        <span>Instructions</span>
        <div className="claude-instructions">
          <textarea
            aria-label="Instructions for Claude"
            rows={4}
            value={instructions ?? settings.instructions}
            placeholder="Things Claude should always know, like what your folder colours mean"
            onChange={(e) => setInstructions(e.target.value)}
            onBlur={() => {
              if (instructions !== null && instructions !== settings.instructions) {
                void save({ instructions })
              }
              setInstructions(null)
            }}
          />
          <p className="muted">
            Kept on this computer and added to the chat, /claude and the terminal (new sessions).
          </p>
        </div>
      </div>
      <MemoryField />
      <div className="field">
        <span>Login</span>
        <div className="claude-login">
          <p className="muted">
            {settings.hasApiKey
              ? 'Using the API key below, billed per use on the Claude Console.'
              : 'Using your Claude Code login on this computer, within your plan’s usage limits.'}
          </p>
          <div className="claude-key">
            <input
              type="password"
              value={key}
              placeholder={settings.hasApiKey ? 'Replace the API key' : 'API key (optional)'}
              aria-label="API key"
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="button"
              disabled={!key.trim()}
              onClick={() => {
                void save({ apiKey: key })
                setKey('')
              }}
            >
              Save key
            </button>
            {settings.hasApiKey && (
              <button className="button" onClick={() => void save({ apiKey: null })}>
                Remove key
              </button>
            )}
          </div>
        </div>
      </div>
      <div>
        <button className="button primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
