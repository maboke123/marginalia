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
  /** Text boxes and images snap to slide text, page edges and each other while dragged. */
  snapping: boolean
  /** Spoken language of lectures being recorded; "auto" lets whisper guess per chunk. */
  transcribeLanguage: TranscribeLanguage
  /** Last choice for transcribing a recording file. */
  transcribeModel: 'small' | 'accurate'
  /**
   * Transcribe while recording a lecture. Off by default: it costs battery and heat, and the
   * recording can be transcribed afterwards.
   */
  transcribeLive: boolean
  /** Recordings not transcribed yet are transcribed by themselves while the laptop is plugged in. */
  autoTranscribe: boolean
  /** The bar across the window while recording; when hidden, the record buttons show the time. */
  recordingBar: boolean
}

export type TranscribeLanguage = 'auto' | 'nl' | 'en'

export const TRANSCRIBE_LANGUAGES: { value: TranscribeLanguage; name: string }[] = [
  { value: 'auto', name: 'Any language' },
  { value: 'nl', name: 'Dutch' },
  { value: 'en', name: 'English' }
]

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
  hotkeys: DEFAULT_HOTKEYS,
  snapping: true,
  transcribeLanguage: 'auto',
  transcribeModel: 'accurate',
  transcribeLive: false,
  recordingBar: true,
  autoTranscribe: true
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
    hotkeys: hotkeysFrom(r.hotkeys),
    snapping: typeof r.snapping === 'boolean' ? r.snapping : DEFAULT_SETTINGS.snapping,
    transcribeLanguage: TRANSCRIBE_LANGUAGES.some((l) => l.value === r.transcribeLanguage)
      ? (r.transcribeLanguage as TranscribeLanguage)
      : DEFAULT_SETTINGS.transcribeLanguage,
    transcribeModel: r.transcribeModel === 'small' ? 'small' : 'accurate',
    transcribeLive: r.transcribeLive === true,
    recordingBar: r.recordingBar !== false,
    autoTranscribe: r.autoTranscribe !== false
  }
}
