/** Several files side by side: 2 next to each other, 3 in a row, or 4 as two by two. */
export interface Grid {
  panes: (string | null)[]
  /** The pane that opening a file fills. */
  focus: number
}

export const GRID_SIZES = [2, 3, 4] as const

/**
 * A grid of `size` panes, keeping what the old one showed (the focused file first when
 * panes are dropped). `start` fills the first panes of a new grid.
 */
export function resizeGrid(grid: Grid | null, size: number, start: (string | null)[] = []): Grid {
  const before = grid?.panes ?? start
  let panes = before.slice(0, size)
  const focused = grid ? grid.panes[grid.focus] : null
  if (focused && !panes.includes(focused)) panes[size - 1] = focused
  panes = [...panes, ...Array(Math.max(0, size - panes.length)).fill(null)]
  // A file can show once only: its viewer registers itself by path.
  panes = panes.map((p, i) => (p && panes.indexOf(p) !== i ? null : p))
  const at = focused ? panes.indexOf(focused) : -1
  return { panes, focus: at >= 0 ? at : Math.min(grid?.focus ?? 0, size - 1) }
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
