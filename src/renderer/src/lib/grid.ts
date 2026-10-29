/**
 * Several files side by side, in columns that can each hold panes above each other:
 * 2 next to each other, 3 in a row, 4 as two by two, or what closing and dropping made.
 */
export interface Grid {
  /** Column by column, top to bottom. */
  panes: (string | null)[]
  /** How many panes each column holds. */
  columns: number[]
  /** Share of the width per column, adding up to 1. */
  widths: number[]
  /** Per column, the share of its height per pane. */
  heights: number[][]
  /** The pane that opening a file fills. */
  focus: number
}

export const GRID_SIZES = [2, 3, 4] as const
export const MAX_PANES = 4
/** No pane gets narrower or lower than this share of the window by dragging a border. */
export const MIN_SHARE = 0.1

export type Side = 'left' | 'right' | 'top' | 'bottom'

const LAYOUTS: Record<number, number[]> = { 1: [1], 2: [1, 1], 3: [1, 1, 1], 4: [2, 2] }

const even = (n: number): number[] => Array(n).fill(1 / n)
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
const normalise = (xs: number[]): number[] => xs.map((x) => x / sum(xs))

/** Column and place in that column of pane `i`. */
function cellOf(grid: Grid, i: number): [number, number] {
  let start = 0
  for (let c = 0; c < grid.columns.length; c++) {
    if (i < start + grid.columns[c]) return [c, i - start]
    start += grid.columns[c]
  }
  return [grid.columns.length - 1, grid.columns[grid.columns.length - 1] - 1]
}

const startOf = (grid: Grid, column: number): number => sum(grid.columns.slice(0, column))

/** Pane indices as they read: row by row, left to right. */
function readingOrder(grid: Grid): number[] {
  const cells = grid.panes.map((_, i) => [i, ...cellOf(grid, i)])
  return cells.sort((a, b) => a[2] - b[2] || a[1] - b[1]).map(([i]) => i)
}

/** A preset layout of `list.length` panes, filled in reading order. */
function preset(list: (string | null)[], focus: number): Grid {
  const columns = LAYOUTS[list.length]
  const grid: Grid = {
    panes: Array(list.length).fill(null),
    columns,
    widths: even(columns.length),
    heights: columns.map((n) => even(n)),
    focus: 0
  }
  readingOrder(grid).forEach((at, k) => (grid.panes[at] = list[k]))
  grid.focus = readingOrder(grid)[focus]
  return grid
}

/** One pane per file, as far as it goes: for the single view or the two of lecture mode. */
export function gridOf(files: (string | null)[], widths?: number[]): Grid {
  return {
    panes: files,
    columns: files.map(() => 1),
    widths: widths ?? even(files.length),
    heights: files.map(() => [1]),
    focus: 0
  }
}

/**
 * A grid of `size` panes, keeping what the old one showed (the focused file first when
 * panes are dropped). `start` fills the first panes of a new grid.
 */
export function resizeGrid(grid: Grid | null, size: number, start: (string | null)[] = []): Grid {
  const before = grid ? readingOrder(grid).map((i) => grid.panes[i]) : start
  let panes = before.slice(0, size)
  const focused = grid ? grid.panes[grid.focus] : null
  if (focused && !panes.includes(focused)) panes[size - 1] = focused
  panes = [...panes, ...Array(Math.max(0, size - panes.length)).fill(null)]
  // A file can show once only: its viewer registers itself by path.
  panes = panes.map((p, i) => (p && panes.indexOf(p) !== i ? null : p))
  const at = focused ? panes.indexOf(focused) : -1
  const focus = at >= 0 ? at : Math.min(grid ? readingOrder(grid).indexOf(grid.focus) : 0, size - 1)
  return preset(panes, focus)
}

/** Opens a file in the focused pane, or moves the focus to the pane already showing it. */
export function openInGrid(grid: Grid, path: string): Grid {
  const at = grid.panes.indexOf(path)
  if (at >= 0) return { ...grid, focus: at }
  return { ...grid, panes: grid.panes.map((p, i) => (i === grid.focus ? path : p)) }
}

/** The grid after files changed name or place (`map`), or are gone (null). */
export function remapGrid(grid: Grid, map: (path: string) => string | null): Grid {
  return { ...grid, panes: grid.panes.map((p) => p && map(p)) }
}

/** Without pane `i`; the panes around it share its room. Never removes the last pane. */
export function closePane(grid: Grid, i: number): Grid {
  if (grid.panes.length <= 1) return grid
  const [column, row] = cellOf(grid, i)
  const panes = grid.panes.filter((_, k) => k !== i)
  let { columns, widths, heights } = grid
  if (columns[column] === 1) {
    columns = columns.filter((_, c) => c !== column)
    widths = normalise(widths.filter((_, c) => c !== column))
    heights = heights.filter((_, c) => c !== column)
  } else {
    columns = columns.map((n, c) => (c === column ? n - 1 : n))
    heights = heights.map((h, c) => (c === column ? normalise(h.filter((_, r) => r !== row)) : h))
  }
  // The focus stays on its file; a closed focused pane hands it to the one taking its place.
  const focus = grid.focus > i ? grid.focus - 1 : Math.min(grid.focus, panes.length - 1)
  return { panes, columns, widths, heights, focus }
}

/**
 * Opens `path` in a new pane on `side` of pane `i`, which gives up half its room. Null when
 * the grid is full. A file shown elsewhere moves here.
 */
export function splitPane(grid: Grid, i: number, side: Side, path: string): Grid | null {
  const shown = grid.panes.indexOf(path)
  if (shown === i) return { ...grid, focus: i }
  if (shown >= 0) {
    const without = closePane(grid, shown)
    return splitPane(without, shown < i ? i - 1 : i, side, path)
  }
  if (grid.panes.length >= MAX_PANES) return null
  const [column, row] = cellOf(grid, i)
  let { columns, widths, heights } = grid
  let at: number
  if (side === 'left' || side === 'right') {
    const c = side === 'left' ? column : column + 1
    const half = widths[column] / 2
    widths = widths.map((w, k) => (k === column ? half : w))
    widths = [...widths.slice(0, c), half, ...widths.slice(c)]
    columns = [...columns.slice(0, c), 1, ...columns.slice(c)]
    heights = [...heights.slice(0, c), [1], ...heights.slice(c)]
    at = c > column ? startOf(grid, column) + columns[column] : startOf(grid, column)
  } else {
    const r = side === 'top' ? row : row + 1
    const half = heights[column][row] / 2
    heights = heights.map((h, k) => {
      if (k !== column) return h
      const halved = h.map((x, j) => (j === row ? half : x))
      return [...halved.slice(0, r), half, ...halved.slice(r)]
    })
    columns = columns.map((n, k) => (k === column ? n + 1 : n))
    at = startOf(grid, column) + r
  }
  const panes = [...grid.panes.slice(0, at), path, ...grid.panes.slice(at)]
  return { panes, columns, widths, heights, focus: at }
}

/**
 * Shares after dragging the border between `i` and `i + 1` by `delta` (a share of the
 * whole). Both keep at least `MIN_SHARE`; the others do not change.
 */
export function moveBorder(shares: number[], i: number, delta: number): number[] {
  const both = shares[i] + shares[i + 1]
  const first = Math.min(both - MIN_SHARE, Math.max(MIN_SHARE, shares[i] + delta))
  return shares.map((s, k) => (k === i ? first : k === i + 1 ? both - first : s))
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Where each pane sits, as shares of the workspace. */
export function paneRects(grid: Grid): Rect[] {
  return grid.panes.map((_, i) => {
    const [column, row] = cellOf(grid, i)
    return {
      left: sum(grid.widths.slice(0, column)),
      width: grid.widths[column],
      top: sum(grid.heights[column].slice(0, row)),
      height: grid.heights[column][row]
    }
  })
}

/** Which part of a pane a file dropped at (x, y), shares of the pane, lands in. */
export function dropSide(x: number, y: number): Side | 'center' {
  const edges: [Side, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y]
  ]
  const [side, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a))
  return distance < 0.25 ? side : 'center'
}

/** The part of `rect` a new pane on `side` would take. */
export function sideOf(rect: Rect, side: Side | 'center'): Rect {
  const { left, top, width, height } = rect
  if (side === 'left') return { left, top, width: width / 2, height }
  if (side === 'right') return { left: left + width / 2, top, width: width / 2, height }
  if (side === 'top') return { left, top, width, height: height / 2 }
  if (side === 'bottom') return { left, top: top + height / 2, width, height: height / 2 }
  return rect
}
