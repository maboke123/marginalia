/** Every action with a hotkey, its default and where it works (SPEC section 5). */
export const HOTKEY_ACTIONS = [
  { id: 'claude', label: 'Claude panel', key: 'Ctrl+L', scope: 'global' },
  { id: 'lecture', label: 'Lecture mode', key: 'Ctrl+Shift+M', scope: 'global' },
  { id: 'importPdf', label: 'Import PDF', key: 'Ctrl+Shift+I', scope: 'global' },
  { id: 'slideLink', label: 'Insert current slide link', key: 'Ctrl+Shift+L', scope: 'global' },
  { id: 'snapshot', label: 'Slide snapshot', key: 'Ctrl+Shift+S', scope: 'global' },
  { id: 'switcher', label: 'Quick switcher', key: 'Ctrl+P', scope: 'global' },
  { id: 'search', label: 'Search everything', key: 'Ctrl+Shift+F', scope: 'global' },
  { id: 'todo', label: 'Todo note', key: 'Ctrl+Shift+T', scope: 'global' },
  { id: 'settings', label: 'Settings', key: 'Ctrl+,', scope: 'global' },
  { id: 'sidebar', label: 'Show or hide the sidebar', key: 'Ctrl+\\', scope: 'global' },
  { id: 'close', label: 'Close the open files', key: 'Ctrl+W', scope: 'global' },
  { id: 'fullScreen', label: 'Full screen', key: 'F11', scope: 'global' },
  {
    id: 'record',
    label: 'Record the lecture (start or stop)',
    key: 'Ctrl+Shift+R',
    scope: 'global'
  },
  { id: 'select', label: 'Select and move', key: 'V', scope: 'slides' },
  { id: 'pen', label: 'Pen', key: 'P', scope: 'slides' },
  {
    id: 'highlighter',
    label: 'Highlighter (and highlight selected text)',
    key: 'H',
    scope: 'slides'
  },
  { id: 'eraser', label: 'Eraser', key: 'E', scope: 'slides' },
  { id: 'text', label: 'Text box', key: 'T', scope: 'slides' }
] as const

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]['id']
export type Hotkeys = Record<HotkeyAction, string>

export const DEFAULT_HOTKEYS = Object.fromEntries(
  HOTKEY_ACTIONS.map((a) => [a.id, a.key])
) as Hotkeys

const NAMED: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space'
}

/**
 * "Ctrl+Shift+M" for a key press. A letter is the one the keyboard layout types (M on AZERTY
 * sits where QWERTY has ;). Other keys go by their physical place, so they do not depend on
 * the layout's shifted characters. Null for a lone modifier or a key that cannot be a hotkey.
 */
export function comboOf(e: {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  code: string
  key: string
}): string | null {
  let key: string | null = null
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase()
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code
  else key = NAMED[e.code] ?? null
  if (!key) return null
  const mods = [
    e.ctrlKey || e.metaKey ? 'Ctrl' : '',
    e.shiftKey ? 'Shift' : '',
    e.altKey ? 'Alt' : ''
  ]
  return [...mods.filter(Boolean), key].join('+')
}

/** Why a combination cannot be used for an action, or null when it can. */
export function hotkeyProblem(action: HotkeyAction, combo: string): string | null {
  const scope = HOTKEY_ACTIONS.find((a) => a.id === action)!.scope
  const modified = /^(Ctrl|Alt)\+/.test(combo) || /^(Shift\+)?F\d+$/.test(combo)
  if (scope === 'global' && !modified) {
    return 'Needs Ctrl or Alt (or a function key), so typing still works'
  }
  if (scope === 'slides' && combo.includes('+')) return 'Use a single key for slide tools'
  return null
}

/** User hotkeys over the defaults, dropping anything malformed. */
export function hotkeysFrom(raw: unknown): Hotkeys {
  const out = { ...DEFAULT_HOTKEYS }
  if (raw && typeof raw === 'object') {
    for (const action of HOTKEY_ACTIONS) {
      const value = (raw as Record<string, unknown>)[action.id]
      if (typeof value === 'string' && !hotkeyProblem(action.id, value)) out[action.id] = value
    }
  }
  return out
}
