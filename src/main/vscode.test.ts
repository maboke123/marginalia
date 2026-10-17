import { describe, expect, it } from 'vitest'
import { claudeChatUrl, vscodeUrl } from './vscode'

describe('vscodeUrl', () => {
  it('keeps the drive letter and encodes every folder name', () => {
    expect(
      vscodeUrl('C:\\Users\\mathi\\Notes\\Ontwerp van Algoritmen\\Randomized algoritmen')
    ).toBe('vscode://file/C:/Users/mathi/Notes/Ontwerp%20van%20Algoritmen/Randomized%20algoritmen/')
  })

  it('encodes characters that would end the path in a link', () => {
    expect(vscodeUrl('D:\\Vak #3\\Q&A?\\')).toBe('vscode://file/D:/Vak%20%233/Q%26A%3F/')
  })
})

describe('claudeChatUrl', () => {
  it('opens a conversation in the Claude Code panel', () => {
    expect(claudeChatUrl('acbc490d-9ac4-4b7b-98ce-982b775ab76a')).toBe(
      'vscode://anthropic.claude-code/open?session=acbc490d-9ac4-4b7b-98ce-982b775ab76a'
    )
  })
})
