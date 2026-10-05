// Takes the app screens for the promo: builds the README demo vault in a temp folder, drives the
// built app off screen (like the e2e tests) and writes PNGs to public/screens/ plus the boxes of
// the slide annotations to src/screens.json. Run from the repo root after `npx electron-vite build`:
// `node videos/scripts/capture.mjs`.
import { _electron as electron } from '@playwright/test'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { makeDeck } from '../../scripts/screenshots/deck.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '../public/screens')
const BOXES = path.join(HERE, '../src/screens.json')
// 1280 x 720 at 3x gives 3840 x 2160 images, sharp enough to zoom into on a 1080p canvas.
const SIZE = { width: 1280, height: 720 }
const SECTION = 'Machine Learning/B2 Decision trees'
const PDF = 'Decision trees.pdf'
const MARGIN = 0.6

const NOTE = `# Decision trees

A tree tests one attribute per node and picks the split that leaves the purest subsets. Worked example on [slide 3](Decision%20trees.pdf#page=3).

## Entropy

$H(S) = -\\sum_i p_i \\log_2 p_i$ is 0 for a pure set and 1 bit for a 50/50 split of two classes.

## Information gain

$$
IG(S, A) = H(S) - \\sum_{v} \\frac{|S_v|}{|S|} H(S_v)
$$

| Attribute | Gain |
| --- | --- |
| Outlook | 0.246 |
| Humidity | 0.151 |
| Wind | 0.048 |

<span style="color: red">Exam:</span> compute the gain of one attribute by hand.

## Exam practice

Humidity splits the 14 days into high (3 yes, 4 no, $H = 0.985$) and normal (6 yes, 1 no, $H = 0.592$).
`

const NOTEBOOKS = {
  'Machine Learning': [
    'B1 Linear regression',
    'B2 Decision trees',
    'B3 Ensembles',
    'B4 Neural networks'
  ],
  'Linear Algebra': ['L1 Vectors and spans', 'L2 Matrices', 'L3 Eigenvalues'],
  'Probability and Statistics': ['P1 Random variables', 'P2 Estimators'],
  Databases: ['D1 Relational model', 'D2 SQL']
}
const COLORS = {
  'Machine Learning': 'blue',
  'Linear Algebra': 'green',
  'Probability and Statistics': 'orange',
  Databases: 'teal'
}

let nextId = 0
const id = () => `promo-${++nextId}`

let seed = 7
const wobble = (amount) => {
  seed = (seed * 16807) % 2147483647
  return ((seed / 2147483647) * 2 - 1) * amount
}

// Starts at the upper left (t = -2.4) and runs clockwise, which the video's reveal follows.
const ELLIPSE_START = -2.4

function ellipse(box, color, pad = 10) {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const rx = box.width / 2 + pad
  const ry = box.height / 2 + pad
  const points = []
  for (let i = 0; i <= 44; i++) {
    const t = ELLIPSE_START + (i / 40) * Math.PI * 2
    points.push([cx + Math.cos(t) * (rx + wobble(1.5)), cy + Math.sin(t) * (ry + wobble(1.5)), 0.5])
  }
  return { id: id(), tool: 'pen', color, width: 3, points, author: 'me' }
}

function line(from, to, color) {
  const points = []
  for (let i = 0; i <= 12; i++) {
    const f = i / 12
    const bend = Math.sin(f * Math.PI) * 10
    points.push([
      from[0] + (to[0] - from[0]) * f,
      from[1] + (to[1] - from[1]) * f - bend + wobble(0.6),
      0.5
    ])
  }
  return { id: id(), tool: 'pen', color, width: 3, points, author: 'me' }
}

function arrow(from, to, color) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const head = (side) => [to[0] - Math.cos(angle + side) * 16, to[1] - Math.sin(angle + side) * 16]
  return [
    line(from, to, color),
    {
      id: id(),
      tool: 'pen',
      color,
      width: 3,
      author: 'me',
      points: [
        [...head(0.5), 0.5],
        [...to, 0.5],
        [...head(-0.5), 0.5]
      ]
    }
  ]
}

const textBox = (x, y, markdown, extra = {}) => ({
  id: id(),
  x,
  y,
  width: 400,
  markdown,
  author: 'me',
  ...extra
})

function annotations(marks) {
  const RED = '#cf222e'
  const BLUE = '#1f6feb'
  const right = 960 + 24
  return {
    3: {
      strokes: [
        ellipse(marks.overcast, RED, 12),
        ellipse(marks.outlook, BLUE, 10),
        ...arrow([right + 10, 128], [marks.outlook.x + marks.outlook.width + 22, 136], BLUE)
      ],
      highlights: [],
      textBoxes: [
        textBox(right + 20, 96, '**Root** = attribute with the highest gain, see slide 5'),
        textBox(marks.overcast.x - 62, marks.overcast.y + 62, 'Pure: 4 yes, 0 no, so $H = 0$', {
          width: 190,
          color: RED
        })
      ]
    },
    5: {
      strokes: [ellipse(marks.outlookBar, BLUE, 6)],
      highlights: [
        {
          id: id(),
          color: '#ffd33d',
          text: 'highest gain',
          rects: [
            [
              marks.highestGain.x - 2,
              marks.highestGain.y - 2,
              marks.highestGain.width + 4,
              marks.highestGain.height + 4
            ]
          ],
          author: 'me'
        }
      ],
      textBoxes: [
        textBox(right + 20, 110, '$IG = 0.940 - \\tfrac{10}{14} \\cdot 0.971 = 0.246$'),
        textBox(right + 20, 410, 'Outlook wins, so it becomes the **root**', { color: BLUE })
      ]
    }
  }
}

async function buildVault(dir) {
  const vault = path.join(dir, 'Notes')
  const userData = path.join(dir, 'profile')
  for (const [notebook, lectures] of Object.entries(NOTEBOOKS)) {
    for (const lecture of lectures)
      await fs.mkdir(path.join(vault, notebook, lecture), { recursive: true })
  }
  const lecture = path.join(vault, SECTION)
  const pdf = path.join(lecture, PDF)
  const marks = await makeDeck(pdf)
  const pdfSha256 = createHash('sha256')
    .update(await fs.readFile(pdf))
    .digest('hex')
  const sidecar = {
    version: 1,
    pdf: PDF,
    pdfSha256,
    marginWidth: MARGIN,
    pages: annotations(marks)
  }
  await fs.writeFile(pdf + '.annotations.json', JSON.stringify(sidecar, null, 2))
  await fs.writeFile(path.join(lecture, 'Decision trees.md'), NOTE)
  await fs.writeFile(
    path.join(lecture, 'Exercises.md'),
    '# Exercises\n\n1. Compute $H(S)$ for 6 yes, 2 no.\n'
  )
  await fs.mkdir(path.join(vault, '.marginalia'))
  await fs.writeFile(
    path.join(vault, '.marginalia/settings.json'),
    JSON.stringify({ notebookColors: COLORS })
  )
  await fs.mkdir(userData)
  await fs.writeFile(
    path.join(userData, 'config.json'),
    JSON.stringify({ recentVaults: [vault], settings: { theme: 'light' } })
  )
  return userData
}

async function launch(dir, userData) {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MARGINALIA_USER_DATA: userData,
      MARGINALIA_OFFSCREEN: '1',
      MARGINALIA_FAKE_CLAUDE: path.join(HERE, 'fakeClaude.mjs'),
      MARGINALIA_FAKE_LOG: path.join(dir, 'claude-log.json')
    }).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)
  )
  const app = await electron.launch({ args: ['.', '--force-device-scale-factor=3'], env })
  const page = await app.firstWindow()
  await page.emulateMedia({ colorScheme: 'light' })
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
  }, SIZE)
  return { app, page }
}

async function goToPage(page, n) {
  const box = page.getByRole('textbox', { name: 'Page' })
  await box.fill(String(n))
  await box.press('Enter')
}

async function settle(page) {
  await page.waitForTimeout(800)
  await page.evaluate(() => document.fonts.ready)
}

/** Boxes of the ink and text boxes on one slide, in window pixels, in the order they were made. */
function annotationBoxes(page, n) {
  return page.evaluate((n) => {
    const overlay = document.querySelector(`.pdf-page[data-page="${n}"] .page-overlay`)
    const box = (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return {
      ink: [...overlay.querySelectorAll('svg.ink > path')].map(box),
      textBoxes: [...overlay.querySelectorAll('.text-box')].map(box)
    }
  }, n)
}

const HIDE_ANNOTATIONS = '.page-overlay svg.ink, .page-overlay .text-box { visibility: hidden }'

async function capture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-promo-'))
  const userData = await buildVault(dir)
  const { app, page } = await launch(dir, userData)
  const row = (name) => page.locator('.tree-row', { hasText: name }).first()
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
  const editor = page.locator('.md-editor .cm-content')
  try {
    await row('Machine Learning').click()
    await row('B2 Decision trees').click()
    await row(PDF).click()
    await page.locator('.pdf-page[data-page="1"] canvas').first().waitFor()

    await goToPage(page, 3)
    await page.locator('.pdf-page[data-page="3"] canvas').first().waitFor()
    await settle(page)
    await shot('slides')
    const slides = await annotationBoxes(page, 3)
    const style = await page.addStyleTag({ content: HIDE_ANNOTATIONS })
    await shot('slides-clean')
    await style.evaluate((el) => el.remove())

    await page.keyboard.press('Control+L')
    const input = page.getByRole('textbox', { name: 'Message to Claude' })
    await input.fill('Why is Outlook the root of this tree?')
    const handle = await page.locator('.claude-resize').boundingBox()
    await page.mouse.move(handle.x + 200, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + 200, handle.y - 40, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    await shot('chat-ask')
    await input.press('Enter')
    await page.locator('.claude-answer .katex').first().waitFor()
    await page.locator('.claude-messages').evaluate((el) => (el.scrollTop = 0))
    await settle(page)
    await shot('chat-answer')
    await page.locator('.claude-panel').getByRole('button', { name: 'Close' }).click()

    await goToPage(page, 5)
    await page.keyboard.press('Control+Shift+M')
    await editor.waitFor()
    await page.locator('.md-editor .cm-scroller').evaluate((el) => (el.scrollTop = 0))
    await settle(page)
    await shot('lecture')

    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/claude work out the gain of Humidity', { delay: 10 })
    await settle(page)
    await shot('write-request')
    await page.keyboard.press('Enter')
    await page.locator('.cm-claude-writing').waitFor()
    await page.waitForTimeout(300)
    await shot('write-pending')
    await page.locator('.cm-claude-writing').waitFor({ state: 'detached' })
    await page.waitForTimeout(150)
    await shot('write-answer')

    // The window can end up a few pixels off SIZE, so store what the screenshots really show.
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await fs.writeFile(BOXES, JSON.stringify({ size, slides }, null, 2) + '\n')
  } finally {
    await app.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

await fs.mkdir(OUT, { recursive: true })
await capture()
console.log(`Screens written to ${OUT}`)
