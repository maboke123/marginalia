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

// Text box font sizes for a 625-point wide page; on other pages they scale with pageUnit,
// so a size looks the same on every deck.
export const TEXT_SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 21, 24, 28]
export const DEFAULT_TEXT_SIZE = 13
export const HIGHLIGHT_OPACITY = 0.4
