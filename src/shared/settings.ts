import { DEFAULT_HOTKEYS, hotkeysFrom, type Hotkeys } from './hotkeys'

export type Theme = 'system' | 'light' | 'dark'

/** App-wide preferences, stored in config.json in the user's profile, not in the vault. */
export interface AppSettings {
  theme: Theme
  /** Margin next to each slide, as a fraction of the page width, for PDFs not annotated yet. */
  marginWidth: number
  penColors: string[]
  highlightColors: string[]
  hotkeys: Hotkeys
}

export const MARGIN_WIDTHS = [
  { name: 'Narrow', value: 0.3 },
  { name: 'Normal', value: 0.6 },
  { name: 'Wide', value: 1 }
]

// Ink colours are stored in the sidecar as hex, so they are data rather than theme tokens.
// They stay the same in dark mode because the slides themselves are always white.
export const DEFAULT_PEN_COLORS = ['#1f2328', '#1f6feb', '#cf222e', '#1a7f37', '#bc4c00']
export const DEFAULT_HIGHLIGHT_COLORS = ['#ffd33d', '#7ee787', '#79c0ff', '#ff9bce', '#ffa657']

const COLOR_NAMES: Record<string, string> = {
  '#1f2328': 'Black',
  '#1f6feb': 'Blue',
  '#cf222e': 'Red',
  '#1a7f37': 'Green',
  '#bc4c00': 'Orange',
  '#ffd33d': 'Yellow',
  '#7ee787': 'Green',
  '#79c0ff': 'Blue',
  '#ff9bce': 'Pink',
  '#ffa657': 'Orange'
}

export const colorName = (hex: string): string => COLOR_NAMES[hex.toLowerCase()] ?? hex

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  marginWidth: 0.6,
  penColors: DEFAULT_PEN_COLORS,
  highlightColors: DEFAULT_HIGHLIGHT_COLORS,
  hotkeys: DEFAULT_HOTKEYS
}

function colors(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw) || raw.length !== fallback.length) return fallback
  return raw.map((c, i) =>
    typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fallback[i]
  )
}

/** Settings from config.json, with defaults for anything missing or invalid. */
export function settingsFrom(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    marginWidth: MARGIN_WIDTHS.some((m) => m.value === r.marginWidth)
      ? (r.marginWidth as number)
      : DEFAULT_SETTINGS.marginWidth,
    penColors: colors(r.penColors, DEFAULT_PEN_COLORS),
    highlightColors: colors(r.highlightColors, DEFAULT_HIGHLIGHT_COLORS),
    hotkeys: hotkeysFrom(r.hotkeys)
  }
}
