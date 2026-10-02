// Sizes shared by the screen and the PDF export. The ink colours are settings: see settings.ts.

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
