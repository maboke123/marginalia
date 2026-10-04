import { useState } from 'react'
import {
  comboOf,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  hotkeyProblem,
  type HotkeyAction
} from '../../../shared/hotkeys'
import {
  colorName,
  DEFAULT_HIGHLIGHT_COLORS,
  DEFAULT_PEN_COLORS,
  MARGIN_WIDTHS,
  type AppSettings,
  type Theme
} from '../../../shared/settings'
import { useApp } from '../store'
import { Icon } from './Icon'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Same as Windows' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

function Colors({
  label,
  colors,
  defaults,
  onChange
}: {
  label: string
  colors: string[]
  defaults: string[]
  onChange(colors: string[]): void
}): React.JSX.Element {
  const changed = colors.some((c, i) => c !== defaults[i])
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="settings-colors">
        {colors.map((color, i) => (
          <input
            key={i}
            type="color"
            value={color}
            title={colorName(color)}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(colors.map((c, j) => (j === i ? e.target.value : c)))}
          />
        ))}
        {changed && (
          <button className="text-button" onClick={() => onChange(defaults)}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

function Hotkeys({
  hotkeys,
  onChange
}: {
  hotkeys: AppSettings['hotkeys']
  onChange(hotkeys: AppSettings['hotkeys']): void
}): React.JSX.Element {
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [problem, setProblem] = useState<{ action: HotkeyAction; text: string } | null>(null)

  const record = (action: HotkeyAction, e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const combo = comboOf(e.nativeEvent)
    if (!combo) return
    const used = HOTKEY_ACTIONS.find((a) => a.id !== action && hotkeys[a.id] === combo)
    const text = used
      ? `Already used for ${used.label.toLowerCase()}`
      : hotkeyProblem(action, combo)
    if (text) {
      setProblem({ action, text })
      return
    }
    setProblem(null)
    setRecording(null)
    onChange({ ...hotkeys, [action]: combo })
  }

  return (
    <table className="settings-hotkeys">
      <tbody>
        {HOTKEY_ACTIONS.map((action) => {
          const active = recording === action.id
          return (
            <tr key={action.id}>
              <td>{action.label}</td>
              <td>
                <button
                  className={active ? 'hotkey recording' : 'hotkey'}
                  aria-label={`Hotkey for ${action.label}`}
                  onClick={() => {
                    setProblem(null)
                    setRecording(active ? null : action.id)
                  }}
                  onKeyDown={active ? (e) => record(action.id, e) : undefined}
                  onBlur={() => active && setRecording(null)}
                >
                  {active ? 'Press keys...' : hotkeys[action.id]}
                </button>
                {hotkeys[action.id] !== DEFAULT_HOTKEYS[action.id] && !active && (
                  <button
                    className="text-button"
                    onClick={() =>
                      onChange({ ...hotkeys, [action.id]: DEFAULT_HOTKEYS[action.id] })
                    }
                  >
                    Reset
                  </button>
                )}
                {problem?.action === action.id && (
                  <span className="settings-problem">{problem.text}</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** App-wide preferences. Each change is saved at once. */
export function SettingsDialog(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const save = useApp((s) => s.saveSettings)
  const close = (): void => useApp.getState().setOverlay(null)

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.recording')) close()
        }}
      >
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="icon-button" aria-label="Close" autoFocus onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-body">
          <section>
            <h3>Appearance</h3>
            <div className="settings-row" role="radiogroup" aria-label="Theme">
              <span className="settings-label">Theme</span>
              <div className="settings-choices">
                {THEMES.map((t) => (
                  <label key={t.value} className="check">
                    <input
                      type="radio"
                      name="theme"
                      checked={settings.theme === t.value}
                      onChange={() => void save({ theme: t.value })}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3>Slides</h3>
            <div className="settings-row">
              <span className="settings-label">Margin</span>
              <div>
                <select
                  className="toolbar-select"
                  aria-label="Margin for new PDFs"
                  value={settings.marginWidth}
                  onChange={(e) => void save({ marginWidth: Number(e.target.value) })}
                >
                  {MARGIN_WIDTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.name} ({Math.round(m.value * 100)}% of the slide width)
                    </option>
                  ))}
                </select>
                <p className="muted settings-help">
                  For PDFs you have not annotated yet. Change it per PDF in its toolbar.
                </p>
              </div>
            </div>
            <Colors
              label="Pen colours"
              colors={settings.penColors}
              defaults={DEFAULT_PEN_COLORS}
              onChange={(penColors) => void save({ penColors })}
            />
            <Colors
              label="Highlighter colours"
              colors={settings.highlightColors}
              defaults={DEFAULT_HIGHLIGHT_COLORS}
              onChange={(highlightColors) => void save({ highlightColors })}
            />
          </section>

          <section>
            <h3>Hotkeys</h3>
            <p className="muted settings-help">Click a hotkey, then press the new keys.</p>
            <Hotkeys hotkeys={settings.hotkeys} onChange={(hotkeys) => void save({ hotkeys })} />
          </section>

          <section>
            <h3>Claude</h3>
            <p className="muted settings-help">
              Model, effort, editing and login are in the Claude panel ({settings.hotkeys.claude}),
              under its gear button.
            </p>
          </section>

          <p className="muted settings-version">Version {window.api.app.version}</p>
        </div>
      </div>
    </div>
  )
}
