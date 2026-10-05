# Videos

The promo video, made with [Remotion](https://www.remotion.dev): React components rendered to MP4. Colours come from `src/theme.css` (the app's light tokens and the two colours of `build/icon.svg`), fonts are the app's Windows system fonts, so render on Windows.

From the repo root (run `npm install` in `videos/` once):

```sh
npm run video:capture   # builds the app and retakes the screens off screen
npm run video           # Remotion Studio with live preview
npm run video:render    # renders videos/out/promo.mp4
```

- `scripts/capture.mjs` builds the README demo vault, drives the built app with Playwright and writes `public/screens/*.png` (1286 x 736 window at 3x) and `src/screens.json` (window size and the boxes of the ink and text boxes on slide 3, used to draw them in).
- Scenes live in `src/scenes`, the order and durations in `SCENES` in `src/compositions/Promo.tsx`.
- Inside a `Screen`, positions are app pixels; `useCamera` pans and zooms between two views.
- Put music in `public/audio` and play it with `<Audio src={staticFile("audio/file.mp3")} />` from `remotion`.
