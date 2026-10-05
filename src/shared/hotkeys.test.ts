import { describe, expect, it } from 'vitest'
import { comboOf, DEFAULT_HOTKEYS, hotkeyProblem, hotkeysFrom } from './hotkeys'

const press = (
  code: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt', boolean>> = {},
  key = ''
): Parameters<typeof comboOf>[0] => ({
  code,
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: false
})

describe('comboOf', () => {
  it('names presses by physical key', () => {
    expect(comboOf(press('KeyM', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+M')
    expect(comboOf(press('Comma', { ctrl: true }))).toBe('Ctrl+,')
    expect(comboOf(press('KeyP'))).toBe('P')
    expect(comboOf(press('F2'))).toBe('F2')
    expect(comboOf(press('ControlLeft', { ctrl: true }))).toBeNull()
  })

  it('takes letters from the keyboard layout, as typed', () => {
    // AZERTY: M is on the QWERTY ; key, A and Q are swapped.
    expect(comboOf(press('Semicolon', { ctrl: true, shift: true }, 'M'))).toBe('Ctrl+Shift+M')
    expect(comboOf(press('Semicolon', {}, 'm'))).toBe('M')
    expect(comboOf(press('KeyQ', {}, 'a'))).toBe('A')
    // Not a letter: the physical key, so Shift does not change the name.
    expect(comboOf(press('Digit1', { ctrl: true }, '&'))).toBe('Ctrl+1')
    expect(comboOf(press('KeyE', { ctrl: true, alt: true }, '€'))).toBe('Ctrl+Alt+E')
  })
})

describe('hotkeyProblem and hotkeysFrom', () => {
  it('keeps app-wide hotkeys off plain typing and slide tools on single keys', () => {
    expect(hotkeyProblem('search', 'F')).toMatch(/Ctrl or Alt/)
    expect(hotkeyProblem('search', 'Alt+F')).toBeNull()
    expect(hotkeyProblem('search', 'F3')).toBeNull()
    expect(hotkeyProblem('pen', 'Ctrl+P')).toMatch(/single key/)
    expect(hotkeyProblem('pen', 'B')).toBeNull()
  })

  it('fills in defaults and ignores invalid values', () => {
    expect(hotkeysFrom({ pen: 'B', search: 'F', claude: 42 })).toEqual({
      ...DEFAULT_HOTKEYS,
      pen: 'B'
    })
    expect(hotkeysFrom(null)).toEqual(DEFAULT_HOTKEYS)
  })
})
