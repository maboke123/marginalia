import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS } from './hotkeys'
import { DEFAULT_SETTINGS, settingsFrom } from './settings'

describe('settingsFrom', () => {
  it('uses defaults for a missing or damaged config', () => {
    expect(settingsFrom(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFrom('nonsense')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and replaces invalid ones one by one', () => {
    const settings = settingsFrom({
      theme: 'dark',
      marginWidth: 0.42,
      penColors: ['#000000', 'red', '#ABCDEF', '#1a7f37', '#bc4c00'],
      highlightColors: ['#ffffff'],
      hotkeys: { pen: 'B', search: 'S' }
    })
    expect(settings.theme).toBe('dark')
    expect(settings.marginWidth).toBe(0.6)
    expect(settings.penColors).toEqual(['#000000', '#1f6feb', '#abcdef', '#1a7f37', '#bc4c00'])
    expect(settings.highlightColors).toEqual(DEFAULT_SETTINGS.highlightColors)
    expect(settings.hotkeys).toEqual({ ...DEFAULT_HOTKEYS, pen: 'B' })
  })
})
