import { describe, expect, it } from 'vitest'
import type { PageAnnotations, PageImage } from '../../../shared/annotations'
import { addItem, removeItems } from './doc'
import { imagePath, placeImage, resizeImage } from './images'
import { marginSlot } from './margin'

const image = (x: number, y: number, width: number, height: number): PageImage => ({
  id: `i_${x}_${y}`,
  x,
  y,
  width,
  height,
  src: 'assets/2026-10-04_09-12-30.png',
  author: 'me'
})

const empty: PageAnnotations = { strokes: [], highlights: [], textBoxes: [] }
// 625 points wide: pageUnit 1, so the gap is 8 points.
const slide = { width: 625, height: 469, margin: 0.6 }

describe('placeImage', () => {
  it('fills the margin width when no spot is given', () => {
    const at = placeImage({ width: 1600, height: 900 }, slide, empty, null)
    expect(at).toEqual({ x: 633, y: 8, width: 359, height: 201.94 })
  })

  it('keeps a small screenshot at its real size', () => {
    const at = placeImage({ width: 200, height: 100 }, slide, empty, null)
    expect(at.width).toBe(150)
    expect(at.height).toBe(75)
  })

  it('goes under what is already in the margin', () => {
    const page = { ...empty, images: [image(633, 8, 359, 200)] }
    expect(placeImage({ width: 200, height: 100 }, slide, page, null).y).toBe(216)
  })

  it('lands on the slide at the clicked spot, never past the margin', () => {
    const at = placeImage({ width: 1600, height: 900 }, slide, empty, [500, 40])
    expect(at.x).toBe(500)
    expect(at.y).toBe(40)
    expect(at.x + at.width).toBeLessThanOrEqual(625 * 1.6)
  })

  it('without a margin it goes in the middle of the slide', () => {
    const at = placeImage({ width: 1600, height: 900 }, { ...slide, margin: 0 }, empty, null)
    expect(at.width).toBe(312.5)
    expect(at.x).toBe(156.25)
  })

  it('shrinks a tall image to fit the page height', () => {
    const at = placeImage({ width: 400, height: 2000 }, slide, empty, [100, 300])
    expect(at.height).toBeLessThanOrEqual(469 - 16)
    expect(at.y + at.height).toBeLessThanOrEqual(469)
    expect(at.width / at.height).toBeCloseTo(0.2)
  })
})

describe('resizeImage', () => {
  it('keeps the aspect ratio and a minimum width', () => {
    expect(resizeImage(image(0, 0, 200, 100), 100, 20)).toMatchObject({ width: 300, height: 150 })
    expect(resizeImage(image(0, 0, 200, 100), -500, 20)).toMatchObject({ width: 20, height: 10 })
  })
})

describe('images in the annotation doc', () => {
  it('drops the images list and the page once the last image is removed', () => {
    const one = addItem({}, 3, 'images', image(10, 10, 100, 50))
    expect(one['3'].images).toHaveLength(1)
    const withInk = addItem(one, 3, 'highlights', {
      id: 'h',
      color: '#ff0',
      text: 'x',
      rects: [[0, 0, 1, 1]],
      author: 'me'
    })
    expect(removeItems(withInk, 3, 'images', ['i_10_10'])['3']).not.toHaveProperty('images')
    expect(removeItems(one, 3, 'images', ['i_10_10'])).toEqual({})
  })

  it('keeps Claude margin notes under images in the margin', () => {
    const page = { ...empty, images: [image(633, 8, 359, 200)] }
    expect(marginSlot(page, 625, 469, 0.6).y).toBe(216)
  })
})

describe('imagePath', () => {
  it('resolves next to the PDF', () => {
    expect(imagePath('ML/B2 Decision trees/slides.pdf', 'assets/a.png')).toBe(
      'ML/B2 Decision trees/assets/a.png'
    )
  })
})
