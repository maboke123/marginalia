import { continueRender, delayRender } from 'remotion'

// Windows system fonts, the same ones the app uses, so renders need a Windows machine.
const faces = [
  '600 1em "Segoe UI Variable Display"',
  '400 1em "Segoe UI Variable Text"',
  '400 1em "Cascadia Mono"'
]

export function waitForFonts(): void {
  const handle = delayRender('Loading fonts')
  Promise.all(faces.map((face) => document.fonts.load(face)))
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle))
}
