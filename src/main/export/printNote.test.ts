import path from 'path'
import { pathToFileURL } from 'url'
import { describe, expect, it } from 'vitest'
import { fileImages } from './printNote'

describe('fileImages', () => {
  const root = path.join('C:', 'Notes')
  const resolve = (p: string): string => {
    if (p.startsWith('..')) throw new Error('outside')
    return path.join(root, p)
  }

  it('points vault images at their files', () => {
    const html = '<img src="vault://local/ML/B2%20Trees/assets/plot%231.png" alt="plot">'
    const file = pathToFileURL(path.join(root, 'ML', 'B2 Trees', 'assets', 'plot#1.png')).href
    expect(fileImages(html, resolve)).toBe(`<img src="${file}" alt="plot">`)
  })

  it('leaves out an image outside the vault and keeps web images', () => {
    const html = '<img src="vault://local/..%2Fsecret.png"><img src="https://example.com/a.png">'
    expect(fileImages(html, resolve)).toBe('<img src=""><img src="https://example.com/a.png">')
  })
})
