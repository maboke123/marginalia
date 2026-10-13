import type { AnnotationPages, PageAnnotations, TextBox } from '../../../shared/annotations'
import { insertBlankPage } from '../../../shared/blankPages'
import { renderMarkdown } from '../lib/markdown'
import { moveToPage, pageOf, replaceItem } from './doc'
import { round } from './geometry'

/** Height of a text box (in PDF points) given its width. */
export type Measure = (width: number) => number

export interface FitPage {
  /** Page width including the margin. */
  width: number
  height: number
  /** Space kept free at the page edges. */
  gap: number
}

/** Another box on the page, in PDF points. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type FitPlan =
  /** Fits on the page at this width, at its own spot or moved up to y. */
  | { kind: 'fits'; width: number; y: number }
  /** Does not fit below its spot even at the widest: goes on a new blank page, full width. */
  | { kind: 'blank'; x: number; y: number; width: number }

type Spot = Pick<TextBox, 'x' | 'y' | 'width'>

/** The widest a box can get at its spot: up to the right edge of the page (with the margin). */
export const widestAt = (box: Spot, page: FitPage): number =>
  Math.max(box.width, round(page.width - box.x - page.gap))

/**
 * The narrowest width, from the box's own up to the right edge of the page, at which its text
 * ends above the bottom of the page. Null when even the widest box runs over.
 */
export function fitWidth(box: Spot, page: FitPage, measure: Measure): number | null {
  const room = page.height - box.y - page.gap
  if (measure(box.width) <= room) return box.width
  const widest = widestAt(box, page)
  if (widest <= box.width || measure(widest) > room) return null
  let [low, high] = [box.width, widest]
  while (high - low > 4) {
    const mid = (low + high) / 2
    if (measure(mid) <= room) high = mid
    else low = mid
  }
  return Math.ceil(high)
}

/**
 * Where a box Claude wrote in goes so all of its text can be read on paper, at its own font
 * size: as wide as needed at its spot; else as wide as it gets, moved up just enough (but not
 * over the boxes above it); else on a new blank page at the full width.
 */
export function planFit(spot: Spot, page: FitPage, measure: Measure, others: Rect[] = []): FitPlan {
  const { gap } = page
  // Not past the right edge of the page either.
  const box = {
    ...spot,
    width: Math.min(spot.width, Math.max(20, round(page.width - spot.x - gap)))
  }
  const width = fitWidth(box, page, measure)
  if (width !== null) return { kind: 'fits', width, y: box.y }
  const widest = widestAt(box, page)
  const top = page.height - gap - measure(widest)
  const above = others
    .filter((o) => o.y < box.y && o.x < box.x + widest && o.x + o.width > box.x)
    .map((o) => o.y + o.height + gap)
  if (top >= Math.max(gap, ...above)) return { kind: 'fits', width: widest, y: round(top) }
  return { kind: 'blank', x: round(gap), y: round(gap), width: round(page.width - 2 * gap) }
}

/**
 * Measures a text box the way the overlay draws it. Everything in the overlay is laid out in
 * PDF points (the scale is a transform), so a hidden copy anywhere gives the same height.
 */
export function measurer(markdown: string, fontSize: number): Measure {
  const html = renderMarkdown(markdown)
  return (width) => {
    const el = document.createElement('div')
    el.className = 'text-box'
    el.style.cssText = `visibility:hidden;left:0;top:0;width:${width}px;font-size:${fontSize}px`
    el.innerHTML = `<div class="text-box-content">${html}</div>`
    document.body.append(el)
    try {
      return el.offsetHeight
    } finally {
      el.remove()
    }
  }
}

/**
 * Puts a box that is on `page` where the plan says: as wide as needed, or on a new blank page
 * right below. With the most blank pages already there it only gets as wide as it can.
 */
export function placeFitted(
  pages: AnnotationPages,
  page: number,
  box: TextBox,
  plan: FitPlan,
  fitPage: FitPage
): AnnotationPages {
  const ref = { page, kind: 'textBoxes' as const, id: box.id }
  const added = plan.kind === 'blank' ? insertBlankPage(pages, page) : null
  if (plan.kind === 'blank' && added) {
    const placed = { ...box, x: plan.x, y: plan.y, width: plan.width }
    return moveToPage(added.pages, ref, added.id, () => placed)
  }
  if (plan.kind === 'fits') {
    return replaceItem(pages, page, 'textBoxes', { ...box, width: plan.width, y: plan.y })
  }
  return replaceItem(pages, page, 'textBoxes', { ...box, width: widestAt(box, fitPage) })
}

/** The other boxes and images on a page, as rectangles a box should not be moved over. */
export function othersOn(page: PageAnnotations, id: string, defaultFont: number): Rect[] {
  const boxes = page.textBoxes
    .filter((b) => b.id !== id)
    .map((b) => {
      const measure = measurer(b.markdown, b.fontSize ?? defaultFont)
      return { x: b.x, y: b.y, width: b.width, height: measure(b.width) }
    })
  return [...boxes, ...(page.images ?? []).filter((im) => im.id !== id)]
}

/** Plans where a box on `page` fits (see planFit), at its own font size. */
export function planBox(
  pages: AnnotationPages,
  page: number,
  box: TextBox,
  fitPage: FitPage,
  defaultFont: number
): FitPlan {
  const measure = measurer(box.markdown, box.fontSize ?? defaultFont)
  return planFit(box, fitPage, measure, othersOn(pageOf(pages, page), box.id, defaultFont))
}
