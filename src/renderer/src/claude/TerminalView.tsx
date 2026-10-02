import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'

/** xterm needs colour values, so they are read from the theme tokens once. */
function theme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string): string => css.getPropertyValue(name).trim()
  return {
    background: token('--bg'),
    foreground: token('--text'),
    cursor: token('--text'),
    selectionBackground: token('--bg-selected')
  }
}

/**
 * The terminal tab: the Claude Code CLI itself, in the vault folder, for anything the panel
 * cannot do (like /login on a new computer). It keeps running when the panel closes.
 */
export function TerminalView(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [ended, setEnded] = useState<number | null>(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      theme: theme(),
      cursorBlink: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fit.fit()

    const api = window.api.terminal
    const stopData = api.onData((data) => term.write(data))
    const stopExit = api.onExit((code) => setEnded(code))
    const input = term.onData((data) => api.input(data))
    api
      .start(term.cols, term.rows)
      .then(({ output }) => {
        if (output) term.write(output)
        term.focus()
      })
      .catch((err: Error) => term.write(`\r\n${err.message}\r\n`))

    const observer = new ResizeObserver(() => {
      fit.fit()
      api.resize(term.cols, term.rows)
    })
    observer.observe(hostRef.current!)
    return () => {
      observer.disconnect()
      input.dispose()
      stopData()
      stopExit()
      term.dispose()
    }
  }, [run])

  return (
    <div className="claude-terminal">
      <div className="claude-terminal-screen" ref={hostRef} />
      {ended !== null && (
        <div className="claude-terminal-ended">
          <span className="muted">Claude Code stopped (exit code {ended}).</span>
          <button
            className="button"
            onClick={() => {
              setEnded(null)
              setRun((n) => n + 1)
            }}
          >
            Start again
          </button>
        </div>
      )}
    </div>
  )
}
