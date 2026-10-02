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

// Eraser radius in screen pixels, so it feels the same at any zoom.
export const ERASER_SIZES = [
  { name: 'Small', value: 5 },
  { name: 'Medium', value: 10 },
  { name: 'Large', value: 20 }
]

/**
 * Slides range from 364 points wide (Beamer) to 960 (PowerPoint). Sizes here are chosen in
 * screen pixels at "fit width" on a laptop and multiplied by this, so they look the same in
 * every deck.
 */
export const pageUnit = (pageWidth: number): number => pageWidth / 625

// Text box font size in screen pixels at "fit width".
export const TEXT_SIZES = [
  { name: 'Small', value: 11 },
  { name: 'Normal', value: 13 },
  { name: 'Large', value: 16 },
  { name: 'Huge', value: 21 }
]
export const HIGHLIGHT_OPACITY = 0.4
