// Ink colours are stored in the sidecar as hex, so they are data rather than theme tokens.
// They stay the same in dark mode because the slides themselves are always white.

export const PEN_COLORS = [
  { name: 'Black', value: '#1f2328' },
  { name: 'Blue', value: '#1f6feb' },
  { name: 'Red', value: '#cf222e' },
  { name: 'Green', value: '#1a7f37' },
  { name: 'Orange', value: '#bc4c00' }
]

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#ffd33d' },
  { name: 'Green', value: '#7ee787' },
  { name: 'Blue', value: '#79c0ff' },
  { name: 'Pink', value: '#ff9bce' },
  { name: 'Orange', value: '#ffa657' }
]

// Widths in screen pixels at "fit width"; see pageUnit in PageOverlay.
export const PEN_WIDTHS = [
  { name: 'Fine', value: 2 },
  { name: 'Medium', value: 3 },
  { name: 'Bold', value: 5 }
]

export const HIGHLIGHTER_WIDTH = 16
export const HIGHLIGHT_OPACITY = 0.4
