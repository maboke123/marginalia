import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { createEnv, fakeLog, launch, makeSlides, type TestEnv } from './helpers'

let env: TestEnv
let app: ElectronApplication
let page: Page

const lesson = 'Design of Software Systems/les_1'
const file = (name: string): string => path.join(env.vault, lesson, name)

interface Saved {
  nodes: { id: string; type: string; text?: string; x: number; y: number; file?: string }[]
  edges: { id: string; fromNode: string; toNode: string; relation?: string; toLabel?: string }[]
}
const read = async (name: string): Promise<Saved> =>
  JSON.parse(await fs.readFile(file(name), 'utf8'))

// A small class diagram, as the canvas file would hold it.
const SHOP = {
  nodes: [
    {
      id: 'customer',
      type: 'text',
      shape: 'class',
      text: 'Customer\n---\n- name: String\n- email: String\n---\n+ placeOrder(): Order',
      x: 0,
      y: 0,
      width: 240,
      height: 150
    },
    {
      id: 'order',
      type: 'text',
      shape: 'class',
      text: 'Order\n---\n- placed: Date\n---\n+ total(): float',
      x: 420,
      y: 0,
      width: 220,
      height: 130,
      color: '4'
    },
    {
      id: 'line',
      type: 'text',
      shape: 'class',
      text: 'OrderLine\n---\n- quantity: int',
      x: 420,
      y: 260,
      width: 220,
      height: 90
    },
    {
      id: 'vip',
      type: 'text',
      shape: 'class',
      text: 'VipCustomer\n---\n- discount: float',
      x: 0,
      y: 260,
      width: 240,
      height: 90
    },
    {
      id: 'shopper',
      type: 'text',
      shape: 'actor',
      text: 'Shopper',
      x: -240,
      y: 20,
      width: 90,
      height: 130
    },
    {
      id: 'n1',
      type: 'text',
      shape: 'note',
      text: 'Prices in **EUR**, $p \\geq 0$',
      x: 720,
      y: 280,
      width: 200,
      height: 90
    },
    { id: 'domain', type: 'group', label: 'Shop', x: -40, y: -70, width: 720, height: 460 }
  ],
  edges: [
    {
      id: 'places',
      fromNode: 'customer',
      fromSide: 'right',
      toNode: 'order',
      toSide: 'left',
      relation: 'association',
      label: 'places',
      fromLabel: '1',
      toLabel: '0..*'
    },
    {
      id: 'has',
      fromNode: 'order',
      fromSide: 'bottom',
      toNode: 'line',
      toSide: 'top',
      relation: 'composition',
      toLabel: '1..*'
    },
    {
      id: 'is',
      fromNode: 'vip',
      fromSide: 'top',
      toNode: 'customer',
      toSide: 'bottom',
      relation: 'inheritance'
    },
    { id: 'uses', fromNode: 'shopper', toNode: 'customer', relation: 'dependency' }
  ]
}

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.join(env.vault, lesson), { recursive: true })
  await fs.writeFile(file('Shop.canvas'), JSON.stringify(SHOP))
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const surface = (): Locator => page.locator('.canvas-surface')

async function openShop(): Promise<void> {
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Shop').click()
  await expect(page.locator('.canvas-node')).toHaveCount(7)
}

test('a class diagram draws with its compartments, arrows and multiplicities', async () => {
  await openShop()
  await expect(page.locator('[data-node="order"] .canvas-class > *')).toHaveCount(3)
  await expect(page.locator('[data-node="n1"] .katex')).toHaveCount(1)
  await expect(page.locator('.canvas-edge')).toHaveCount(4)
  await expect(page.locator('[data-edge="has"] .canvas-marker.fill-line')).toHaveCount(1)
  await expect(page.locator('[data-edge="is"] .canvas-marker.fill-background')).toHaveCount(1)
  await expect(page.locator('.canvas-edge-label.to', { hasText: '0..*' })).toBeVisible()
  await page.screenshot({ path: path.join('test-results', 'canvas-class-diagram.png') })
})

test('double-click makes a box to type in; one undo takes it away', async () => {
  await openShop()
  const box = (await surface().boundingBox())!
  await page.mouse.dblclick(box.x + box.width - 120, box.y + 80)
  await page.keyboard.type('Payment')
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-node')).toHaveCount(8)
  await expect.poll(async () => (await read('Shop.canvas')).nodes.length).toBe(8)
  expect((await read('Shop.canvas')).nodes.at(-1)!.text).toBe('Payment')

  await page.keyboard.press('Control+Z')
  await expect(page.locator('.canvas-node')).toHaveCount(7)
  await expect.poll(async () => (await read('Shop.canvas')).nodes.length).toBe(7)
})

test('dragging from a box edge to another box connects them; the panel sets the relation', async () => {
  await openShop()
  await page.locator('[data-node="line"]').click()
  await page.screenshot({ path: path.join('test-results', 'canvas-selected.png') })
  const dot = page.locator('[data-node="line"] .canvas-connect.c-left')
  const from = (await dot.boundingBox())!
  const target = (await page.locator('[data-node="vip"]').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width - 10, target.y + 40, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.canvas-edge')).toHaveCount(5)
  const panel = page.locator('.canvas-edge-panel')
  await expect(panel).toBeVisible()
  await panel.locator('select').selectOption('aggregation')
  await panel.locator('input[name="toLabel"]').fill('0..1')
  await panel.locator('input[name="toLabel"]').press('Enter')
  await page.screenshot({ path: path.join('test-results', 'canvas-edge-panel.png') })
  await expect
    .poll(async () => (await read('Shop.canvas')).edges.at(-1))
    .toMatchObject({ fromNode: 'line', toNode: 'vip', relation: 'aggregation', toLabel: '0..1' })
})

test('moving a group moves what is inside, as one undo step', async () => {
  await openShop()
  const label = page.locator('[data-node="domain"] .canvas-group-label')
  const at = (await label.boundingBox())!
  await page.mouse.move(at.x + 10, at.y + 8)
  await page.mouse.down()
  await page.mouse.move(at.x + 110, at.y + 58, { steps: 6 })
  await page.mouse.up()
  const zoom =
    Number((await page.locator('.canvas-zoom-value').textContent())!.replace('%', '')) / 100
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'order')!.x)
    .toBeCloseTo(420 + 100 / zoom, -1)
  const moved = await read('Shop.canvas')
  // The actor outside the group stays.
  expect(moved.nodes.find((n) => n.id === 'shopper')!.x).toBe(-240)
  await surface().press('Control+Z')
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'order')!.x)
    .toBe(420)
})

test('zooming keeps the point under the mouse; fit shows everything', async () => {
  await openShop()
  const order = page.locator('[data-node="order"]')
  const before = (await order.boundingBox())!
  await page.mouse.move(before.x + 10, before.y + 10)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  const after = (await order.boundingBox())!
  expect(after.width).toBeGreaterThan(before.width * 1.3)
  // The point under the mouse is the same spot of the box, now drawn bigger.
  const share = (b: { x: number; width: number }): number => (before.x + 10 - b.x) / b.width
  expect(share(after)).toBeCloseTo(share(before), 2)
  await page.getByRole('button', { name: 'Zoom to fit' }).click()
  const view = (await surface().boundingBox())!
  for (const id of ['shopper', 'n1', 'line']) {
    const b = (await page.locator(`[data-node="${id}"]`).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(view.x)
    expect(b.x + b.width).toBeLessThanOrEqual(view.x + view.width)
  }
})

test('a new canvas from the folder menu, and a damaged one stays untouched', async () => {
  await fs.writeFile(file('Broken.canvas'), '{"nodes": [')
  await row('Design of Software Systems').click()
  await row('les_1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New canvas' }).click()
  await page.keyboard.press('Enter')
  await row('Untitled canvas').click()
  await expect(page.locator('.canvas-hint')).toBeVisible()
  expect(JSON.parse(await fs.readFile(file('Untitled canvas.canvas'), 'utf8'))).toEqual({
    nodes: [],
    edges: []
  })

  await row('Broken').click()
  await expect(page.locator('.pdf-message')).toContainText('Could not open this canvas')
  expect(await fs.readFile(file('Broken.canvas'), 'utf8')).toBe('{"nodes": [')
})

test('pen strokes close together become one drawing', async () => {
  await openShop()
  await surface().press('p')
  const box = (await surface().boundingBox())!
  const draw = async (x: number, y: number): Promise<void> => {
    await page.mouse.move(box.x + x, box.y + y)
    await page.mouse.down()
    await page.mouse.move(box.x + x + 40, box.y + y + 20, { steps: 5 })
    await page.mouse.up()
  }
  await draw(60, box.height - 120)
  await draw(80, box.height - 100)
  await expect(page.locator('.canvas-node.canvas-ink')).toHaveCount(1)
  await expect(page.locator('.canvas-ink path')).toHaveCount(2)
})

test('exports the whole canvas as a PDF', async () => {
  const target = path.join(env.dir, 'Shop.pdf')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, target)
  await openShop()
  await page.getByRole('button', { name: 'Export as PDF' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to', { timeout: 20_000 })
  const pdf = await fs.readFile(target)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
})

test('Claude draws classes on the open canvas after I accept, as one undo step', async () => {
  await fs.writeFile(file('Animals.canvas'), '{"nodes":[],"edges":[]}')
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Animals').click()
  await expect(page.locator('.canvas-hint')).toBeVisible()
  await page.keyboard.press('Control+L')
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await expect(page.getByRole('button', { name: 'Leave out Animals' })).toBeVisible()
  await input.fill('Draw the classes')
  await input.press('Enter')

  await expect(page.locator('.canvas-node.ghost')).toHaveCount(2)
  await expect(page.locator('.canvas-edge.ghost')).toHaveCount(1)
  await page.screenshot({ path: path.join('test-results', 'canvas-claude-ghost.png') })
  await page.locator('.canvas-ghost-bar').getByRole('button', { name: 'Accept' }).click()
  await expect(page.locator('.claude-answer').last()).toHaveText('Drew the classes.')
  await expect.poll(async () => (await read('Animals.canvas')).nodes.length).toBe(2)
  const saved = await read('Animals.canvas')
  expect(saved.edges[0]).toMatchObject({
    fromNode: 'dog',
    toNode: 'animal',
    relation: 'inheritance'
  })
  const log = JSON.parse(await fs.readFile(fakeLog(env), 'utf8'))
  const read_ = Object.values(log)
    .flat()
    .find((e) => (e as { question: string }).question === 'read_canvas') as { text: string }
  expect(read_.text).toContain('- box dog (class)')

  await surface().click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.canvas-node')).toHaveCount(0)
})

test('shapes come from the Shapes menu by click or drag, and the right-click menu changes them', async () => {
  await openShop()
  const view = (await surface().boundingBox())!
  const pick = async (name: string): Promise<void> => {
    await page.getByRole('button', { name: 'Shapes' }).click()
    const menu = page.getByRole('group', { name: 'Shapes' })
    await expect(menu).toBeVisible()
    await page.screenshot({ path: path.join('test-results', 'canvas-shapes-menu.png') })
    await menu.getByRole('button', { name, exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(page.locator('.canvas-place-bar')).toContainText(name.toLowerCase())
  }

  // Click: a class where I click, its placeholder name selected to type over.
  await pick('Class')
  await page.mouse.click(view.x + view.width - 160, view.y + 120)
  await expect(page.locator('.canvas-place-bar')).toBeHidden()
  await expect(page.locator('.canvas-edit-hint')).toContainText('A line with --- starts')
  await page.keyboard.type('Payment')
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.at(-1)!.text)
    .toMatch(/^Payment\n---\n/)

  // Drag: an actor drawn at the size I drag.
  await pick('Actor')
  const zoom =
    Number((await page.locator('.canvas-zoom-value').textContent())!.replace('%', '')) / 100
  await page.mouse.move(view.x + view.width - 200, view.y + view.height - 220)
  await page.mouse.down()
  await page.mouse.move(view.x + view.width - 100, view.y + view.height - 60, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.type('Clerk')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await read('Shop.canvas')).nodes.at(-1)!.text).toBe('Clerk')
  const actor = (await read('Shop.canvas')).nodes.at(-1) as unknown as { width: number }
  expect(actor.width).toBeCloseTo(100 / zoom, -1)

  // Esc puts a picked shape back.
  await pick('Note')
  await surface().press('Escape')
  await expect(page.locator('.canvas-place-bar')).toBeHidden()

  // Right-click a box: turn it into another shape.
  await page.locator('[data-node="n1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ellipse (use case)' }).click()
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'n1'))
    .toMatchObject({ shape: 'ellipse' })

  // A selected box has an Edit text button.
  await page.locator('[data-node="line"]').click()
  await page.getByRole('button', { name: 'Edit text' }).click()
  await expect(page.locator('[data-node="line"] .canvas-editor')).toBeFocused()
})

test('selected notes show as selected, also among others', async () => {
  await openShop()
  await surface().press('Control+A')
  const note = page.locator('[data-node="n1"]')
  await expect(note).toHaveClass(/selected/)
  await expect(note).toHaveCSS('outline-style', 'solid')
  await expect(note).toHaveCSS('clip-path', 'none')
})

test('double-clicking a class edits its text instead of adding a box', async () => {
  await openShop()
  await page.locator('[data-node="order"] .canvas-class-name').dblclick()
  await expect(page.locator('[data-node="order"] .canvas-editor')).toBeFocused()
  await expect(page.locator('.canvas-node')).toHaveCount(7)
  // Ctrl+B makes the selected word bold.
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('Control+B')
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'order')!.text)
    .toMatch(/^\*\*Order\*\*\n---/)
})

test('an arrow dragged near a box snaps to its side; dots show without selecting', async () => {
  await openShop()
  const line = (await page.locator('[data-node="line"]').boundingBox())!
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2)
  const dot = page.locator('[data-node="line"] .canvas-connect.c-left')
  await expect(dot).toBeVisible()
  const from = (await dot.boundingBox())!
  const vip = (await page.locator('[data-node="vip"]').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Beside the box, not on it.
  await page.mouse.move(vip.x + vip.width + 12, vip.y + vip.height / 2, { steps: 8 })
  await expect(page.locator('[data-node="vip"] .canvas-connect.c-right.landing')).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(async () => (await read('Shop.canvas')).edges.at(-1))
    .toMatchObject({ fromNode: 'line', toNode: 'vip', toSide: 'right' })
})

test('panned away from everything, one button brings the boxes back', async () => {
  await openShop()
  const box = (await surface().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 3000)
  const back = page.getByRole('button', { name: /Back to the boxes/ })
  await expect(back).toBeVisible()
  await back.click()
  await expect(back).toBeHidden()
  await expect(page.locator('[data-node="order"]')).toBeInViewport()
})

test('a canvas linked to slides shows under them and opens next to them', async () => {
  await makeSlides(file('Patterns.pdf'), 3)
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Shop').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Link to Patterns' }).click()
  // Under the PDF, one level deeper.
  const pdfRow = row('Patterns')
  const shopRow = row('Shop')
  await expect
    .poll(async () => {
      const [p, s] = [await pdfRow.boundingBox(), await shopRow.boundingBox()]
      return !!p && !!s && s.y > p.y && s.x >= p.x
    })
    .toBe(true)
  await expect
    .poll(async () => {
      const state = JSON.parse(
        await fs.readFile(path.join(env.vault, '.marginalia', 'state.json'), 'utf8')
      )
      return state.notes[`${lesson}/Patterns.pdf`]
    })
    .toEqual([`${lesson}/Shop.canvas`])

  await pdfRow.click()
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.canvas-surface')).toBeVisible()
  await expect(page.locator('.canvas-toolbar .note-switch')).toContainText('Shop')
})
