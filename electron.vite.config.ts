import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const pdfjs = normalizePath(resolve('node_modules/pdfjs-dist'))

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      // pdf.js fetches these at runtime: fonts that PDFs do not embed, character maps for
      // CJK text, colour profiles and wasm image decoders.
      viteStaticCopy({
        targets: ['cmaps', 'standard_fonts', 'iccs', 'wasm'].map((dir) => ({
          src: `${pdfjs}/${dir}`,
          dest: 'pdfjs',
          rename: { stripBase: 2 }
        }))
      })
    ]
  }
})
