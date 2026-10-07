import type { AnnotationPages, TextBox } from '../../../shared/annotations'
import { insertBlankPage } from '../../../shared/blankPages'
import { renderMarkdown } from '../lib/markdown'
import { moveToPage, replaceItem } from './doc'
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

export type FitPlan =
  | { kind: 'fits'; width: number }
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

/** Where a box Claude wrote in goes so all of its text can be read on paper. */
export function planFit(box: Spot, page: FitPage, measure: Measure): FitPlan {
  const width = fitWidth(box, page, measure)
  if (width !== null) return { kind: 'fits', width }
  const { gap } = page
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
  const width = plan.kind === 'fits' ? plan.width : widestAt(box, fitPage)
  return replaceItem(pages, page, 'textBoxes', { ...box, width })
}
