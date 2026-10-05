// A lecture deck for the README screenshots: real content, drawn with Segoe UI like a
// PowerPoint export. Returns where some phrases ended up, so annotations can sit on them.
import fontkit from '@pdf-lib/fontkit'
import { promises as fs } from 'fs'
import { PDFDocument, rgb } from 'pdf-lib'

const W = 960
const H = 540
const INK = rgb(0.13, 0.15, 0.18)
const MUTED = rgb(0.42, 0.45, 0.5)
const ACCENT = rgb(0.11, 0.32, 0.55)
const LINE = rgb(0.8, 0.82, 0.85)
const FONTS = 'C:/Windows/Fonts'

export async function makeDeck(file) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = async (name) =>
    doc.embedFont(await fs.readFile(`${FONTS}/${name}`), { subset: true })
  const regular = await font('segoeui.ttf')
  const semibold = await font('seguisb.ttf')
  const italic = await font('segoeuii.ttf')
  const marks = {}
  let pageNo = 0

  const slide = (title) => {
    const page = doc.addPage([W, H])
    pageNo++
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT })
    if (title) page.drawText(title, { x: 60, y: H - 88, size: 34, font: semibold, color: INK })
    const footer = 'Machine Learning  |  B2 Decision trees'
    page.drawText(footer, { x: 60, y: 24, size: 11, font: regular, color: MUTED })
    const n = String(pageNo)
    page.drawText(n, {
      x: W - 60 - regular.widthOfTextAtSize(n, 11),
      y: 24,
      size: 11,
      font: regular,
      color: MUTED
    })
    return page
  }

  /** Draws text and returns its box in annotation coordinates (top-left origin). */
  const text = (page, s, x, y, size, f = regular, color = INK) => {
    page.drawText(s, { x, y, size, font: f, color })
    const width = f.widthOfTextAtSize(s, size)
    return { x, y: H - y - size * 0.78, width, height: size * 1.05, end: x + width }
  }

  /** A run of formula pieces: [text, style] with style r(egular), i(talic), sub, isub or big. */
  const formula = (page, x, y, size, runs) => {
    for (const [s, style] of runs) {
      const f = style === 'i' || style === 'isub' ? italic : regular
      const sub = style === 'sub' || style === 'isub'
      const sz = sub ? size * 0.62 : style === 'big' ? size * 1.45 : size
      const dy = sub ? -size * 0.28 : style === 'big' ? -size * 0.18 : 0
      page.drawText(s, { x, y: y + dy, size: sz, font: f, color: INK })
      x += f.widthOfTextAtSize(s, sz)
    }
    return x
  }

  const bullets = (page, items, y, size = 22, gap = 42) => {
    const boxes = []
    for (const item of items) {
      page.drawCircle({ x: 72, y: y + size * 0.32, size: 3.5, color: ACCENT })
      boxes.push(text(page, item, 90, y, size))
      y -= gap
    }
    return boxes
  }

  // 1
  const title = slide(null)
  title.drawText('Decision trees', { x: 60, y: 300, size: 56, font: semibold, color: INK })
  title.drawText('Machine Learning, lecture B2', {
    x: 60,
    y: 252,
    size: 24,
    font: regular,
    color: MUTED
  })
  title.drawText('Academic year 2026-2027', {
    x: 60,
    y: 220,
    size: 18,
    font: regular,
    color: MUTED
  })

  // 2
  bullets(
    slide('What is a decision tree?'),
    [
      'Every internal node tests one attribute',
      'Every branch is one value of that attribute',
      'Every leaf predicts a class',
      'Learned top-down and greedily (ID3, C4.5, CART)',
      'Easy to read: a tree is a set of if-then rules'
    ],
    390
  )

  // 3: the Play Tennis tree
  const tree = slide('Example: play tennis?')
  const node = (label, cx, cy, leaf) => {
    const f = leaf ? regular : semibold
    const w = f.widthOfTextAtSize(label, 18) + 36
    tree.drawRectangle({
      x: cx - w / 2,
      y: cy - 18,
      width: w,
      height: 36,
      color: leaf ? rgb(0.95, 0.96, 0.97) : rgb(0.9, 0.94, 0.98),
      borderColor: leaf ? LINE : ACCENT,
      borderWidth: 1.2
    })
    tree.drawText(label, { x: cx - w / 2 + 18, y: cy - 6, size: 18, font: f, color: INK })
    return { x: cx - w / 2, y: H - cy - 18, width: w, height: 36 }
  }
  const edge = (x1, y1, x2, y2, label) => {
    tree.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.2, color: MUTED })
    const lx =
      (x1 + x2) / 2 + (x2 < x1 ? -regular.widthOfTextAtSize(label, 14) - 8 : x2 > x1 ? 8 : 6)
    tree.drawText(label, { x: lx, y: (y1 + y2) / 2, size: 14, font: italic, color: MUTED })
  }
  marks.outlook = node('Outlook', 480, 400)
  edge(480, 382, 250, 298, 'Sunny')
  edge(480, 382, 480, 298, 'Overcast')
  edge(480, 382, 710, 298, 'Rain')
  node('Humidity', 250, 280)
  marks.overcast = node('Yes', 480, 280, true)
  node('Wind', 710, 280)
  edge(250, 262, 170, 178, 'High')
  edge(250, 262, 330, 178, 'Normal')
  edge(710, 262, 630, 178, 'Strong')
  edge(710, 262, 790, 178, 'Weak')
  node('No', 170, 160, true)
  node('Yes', 330, 160, true)
  node('No', 630, 160, true)
  node('Yes', 790, 160, true)
  text(tree, '14 days, 9 yes and 5 no. Quinlan (1986).', 60, 76, 15, regular, MUTED)

  // 4: entropy
  const entropy = slide('Entropy')
  const eEnd = formula(entropy, 60, 370, 30, [
    ['H', 'i'],
    ['(', 'r'],
    ['S', 'i'],
    [')  =  \u2212', 'r'],
    [' \u03a3', 'big'],
    ['i', 'isub'],
    ['  ', 'r'],
    ['p', 'i'],
    ['i', 'isub'],
    [' log', 'r'],
    ['2', 'sub'],
    [' ', 'r'],
    ['p', 'i'],
    ['i', 'isub']
  ])
  marks.entropyFormula = { x: 56, y: H - 370 - 34, width: eEnd - 52, height: 46 }
  const eb = bullets(
    entropy,
    [
      'H = 0 when every example has the same class',
      'H = 1 bit for two classes split 50/50',
      'Play tennis: 9 yes, 5 no, so H(S) = 0.940'
    ],
    270
  )
  marks.entropyExample = eb[2]

  // 5: information gain
  const gain = slide('Information gain')
  formula(gain, 60, 380, 28, [
    ['IG', 'i'],
    ['(', 'r'],
    ['S', 'i'],
    [', ', 'r'],
    ['A', 'i'],
    [')  =  ', 'r'],
    ['H', 'i'],
    ['(', 'r'],
    ['S', 'i'],
    [')  \u2212', 'r'],
    [' \u03a3', 'big'],
    ['v', 'isub'],
    ['  |', 'r'],
    ['S', 'i'],
    ['v', 'isub'],
    ['| / |', 'r'],
    ['S', 'i'],
    ['|  ', 'r'],
    ['H', 'i'],
    ['(', 'r'],
    ['S', 'i'],
    ['v', 'isub'],
    [')', 'r']
  ])
  text(gain, 'Expected drop in entropy after splitting on A.', 60, 330, 20, regular, MUTED)
  text(gain, 'ID3 splits on the attribute with the', 60, 280, 20)
  marks.highestGain = text(
    gain,
    'highest gain',
    60 + regular.widthOfTextAtSize('ID3 splits on the attribute with the ', 20),
    280,
    20
  )
  text(gain, 'Gain on the full play tennis set', 60, 220, 16, semibold, MUTED)
  const gains = [
    ['Outlook', 0.246],
    ['Humidity', 0.151],
    ['Wind', 0.048],
    ['Temperature', 0.029]
  ]
  gains.forEach(([name, value], i) => {
    const y = 180 - i * 34
    gain.drawText(name, { x: 60, y, size: 16, font: regular, color: INK })
    gain.drawRectangle({
      x: 180,
      y: y - 3,
      width: value * 1400,
      height: 20,
      color: i === 0 ? ACCENT : LINE
    })
    gain.drawText(value.toFixed(3), {
      x: 190 + value * 1400,
      y,
      size: 16,
      font: regular,
      color: INK
    })
    if (i === 0)
      marks.outlookBar = { x: 56, y: H - y - 20, width: 190 + value * 1400 + 50 - 56, height: 30 }
  })

  // 6
  bullets(
    slide('Overfitting'),
    [
      'A deep tree can fit every training example, noise included',
      'Pre-pruning: stop at a maximum depth or minimum leaf size',
      'Post-pruning: grow the full tree, then cut back subtrees',
      'Keep a cut when accuracy on a validation set does not drop'
    ],
    390
  )

  // 7
  bullets(
    slide('Summary'),
    [
      'Trees split greedily on the attribute with the highest gain',
      'Entropy measures how mixed a set of labels is',
      'Prune to generalise: shallower trees overfit less',
      'Next lecture: bagging and random forests'
    ],
    390
  )

  await fs.writeFile(file, await doc.save())
  return marks
}
