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
  nodes: {
    id: string
    type: string
    text?: string
    x: number
    y: number
    width: number
    height: number
    file?: string
  }[]
  edges: {
    id: string
    fromNode: string
    toNode: string
    relation?: string
    toLabel?: string
    route?: string
  }[]
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
  // The relations show their arrow; the one pointed at says what it means.
  await panel.getByRole('button', { name: 'Relation: Arrow' }).click()
  const relations = panel.getByRole('listbox', { name: 'Relation' })
  await expect(relations.getByRole('option')).toHaveCount(8)
  await relations.getByRole('option', { name: /^Composition/ }).hover()
  await expect(panel.locator('.canvas-relation-meaning')).toContainText(
    'lives and dies with the whole'
  )
  // The whole list fits in the canvas.
  const menu = (await panel.locator('.canvas-relation-menu').boundingBox())!
  const view = (await surface().boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(view.y)
  expect(menu.y + menu.height).toBeLessThanOrEqual(view.y + view.height)
  await page.screenshot({ path: path.join('test-results', 'canvas-relations.png') })
  await relations.getByRole('option', { name: /^Aggregation/ }).click()
  await expect(relations).toBeHidden()
  await panel.locator('input[name="toLabel"]').fill('0..1')
  await panel.locator('input[name="toLabel"]').press('Enter')
  await page.screenshot({ path: path.join('test-results', 'canvas-edge-panel.png') })
  await expect
    .poll(async () => (await read('Shop.canvas')).edges.at(-1))
    .toMatchObject({ fromNode: 'line', toNode: 'vip', relation: 'aggregation', toLabel: '0..1' })
})

test('an arrow switched to right angles goes around boxes; the setting does it for new ones', async () => {
  await openShop()
  await page.locator('[data-edge="uses"] .canvas-edge-hit').click({ force: true })
  const panel = page.locator('.canvas-edge-panel')
  await panel.getByRole('radio', { name: 'Right angles' }).click()
  await expect(panel.getByRole('radio', { name: 'Right angles' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect
    .poll(async () => (await read('Shop.canvas')).edges.find((e) => e.id === 'uses')!.route)
    .toBe('elbow')
  const d = await page.locator('[data-edge="uses"] .canvas-edge-line').getAttribute('d')
  expect(d).not.toContain('C')
  await page.screenshot({ path: path.join('test-results', 'canvas-elbow.png') })

  // New arrows are curved until the setting says right angles.
  await surface().focus()
  await page.keyboard.press('Control+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings
    .getByRole('radiogroup', { name: 'New arrows' })
    .getByRole('radio', { name: 'Right angles' })
    .check()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  const dot = page.locator('[data-node="line"] .canvas-connect.c-left')
  await page.locator('[data-node="line"]').hover()
  const from = (await dot.boundingBox())!
  const target = (await page.locator('[data-node="vip"]').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width - 10, target.y + 40, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await read('Shop.canvas')).edges.at(-1)!.route).toBe('elbow')
})

test('typing operations in a subclass offers those of its parent', async () => {
  await fs.writeFile(
    file('Shapes.canvas'),
    JSON.stringify({
      nodes: [
        {
          id: 'shape',
          type: 'text',
          shape: 'class',
          text: '«interface»\nShape\n---\n+ area(): double\n+ perimeter(): double',
          x: 0,
          y: 0,
          width: 240,
          height: 120
        },
        {
          id: 'circle',
          type: 'text',
          shape: 'class',
          text: 'Circle\n---\n- radius: double\n---\n+ area(): double',
          x: 0,
          y: 260,
          width: 240,
          height: 140
        }
      ],
      edges: [{ id: 'r', fromNode: 'circle', toNode: 'shape', relation: 'realization' }]
    })
  )
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Shapes').click()
  const circle = page.locator('[data-node="circle"]')
  await circle.click()
  await page.keyboard.press('Enter')
  await expect(circle.locator('.canvas-editor')).toBeFocused()
  // The cursor is at the end, under the operations: a new line offers what is missing.
  await page.keyboard.press('Enter')
  await page.keyboard.type('+ p')
  const list = page.getByRole('listbox', { name: 'Operations from the parent' })
  await expect(list.getByRole('option')).toHaveText(['+ perimeter(): double'])
  await page.screenshot({ path: path.join('test-results', 'canvas-overrides.png') })
  await page.keyboard.press('Enter')
  await expect(list).toBeHidden()
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await read('Shapes.canvas')).nodes.find((n) => n.id === 'circle')!.text)
    .toBe('Circle\n---\n- radius: double\n---\n+ area(): double\n+ perimeter(): double')
})

test('pointing at an arrow says what it means, with the names of its boxes', async () => {
  await openShop()
  const tip = page.locator('.canvas-edge-tip')
  // The inheritance arrow from VipCustomer up to Customer.
  const line = (await page.locator('[data-edge="is"] .canvas-edge-line').boundingBox())!
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2)
  await expect(tip).toContainText('Inheritance: VipCustomer is a kind of Customer.')
  // It fades in after a moment, so passing over arrows does not flash tips.
  await expect(tip).toHaveCSS('opacity', '1')
  await page.screenshot({ path: path.join('test-results', 'canvas-edge-tip.png') })
  await page.mouse.move(line.x + 200, line.y + line.height / 2)
  await expect(tip).toHaveCount(0)
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

test('a moved or resized group lines up with another group', async () => {
  await fs.writeFile(
    file('Packages.canvas'),
    JSON.stringify({
      nodes: [
        { id: 'a', type: 'group', label: 'Domain', x: 0, y: 0, width: 300, height: 200 },
        { id: 'order', type: 'text', text: 'Order', x: 20, y: 40, width: 120, height: 60 },
        { id: 'b', type: 'group', label: 'UI', x: 500, y: 90, width: 300, height: 160 },
        { id: 'view', type: 'text', text: 'View', x: 520, y: 140, width: 120, height: 60 }
      ],
      edges: []
    })
  )
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Packages').click()
  await expect(page.locator('.canvas-node')).toHaveCount(4)
  const top = async (id: string): Promise<number> =>
    (await page.locator(`[data-node="${id}"]`).boundingBox())!.y

  // Let go a few pixels below the other group's top: it snaps level with it.
  const label = (await page.locator('[data-node="b"] .canvas-group-label').boundingBox())!
  const up = (await top('b')) - (await top('a')) - 3
  await page.mouse.move(label.x + 10, label.y + 8)
  await page.mouse.down()
  await page.mouse.move(label.x + 10, label.y + 8 - up, { steps: 6 })
  await expect(page.locator('.canvas-guide')).not.toHaveCount(0)
  await page.mouse.up()
  const group = async (id: string): Promise<{ y: number; height: number }> =>
    (await read('Packages.canvas')).nodes.find((n) => n.id === id)!
  await expect.poll(async () => (await group('b')).y).toBe(0)

  // Its bottom edge, dragged near the other group's bottom, snaps to it too.
  const handle = (await page.locator('[data-node="b"] [data-handle="s"]').boundingBox())!
  const a = (await page.locator('[data-node="a"]').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, a.y + a.height - 3, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await group('b')).height).toBe(200)
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
  await expect(page.locator('.rename-input')).toBeFocused()
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
    await expect(page.getByRole('button', { name: 'Shapes' })).toContainText(name)
  }
  const preview = page.locator('.canvas-node.preview')

  // Click: a class where I click (its ghost follows the mouse first), its name selected.
  await pick('Class')
  await page.mouse.move(view.x + view.width - 170, view.y + 110)
  await page.mouse.move(view.x + view.width - 160, view.y + 120)
  await expect(preview).toBeVisible()
  await page.screenshot({ path: path.join('test-results', 'canvas-shape-preview.png') })
  await page.mouse.click(view.x + view.width - 160, view.y + 120)
  await expect(preview).toBeHidden()
  await expect(page.locator('.canvas-editor')).toBeFocused()
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
  await expect(page.getByRole('button', { name: 'Shapes' })).not.toContainText('Note')
  await expect(preview).toHaveCount(0)

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

test('the canvas zoom speed setting makes Ctrl+wheel zoom further', async () => {
  await openShop()
  const view = (await surface().boundingBox())!
  const zoomValue = async (): Promise<number> =>
    Number((await page.locator('.canvas-zoom-value').textContent())!.replace('%', '')) / 100
  const zoomIn = async (): Promise<number> => {
    await surface().focus()
    await page.keyboard.press('Control+0')
    await expect.poll(zoomValue).toBe(1)
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect.poll(zoomValue).toBeGreaterThan(1)
    return zoomValue()
  }
  const normal = await zoomIn()

  await page.keyboard.press('Control+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Zoom speed for canvases' }).selectOption('2')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  const fast = await zoomIn()
  // Twice the speed: the same turn zooms twice as far on a log scale.
  expect(Math.log(fast)).toBeCloseTo(2 * Math.log(normal), 1)
})

test('zoomed out, a new class comes out big enough to read', async () => {
  await openShop()
  const view = (await surface().boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 600)
  await page.keyboard.up('Control')
  const zoom =
    Number((await page.locator('.canvas-zoom-value').textContent())!.replace('%', '')) / 100
  expect(zoom).toBeLessThan(0.5)
  await page.getByRole('button', { name: 'Shapes' }).click()
  await page.getByRole('group', { name: 'Shapes' }).getByRole('button', { name: 'Class' }).click()
  await page.mouse.click(view.x + 120, view.y + 120)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await read('Shop.canvas')).nodes.length).toBe(8)
  const added = (await read('Shop.canvas')).nodes.at(-1) as unknown as {
    width: number
    fontScale: number
  }
  // About as big on screen as a class added at 100%.
  expect(added.width * zoom).toBeGreaterThan(200)
  expect(added.fontScale).toBeGreaterThan(2)
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

test('copied boxes paste with their arrows, also into another canvas', async () => {
  await openShop()
  const view = (await surface().boundingBox())!
  // Order and its line, with the composition arrow between them.
  await page.locator('[data-node="order"]').click()
  await page.locator('[data-node="line"]').click({ modifiers: ['Shift'] })
  await page.keyboard.press('Control+C')
  await page.mouse.move(view.x + 60, view.y + view.height - 60)
  await page.keyboard.press('Control+V')
  await expect(page.locator('.canvas-node')).toHaveCount(9)
  await expect.poll(async () => (await read('Shop.canvas')).nodes.length).toBe(9)
  const saved = await read('Shop.canvas')
  expect(saved.edges).toHaveLength(5)
  const copies = saved.nodes.slice(-2)
  expect(copies.map((n) => (n as { text: string }).text.split('\n')[0])).toEqual([
    'Order',
    'OrderLine'
  ])
  expect(saved.edges.at(-1)).toMatchObject({ fromNode: copies[0].id, toNode: copies[1].id })

  // A whole group comes with what is inside it; Ctrl+X takes it away here.
  await page.locator('[data-node="domain"] .canvas-group-label').click()
  await page.keyboard.press('Control+X')
  await expect(page.locator('.canvas-node')).toHaveCount(4)
  await expect.poll(async () => (await read('Shop.canvas')).nodes.length).toBe(4)

  // Pasted from the right-click menu into a new canvas: the group and its four classes.
  await row('les_1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New canvas' }).click()
  await expect(page.locator('.rename-input')).toBeFocused()
  await page.keyboard.press('Enter')
  await row('Untitled canvas').click()
  await expect(page.locator('.canvas-hint')).toBeVisible()
  await surface().click({ button: 'right', position: { x: 200, y: 200 } })
  await page.getByRole('menuitem', { name: 'Paste' }).click()
  await expect(page.locator('.canvas-node')).toHaveCount(5)
  await expect(page.locator('.canvas-edge')).toHaveCount(3)
})

/** Double-clicks the middle of a word drawn inside `within`. */
async function dblclickWord(within: Locator, word: string): Promise<void> {
  const r = await within.evaluate((el, word) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(word)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + word.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }
    throw new Error(`No ${word}`)
  }, word)
  await page.mouse.dblclick(r.x, r.y)
}

test('a word double-clicked in a drawn class is selected, to type over', async () => {
  await openShop()
  const order = page.locator('[data-node="order"]')
  await dblclickWord(order.locator('.canvas-class-part').first(), 'placed')
  await expect(order.locator('.canvas-editor')).toBeFocused()
  await page.keyboard.type('created')
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'order')!.text)
    .toBe('Order\n---\n- created: Date\n---\n+ total(): float')

  // The same word in another compartment is another one.
  await dblclickWord(order.locator('.canvas-class-part').last(), 'total')
  await page.keyboard.type('sum')
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await read('Shop.canvas')).nodes.find((n) => n.id === 'order')!.text)
    .toBe('Order\n---\n- created: Date\n---\n+ sum(): float')
})

test('a moved box snaps to the same space as its neighbours and shows both spaces', async () => {
  const box = (id: string, x: number): object => ({
    id,
    type: 'text',
    text: id,
    x,
    y: 0,
    width: 100,
    height: 50
  })
  await fs.writeFile(
    file('Row.canvas'),
    JSON.stringify({ nodes: [box('a', 0), box('b', 140), box('c', 320)], edges: [] })
  )
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await row('Row').click()
  const c = page.locator('[data-node="c"]')
  await expect(c).toBeVisible()
  const zoom =
    Number((await page.locator('.canvas-zoom-value').textContent())!.replace('%', '')) / 100
  // 37 to the left would leave a space of 43; the other space is 40.
  const at = (await c.boundingBox())!
  await page.mouse.move(at.x + 20, at.y + 20)
  await page.mouse.down()
  await page.mouse.move(at.x + 20 - 37 * zoom, at.y + 20, { steps: 8 })
  await expect(page.locator('.canvas-guide.gap')).toHaveCount(2)
  await page.screenshot({ path: path.join('test-results', 'canvas-spacing.png') })
  await page.mouse.up()
  await expect(page.locator('.canvas-guide.gap')).toHaveCount(0)
  await expect
    .poll(async () => (await read('Row.canvas')).nodes.find((n) => n.id === 'c')!.x)
    .toBe(280)
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

test('a canvas dragged onto a folder moves there; dropped on slides it links to them', async () => {
  await fs.mkdir(file('../les_2'), { recursive: true })
  await makeSlides(file('../les_2/Patterns.pdf'), 3)
  await row('Design of Software Systems').click()
  await row('les_1').click()
  await expect(row('les_2')).toBeVisible()

  await row('Shop').dragTo(row('les_2'))
  await expect.poll(() => fs.readdir(file('../les_2'))).toContain('Shop.canvas')

  // les_2 opens by itself to show where it went; drop it on the middle of the slides.
  if (!(await row('Patterns').isVisible())) await row('les_2').click()
  await row('Shop').dragTo(row('Patterns'))
  await expect
    .poll(async () => {
      // Not there until something is linked in this new vault.
      const state = JSON.parse(
        await fs
          .readFile(path.join(env.vault, '.marginalia', 'state.json'), 'utf8')
          .catch(() => '{}')
      )
      return state.notes?.['Design of Software Systems/les_2/Patterns.pdf']
    })
    .toEqual(['Design of Software Systems/les_2/Shop.canvas'])
})
