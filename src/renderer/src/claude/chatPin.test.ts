import { describe, expect, it } from 'vitest'
import { chatGroups, commonFolder, pickPin, sendPin, shownChat } from './chatPin'

const OPDRACHTEN = 'Ontwerp van Algoritmen/opdrachten'
const REPORTS = `${OPDRACHTEN}/Randomized algoritmen/reports`

describe('shownChat', () => {
  it('follows what I look at without a pin', () => {
    expect(shownChat(REPORTS, null, null)).toBe(REPORTS)
  })

  it('keeps the chat I asked in while I open its subfolders', () => {
    const pin = sendPin(OPDRACHTEN, null)
    expect(shownChat(REPORTS, pin, null)).toBe(OPDRACHTEN)
    expect(shownChat('Ontwerp van Algoritmen/les_2', pin, null)).toBe(
      'Ontwerp van Algoritmen/les_2'
    )
  })

  it('keeps the answering chat when Claude opens a file elsewhere', () => {
    const pin = sendPin(OPDRACHTEN, null)
    expect(shownChat('Machine Learning/les_1', pin, OPDRACHTEN)).toBe(OPDRACHTEN)
  })

  it('keeps a vault chat only while it answers', () => {
    const pin = sendPin('', null)
    expect(shownChat('Machine Learning', pin, '')).toBe('')
    expect(shownChat('Machine Learning', pin, null)).toBe('Machine Learning')
  })

  it('keeps a picked chat in a subfolder while I stay in the folder', () => {
    const pin = pickPin(REPORTS, OPDRACHTEN)
    expect(shownChat(OPDRACHTEN, pin, null)).toBe(REPORTS)
    expect(shownChat('Ontwerp van Algoritmen/les_1', pin, null)).toBe(
      'Ontwerp van Algoritmen/les_1'
    )
  })

  it('picking the chat of what I look at follows the view again', () => {
    expect(pickPin(REPORTS, REPORTS)).toBeNull()
  })

  it('a new question keeps the wider scope of a picked chat', () => {
    const pin = pickPin(REPORTS, OPDRACHTEN)
    expect(sendPin(REPORTS, pin)).toBe(pin)
  })
})

describe('commonFolder', () => {
  it('is the deepest shared folder', () => {
    expect(commonFolder(REPORTS, `${OPDRACHTEN}/Graphs`)).toBe(OPDRACHTEN)
    expect(commonFolder('Machine Learning', OPDRACHTEN)).toBe('')
  })

  it('does not match folders that only start alike', () => {
    expect(commonFolder('les_1', 'les_10')).toBe('')
  })
})

describe('chatGroups', () => {
  const chat = (
    folder: string,
    updated: number | null = null
  ): { folder: string; updated: number | null } => ({
    folder,
    updated
  })

  it('lists this folder, above, below, the course and the rest', () => {
    const groups = chatGroups(`${OPDRACHTEN}/Randomized algoritmen`, [
      chat(REPORTS, 3),
      chat(OPDRACHTEN, 2),
      chat('Ontwerp van Algoritmen', 1),
      chat('Ontwerp van Algoritmen/les_2', 5),
      chat('Machine Learning/les_1', 9)
    ])
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.folder)])).toEqual([
      ['This folder', [`${OPDRACHTEN}/Randomized algoritmen`]],
      ['Folders above', [OPDRACHTEN, 'Ontwerp van Algoritmen']],
      ['Folders below', [REPORTS]],
      ['This course', ['Ontwerp van Algoritmen/les_2']],
      ['Other courses', ['Machine Learning/les_1']]
    ])
  })
})
