import { describe, expect, it } from 'vitest'
import { nextVersion, parseTag } from './version.mjs'

describe('nextVersion', () => {
  it('bumps the minor version for a feature and resets the patch', () => {
    expect(
      nextVersion([1, 2, 3], ['fix: keep accept buttons small', 'feat: export a note as a PDF'])
    ).toBe('1.3.0')
  })

  it('bumps the patch for fixes and other changes', () => {
    expect(nextVersion([1, 3, 0], ['fix: open VS Code in a new window', 'docs: add README'])).toBe(
      '1.3.1'
    )
  })

  it('bumps the major version for a breaking change', () => {
    expect(nextVersion([1, 3, 1], ['feat!: store annotations per page'])).toBe('2.0.0')
    expect(
      nextVersion([1, 3, 1], ['refactor: new sidecar format\n\nBREAKING CHANGE: old files'])
    ).toBe('2.0.0')
  })

  it('keeps the version when nothing changed since the release', () => {
    expect(nextVersion([1, 1, 0], [])).toBe('1.1.0')
  })
})

describe('parseTag', () => {
  it('reads release tags only', () => {
    expect(parseTag('v1.10.2')).toEqual([1, 10, 2])
    expect(parseTag('1.0.0')).toBeNull()
    expect(parseTag('v1.0')).toBeNull()
  })
})
