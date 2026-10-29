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

  it('keeps a zoom speed per kind of file, normal when unknown', () => {
    expect(settingsFrom({ zoomSpeed: { slides: 2, notes: 7, canvas: 0.5 } }).zoomSpeed).toEqual({
      slides: 2,
      notes: 1,
      canvas: 0.5
    })
    expect(settingsFrom({ zoomSpeed: 'fast' }).zoomSpeed).toEqual(DEFAULT_SETTINGS.zoomSpeed)
  })

  it('draws new canvas arrows curved unless right angles were chosen', () => {
    expect(settingsFrom({ arrowRoute: 'elbow' }).arrowRoute).toBe('elbow')
    expect(settingsFrom({ arrowRoute: 'zigzag' }).arrowRoute).toBe('curved')
  })

  it('gives new canvas arrows the chosen relation, else a plain arrow', () => {
    expect(settingsFrom({ arrowRelation: 'composition' }).arrowRelation).toBe('composition')
    expect(settingsFrom({ arrowRelation: 'friendship' }).arrowRelation).toBeNull()
    expect(settingsFrom({}).arrowRelation).toBeNull()
  })

  it('puts the Claude panel at the bottom unless it was set to the right', () => {
    expect(settingsFrom({ claudeDock: 'right' }).claudeDock).toBe('right')
    expect(settingsFrom({ claudeDock: 'left' }).claudeDock).toBe('bottom')
  })
})
