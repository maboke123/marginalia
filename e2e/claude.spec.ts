import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createEnv, fakeLog, launch, makeSlides, type TestEnv } from './helpers'

// The app runs with the scripted agent from e2e/fakeClaude.mjs: these tests cover everything
// around Claude (context, streaming, tools, previews, undo, sessions) without calling it.

let env: TestEnv
let app: ElectronApplication
let page: Page
let slides: string

const section = 'Machine Learning/B2 Decision trees'
const pdfRel = `${section}/slides.pdf`
const summaryFile = (): string => path.join(env.vault, section, 'Summary.md')
const SUMMARY = [
  '# Decision trees',
  '',
  '## Information gain',
  '',
  'Gain is $IG(S,t)$.',
  '',
  '## Pruning',
  '',
  'Later.',
  ''
].join('\n')

test.beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-slides-'))
  slides = path.join(dir, 'slides.pdf')
  await makeSlides(slides, 8)
})

test.beforeEach(async () => {
  env = await createEnv()
  await fs.mkdir(path.join(env.vault, section), { recursive: true })
  await fs.mkdir(path.join(env.vault, 'Machine Learning/B3 Ensembles'))
  await fs.writeFile(
    path.join(env.vault, 'Machine Learning/B3 Ensembles/Bagging.md'),
    '# Bagging\n'
  )
  await fs.copyFile(slides, path.join(env.vault, pdfRel))
  await fs.writeFile(summaryFile(), SUMMARY)
  ;({ app, page } = await launch(env))
})

test.afterEach(async () => {
  await app.close()
  await fs.rm(env.dir, { recursive: true, force: true })
})

const row = (name: string): Locator => page.locator('.tree-row', { hasText: name })
const answers = (): Locator => page.locator('.claude-answer')
const readSummary = (): Promise<string> => fs.readFile(summaryFile(), 'utf8')

interface LogEntry {
  text: string
  images: number
  question: string
  instructions: string
  readFolders: string[]
  memory: { me: string; course: string; courseNote: string }
}

async function readLog(): Promise<LogEntry[]> {
  const log = JSON.parse(await fs.readFile(fakeLog(env), 'utf8').catch(() => '{}'))
  return Object.values(log).flat() as LogEntry[]
}

async function openSlides(pageNumber = 1): Promise<void> {
  // After a restart the folders may already be open; clicking would close them.
  await expect(row('Machine Learning')).toBeVisible()
  if (!(await row('slides.pdf').isVisible())) {
    await row('Machine Learning').click()
    await row('B2 Decision trees').first().click()
  }
  await row('slides.pdf').click()
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeAttached()
  if (pageNumber > 1) {
    await page.getByRole('textbox', { name: 'Page' }).fill(String(pageNumber))
    await page.getByRole('textbox', { name: 'Page' }).press('Enter')
    await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue(String(pageNumber))
  }
}

async function ask(question: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  if (!(await input.isVisible())) await page.keyboard.press('Control+L')
  await input.fill(question)
  await input.press('Enter')
}

test('answers about the slide on screen, with that slide sent along', async () => {
  await openSlides(3)
  await page.keyboard.press('Control+L')
  await expect(page.getByRole('textbox', { name: 'Message to Claude' })).toBeFocused()
  await expect(page.locator('.chip')).toHaveText(['slides.pdf · p.3'])

  await ask('Explain this formula')
  await expect(answers().locator('strong')).toHaveText('information gain')
  await expect(answers().locator('.katex')).toBeVisible()
  await expect(page.locator('.claude-sent-context')).toHaveText('slides.pdf · p.3')

  const [first] = await readLog()
  expect(first.question).toBe('Explain this formula')
  expect(first.images).toBe(1)
  expect(first.text).toContain(`Slides: ${pdfRel}, page 3 of 8.`)
  expect(first.text).toMatch(/<page-text>\nSlide 3\s*\nInformation gain = H\(S\)/)

  // A second question about the same slide does not send its image again.
  await ask('And in words?')
  await expect(answers()).toHaveCount(2)
  expect((await readLog())[1].images).toBe(0)

  const state = JSON.parse(
    await fs.readFile(path.join(env.vault, '.marginalia/state.json'), 'utf8')
  )
  expect(Object.keys(state.chats)).toEqual([section])
  await page.screenshot({ path: path.join('test-results', 'claude-panel.png') })
})

test('the panel moves to the right of the panes from the settings', async () => {
  await openSlides(3)
  await ask('Explain this formula')
  await expect(answers()).toHaveCount(1)
  const panel = page.locator('.claude-panel')
  await expect(panel).not.toHaveClass(/right/)

  await page.keyboard.press('Control+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('radio', { name: 'On the right' }).check()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toHaveClass(/right/)
  // The conversation stays, next to the slides at the full height of the window.
  await expect(answers()).toHaveCount(1)
  const box = (await panel.boundingBox())!
  const slides = (await page.locator('.pdf-viewer').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(slides.x + slides.width - 1)
  expect(box.height).toBeGreaterThan(slides.height - 1)

  // Dragging its left edge makes it wider.
  const handle = (await panel.locator('.claude-resize').boundingBox())!
  await page.mouse.move(handle.x + 3, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(handle.x - 97, handle.y + 200)
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(box.width + 100, 0)
  await page.screenshot({ path: path.join('test-results', 'claude-panel-right.png') })
})

test('images pasted, dropped or picked in the chat go along, big ones made smaller', async () => {
  await openSlides(2)
  await ask('What is on this slide?')
  await expect(answers()).toHaveCount(1)

  // A wide screenshot on the clipboard.
  await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
    const [width, height] = [3000, 1000]
    const pixels = Buffer.alloc(width * height * 4, 0x60)
    const png = nativeImage.createFromBitmap(pixels, { width, height }).toPNG()
    const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await input.focus()
  await page.keyboard.press('Control+v')
  const pending = page.getByLabel('Images sent with your message').locator('img')
  await expect(pending).toHaveCount(1)

  // And one dropped from Explorer.
  await page.locator('.claude-compose').evaluate(async (el) => {
    const canvas = new OffscreenCanvas(200, 100)
    canvas.getContext('2d')!.fillRect(0, 0, 200, 100)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const data = new DataTransfer()
    data.items.add(new File([blob], 'tree.png', { type: 'image/png' }))
    for (const type of ['dragover', 'drop']) {
      el.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
    }
  })
  await expect(pending).toHaveCount(2)

  // And one picked with the button, from a folder on this computer.
  const photo = path.join(env.dir, 'whiteboard.png')
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 80 } })
  await fs.writeFile(photo, png)
  // In device pixels, so 150x100 at 125% display scaling.
  const photoSize = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add images' }).click()
  await (await chooser).setFiles(photo)
  await expect(pending).toHaveCount(3)
  await page.screenshot({ path: path.join('test-results', 'claude-images.png') })

  await ask('Which tree is deeper?')
  await expect(answers()).toHaveCount(2)
  await expect(pending).toHaveCount(0)
  await expect(page.locator('.claude-message.user').last().locator('img')).toHaveCount(3)
  const sent = (await readLog())[1] as LogEntry & { imageSizes: string[] }
  // The slide's image was already sent with the first question.
  expect(sent.imageSizes).toEqual(['1568x523', '200x100', photoSize])
  // Nothing was imported into the vault.
  expect(await fs.readdir(path.join(env.vault, section))).not.toContain('tree.png')
})

test('text selected on the slide or in a text box goes along with the question', async () => {
  await openSlides(1)
  const slide = page.locator('.pdf-page[data-page="1"]')
  await slide.locator('.textLayer span', { hasText: 'Information gain' }).click({ clickCount: 3 })
  await ask('What does this mean?')
  await expect(answers()).toHaveCount(1)
  expect((await readLog())[0].text).toContain('Selected on page 1: "Information gain = H(S) - sum')

  // Typed in a box, then selected: the box's text is what goes along.
  await slide.click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('t')
  const box = (await slide.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.6)
  await page.keyboard.type('Gini impurity is smallest for pure splits')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Control+L')
  await expect(page.locator('.chip', { hasText: 'Gini impurity' })).toHaveAttribute(
    'title',
    'Text selected in a text box'
  )
  await ask('Is this right?')
  await expect(answers()).toHaveCount(2)
  expect((await readLog())[1].text).toContain(
    'Selected in a text box on page 1: "Gini impurity is smallest for pure splits"'
  )
})

test('a narrow chat on the right never scrolls sideways, and Ctrl+wheel zooms it', async () => {
  await openSlides(3)
  await page.keyboard.press('Control+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('radio', { name: 'On the right' }).check()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await ask('Compare the methods')
  const answer = answers().first()
  await expect(answer.locator('.diagram svg')).toBeVisible()

  // As narrow as it goes.
  const panel = page.locator('.claude-panel')
  const handle = (await panel.locator('.claude-resize').boundingBox())!
  await page.mouse.move(handle.x + 3, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(handle.x + 600, handle.y + 200, { steps: 5 })
  await page.mouse.up()
  const messages = page.locator('.claude-messages')
  await expect
    .poll(() => messages.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(0)
  await page.screenshot({ path: path.join('test-results', 'claude-panel-narrow.png') })
  // Its header fits: the last buttons are not cut off.
  const box = (await panel.boundingBox())!
  const width = await page.evaluate(() => window.innerWidth)
  for (const name of ['Claude settings', 'Close']) {
    const button = (await panel.getByRole('button', { name, exact: true }).boundingBox())!
    expect(button.x + button.width).toBeLessThanOrEqual(Math.min(box.x + box.width, width))
  }

  const size = (): Promise<number> =>
    answer
      .locator('td')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height)
  const before = await size()
  const m = (await messages.boundingBox())!
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  await expect.poll(size).toBeGreaterThan(before * 1.3)
  await expect
    .poll(() => page.evaluate(() => Number(localStorage.getItem('chatZoom'))))
    .toBeGreaterThan(1.3)
})

test('Claude previews how a note comes out as a PDF', async () => {
  await openSlides(1)
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.md-editor .cm-content')).toBeVisible()
  await ask('How long is the PDF going to be?')
  await expect(answers()).toContainText(`${section}/Summary.md exports to 1 A4 page.`, {
    timeout: 20_000
  })
  await expect(page.locator('.claude-tool')).toContainText('Previewed Summary.md as a PDF')
  expect((await readLog()).find((e) => e.question === 'preview')?.images).toBe(1)
})

test('a folder opens in VS Code with the lesson chat, and that chat comes back', async () => {
  test.setTimeout(60_000)
  await app.evaluate(({ app: electronApp, shell }) => {
    const g = globalThis as { opened?: string[] }
    g.opened = []
    electronApp.getApplicationNameForProtocol = () => 'Visual Studio Code'
    shell.openExternal = async (url: string) => {
      g.opened!.push(url)
    }
  })
  const opened = (): Promise<string[]> =>
    app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])
  await fs.mkdir(path.join(env.vault, section, 'exercise code'))
  await openSlides(1)
  await ask('Explain this formula')
  await expect(answers()).toHaveCount(1)

  await row('exercise code').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in VS Code' }).click()
  // The chat link goes twice, for a VS Code window that was slow to start.
  await expect.poll(opened, { timeout: 30_000 }).toHaveLength(3)
  const state = JSON.parse(
    await fs.readFile(path.join(env.vault, '.marginalia/state.json'), 'utf8')
  )
  const copy: string = state.chats[section]
  expect(copy).toMatch(/-vscode$/)
  const folder = path.join(env.vault, section, 'exercise code').replace(/\\/g, '/')
  expect(await opened()).toEqual([
    `vscode://file/${folder.replace(/ /g, '%20')}/?windowId=_blank`,
    `vscode://anthropic.claude-code/open?session=${copy}`,
    `vscode://anthropic.claude-code/open?session=${copy}`
  ])
  const log = JSON.parse(await fs.readFile(fakeLog(env), 'utf8'))
  expect(log[copy].at(-1).cwd).toBe(path.join(env.vault, section, 'exercise code'))

  // Something asked in VS Code shows in the app's chat once I come back to it.
  log[copy].push({ question: 'Why is my loop off by one?' })
  await fs.writeFile(fakeLog(env), JSON.stringify(log))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.claude-question').last()).toHaveText('Why is my loop off by one?')

  await ask('What did we find in VS Code?')
  await expect
    .poll(async () => (await readLog()).at(-1)?.question)
    .toBe('What did we find in VS Code?')
  const after = JSON.parse(await fs.readFile(fakeLog(env), 'utf8'))
  expect(after[copy].at(-1).question).toBe('What did we find in VS Code?')
})

test('Stop ends an answer that is stuck, and the chat takes the next question', async () => {
  await openSlides(1)
  await ask('Please get stuck')
  await expect(answers()).toHaveText('Working on it')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 5000 })
  await ask('Still there?')
  await expect(answers().last()).toHaveText('You asked: Still there?')
})

test('my instructions and the lesson colours go along with a question', async () => {
  await fs.mkdir(path.join(env.vault, '.marginalia'), { recursive: true })
  await fs.writeFile(
    path.join(env.vault, '.marginalia/settings.json'),
    JSON.stringify({ notebookColors: { [section]: 'orange' } })
  )
  await openSlides()
  await page.keyboard.press('Control+L')
  await page.getByRole('button', { name: 'Claude settings' }).click()
  await page.getByRole('textbox', { name: 'Instructions for Claude' }).fill('Orange: followed.')
  // A folder outside the vault, like the code of a project.
  const code = path.join(env.dir, 'oss-project')
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, code)
  await page.getByRole('button', { name: 'Add a folder...' }).click()
  await expect(page.locator('.claude-read-folders')).toContainText('oss-project')
  await page.getByRole('button', { name: 'Done' }).click()

  await ask('Where am I?')
  await expect(answers()).toHaveCount(1)
  const [first] = await readLog()
  expect(first.instructions).toBe('Orange: followed.')
  expect(first.readFolders).toEqual([code])
  expect(first.text).toContain(`Folder colours: ${section}: orange`)
})

test('Claude remembers how I like things, per course, and I can edit it', async () => {
  const memory = (file: string): Promise<string> =>
    fs.readFile(path.join(env.userData, 'memory', file), 'utf8').catch(() => '')
  await openSlides()
  await ask('remember: - Likes short bullet summaries')
  await expect(answers().last()).toHaveText('Saved the note about Machine Learning')
  await expect(page.locator('.claude-tool').last()).toContainText(
    'Updated what it remembers about this course'
  )
  await ask('remember me: - Writes in Dutch and English')
  await expect(answers().last()).toHaveText('Saved the note about me')
  expect(await memory('courses/Machine Learning.md')).toBe('- Likes short bullet summaries\n')
  expect(await memory('me.md')).toBe('- Writes in Dutch and English\n')

  // The next question carries both notes.
  await ask('Where am I?')
  await expect(answers()).toHaveCount(3)
  expect((await readLog()).at(-1)!.memory).toEqual({
    me: '- Writes in Dutch and English\n',
    course: 'Machine Learning',
    courseNote: '- Likes short bullet summaries\n'
  })

  // Settings open at the note of the course on screen.
  await page.getByRole('button', { name: 'Claude settings' }).click()
  await expect(page.getByRole('combobox', { name: 'Memory about' })).toHaveValue('Machine Learning')
  const note = page.getByRole('textbox', { name: 'Memory', exact: true })
  await expect(note).toHaveValue('- Likes short bullet summaries\n')
  await note.fill('- Likes short summaries with one example')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect
    .poll(() => memory('courses/Machine Learning.md'))
    .toBe('- Likes short summaries with one example\n')
})

test('/uml learns the course by itself, and from my rules and my changes to its diagrams', async () => {
  const skills = path.join(env.userData, 'skills', 'uml', 'courses')
  const shop = path.join(env.vault, section, 'Shop.canvas')
  await fs.writeFile(
    path.join(env.vault, section, 'Transcript 2026-10-06 10-30.md'),
    '# Transcript 6 October 2026, 10:30\n\n**00:12** Start with the domain model.\n'
  )
  await fs.writeFile(shop, '{"nodes":[],"edges":[]}\n')
  await fs.copyFile(slides, path.join(env.vault, 'Machine Learning/B3 Ensembles/ensembles.pdf'))
  await openSlides()

  // Nothing is learned until I pick the one course; then it goes through it lesson by lesson.
  await page.keyboard.press('Control+L')
  await page.getByRole('button', { name: 'Claude settings' }).click()
  await expect(page.getByRole('combobox', { name: 'Course to learn' })).toHaveValue(
    'Machine Learning'
  )
  await page.getByRole('button', { name: 'Learn this course' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join('test-results', 'claude-playbook-start.png') })
  await page.getByRole('button', { name: 'Learn this course' }).click()
  await expect(page.getByText('Up to date.')).toBeVisible()
  // No other course can be picked any more.
  await expect(page.getByRole('combobox', { name: 'Course to learn' })).toBeHidden()
  await expect(page.locator('.playbook-course')).toHaveText('Machine Learning')
  await expect(page.locator('.playbook-files > summary')).toHaveText(
    /^Files: (\d+) of \1 taken in$/
  )
  await expect(page.locator('.playbook-lesson li', { hasText: 'slides.pdf' })).toContainText(
    'Taken in'
  )
  await page.getByText('Its notes of this lesson').first().click()
  await expect(page.locator('.playbook-notes .playbook-markdown').first()).toContainText(
    'Domain model first'
  )
  await page.locator('.playbook-files').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join('test-results', 'claude-playbook-learned.png') })
  await expect(
    page.getByRole('textbox', { name: /^Summary that goes along with \/uml/ })
  ).toHaveValue(
    '- Domain model first (Machine Learning/B2 Decision trees)\n' +
      '- Domain model first (Machine Learning/B3 Ensembles)\n'
  )
  await expect(page.getByText('What the last run changed (B3 Ensembles')).toBeVisible()
  const runs = (await readLog()).filter((e) => e.question === 'learn')
  expect(runs).toHaveLength(2)
  expect(runs[0].text).toContain(`- ${section}/slides.pdf (slides or other PDF, new)`)
  expect(runs[0].text).toContain(`- ${section}/Transcript 2026-10-06 10-30.md (transcript, new)`)
  expect(runs[0].text).toContain(`- ${section}/Shop.canvas (my diagram, new)`)
  expect((runs[0] as LogEntry & { read: boolean }).read).toBe(true)
  // After the first time it learns only when I ask, unless I turn that on.
  const auto = page.getByRole('checkbox', { name: 'Take in new and changed files by itself' })
  await expect(auto).not.toBeChecked()
  await auto.check()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(skills, 'Machine Learning.json'), 'utf8')).auto
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Done' }).click()

  // A /uml message has the playbook and my rules along; a rule I give is kept.
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await input.fill('/uml')
  await expect(page.locator('.claude-picker li', { hasText: '/uml review' })).toBeVisible()
  await ask('/uml draw an order with its lines, never put getters in a class')
  await page
    .locator('.claude-proposal')
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  await expect(answers().last()).toHaveText(
    'Playbook: - Domain model first (Machine Learning/B2 Decision trees) Rules: (none yet)'
  )
  await expect
    .poll(() => fs.readFile(path.join(skills, 'Machine Learning.rules.md'), 'utf8'))
    .toBe('- Never put getters in a class\n')

  // I change its aggregation into a composition; the next /uml sees that, once.
  const drawn = JSON.parse(await fs.readFile(shop, 'utf8'))
  expect(drawn.edges).toHaveLength(1)
  drawn.edges[0].relation = 'composition'
  await fs.writeFile(shop, JSON.stringify(drawn))
  await ask('/uml what next')
  await expect(answers()).toHaveCount(2)
  const packet = (await readLog()).at(-1)!.text
  expect(packet).toContain('Since you drew them, I changed your diagrams like this:')
  expect(packet).toContain('- The arrow "Order" -> "OrderLine": aggregation became composition')
  await expect
    .poll(() => fs.readFile(path.join(skills, 'Machine Learning.rules.md'), 'utf8'))
    .toBe('- Never put getters in a class\n- Order lines are a composition\n')
  await ask('/uml and now')
  await expect(answers()).toHaveCount(3)
  expect((await readLog()).at(-1)!.text).not.toContain('Since you drew them')
  // The chat has the playbook already: it goes along again only when it changed.
  await ask('/uml one more')
  await expect(answers()).toHaveCount(4)
  const again = (await readLog()).at(-1)!.text
  expect(again).not.toContain('<playbook>')
  expect(again).toContain('and my rules are as in my earlier /uml message in this chat')

  await page.getByRole('button', { name: 'Claude settings' }).click()
  await expect(page.getByRole('textbox', { name: 'My rules' })).toHaveValue(
    '- Never put getters in a class\n- Order lines are a composition\n'
  )
  await page.getByRole('textbox', { name: 'My rules' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join('test-results', 'claude-playbook.png') })
})

test('/uml learns only its one course; feedback rules say who gave them', async () => {
  const skills = path.join(env.userData, 'skills', 'uml', 'courses')
  await fs.mkdir(skills, { recursive: true })
  const learns = (course: string): Promise<void> =>
    fs.writeFile(path.join(skills, `${course}.json`), JSON.stringify({ learning: true }))
  await openSlides()

  // Another course learns: this one gets no playbook, and a rule here is refused.
  await learns('Design of Software Systems')
  await ask('/uml never use aggregation for order lines')
  await expect(answers()).toHaveCount(1)
  const packet = (await readLog()).find((e) => e.question.startsWith('/uml'))!.text
  expect(packet).toContain('/uml learns only the course Design of Software Systems')
  expect(packet).not.toContain('<playbook>')
  await expect(fs.readFile(path.join(skills, 'Machine Learning.rules.md'))).rejects.toThrow()

  // In the course it learns, feedback the TA gave becomes a rule that says so.
  await fs.rm(path.join(skills, 'Design of Software Systems.json'))
  await learns('Machine Learning')
  await ask('/uml the TA said never use aggregation for order lines')
  await expect(answers()).toHaveCount(2)
  await expect
    .poll(() => fs.readFile(path.join(skills, 'Machine Learning.rules.md'), 'utf8'))
    .toBe('- Never use aggregation for order lines (from the TA, iteration 1)\n')
  await expect(page.locator('.claude-tool').last()).toContainText(
    'Added to your /uml rules: Never use aggregation for order lines (from the TA, iteration 1)'
  )
})

test('text in the chat can be selected, copied and asked about', async () => {
  await openSlides(3)
  await ask('Explain this formula')
  const answer = answers().locator('p').first()
  await expect(answer).toContainText('information gain')

  // The clipboard is the real one of this laptop: put back what was on it.
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    // Drag over the whole answer; its formula is copied as LaTeX, not as KaTeX's letters.
    const box = (await answer.boundingBox())!
    await page.mouse.move(box.x + 1, box.y + 4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 1, box.y + box.height - 4, { steps: 5 })
    await page.mouse.up()
    const selected = 'This is the information gain formula: $IG(S,t) = H(S) - \\sum_v'
    await page.keyboard.press('Control+C')
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain(selected)

    await answer.click({ button: 'right', position: { x: 2, y: 4 } })
    await expect(page.getByRole('menuitem', { name: /Copy/ })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    await expect(page.getByRole('textbox', { name: 'Message to Claude' })).toBeFocused()
    await expect(page.locator('.chip', { hasText: '“' })).toHaveCount(1)
    await ask('Why is that?')
    await expect(answers()).toHaveCount(2)
    const [, second] = await readLog()
    expect(second.text).toContain(`Selected in this chat: "${selected}`)
    await expect(page.locator('.chip', { hasText: '“' })).toHaveCount(0)
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved)
  }
})

test('adds to the summary under a heading after Accept, and one undo removes it', async () => {
  await openSlides()
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.md-editor .cm-content')).toBeVisible()

  await ask('Add a short version under Information gain')
  await expect(page.locator('.cm-proposal')).toContainText('Short version: pick the split')
  await page.screenshot({ path: path.join('test-results', 'claude-proposal.png') })
  expect(await readSummary()).toBe(SUMMARY)

  await page
    .locator('.claude-proposal')
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  await expect(answers().last()).toHaveText('Added it under Information gain.')
  await expect
    .poll(readSummary)
    .toBe(
      SUMMARY.replace(
        'Gain is $IG(S,t)$.\n',
        'Gain is $IG(S,t)$.\n\nShort version: pick the split that lowers entropy the most.\n'
      )
    )

  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+Z')
  await expect.poll(readSummary).toBe(SUMMARY)
})

test('clicking a waiting change in the chat opens the file at it again', async () => {
  await openSlides()
  await page.keyboard.press('Control+Shift+M')
  await ask('Add a short version under Information gain')
  await expect(page.locator('.cm-proposal')).toBeVisible()

  // Back to the slides alone: the note closes while the change still waits.
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.md-editor')).toHaveCount(0)
  await page.locator('.claude-proposal-label', { hasText: 'Summary.md' }).click()
  await expect(page.locator('.cm-proposal')).toContainText('Short version: pick the split')
  await page.locator('.cm-proposal').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect.poll(readSummary).toContain('Short version: pick the split')

  await page.keyboard.press('Control+Shift+M')
  await row('slides.pdf').click()
  await expect(page.locator('.md-editor')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Leave out slides.pdf · p.1' })).toBeVisible()
  await ask('Put a note next to this slide')
  await expect(page.locator('.text-box.ghost')).toBeVisible()
  await row('Summary').click()
  await expect(page.locator('.pdf-page')).toHaveCount(0)
  await page.locator('.claude-proposal-label').last().click()
  await expect(page.locator('.text-box.ghost')).toBeVisible()
  // Wide slides have a large text size; the buttons keep the app's own size.
  await expect(page.locator('.ghost-actions .button').first()).toHaveCSS('font-size', '13px')
  await page.locator('.ghost-actions').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.locator('.text-box.by-claude:not(.ghost)')).toHaveCount(1)
  // Done changes are plain text again.
  await expect(page.locator('button.claude-proposal-label')).toHaveCount(0)
})

test('puts a note in the margin of the slide; Reject leaves nothing', async () => {
  await openSlides()
  const ghost = page.locator('.text-box.ghost')

  await ask('Put a note next to this slide')
  await expect(ghost).toBeVisible()
  await page.locator('.ghost-actions').getByRole('button', { name: 'Reject' }).click()
  await expect(ghost).toHaveCount(0)
  await expect(answers().last()).toContainText('I rejected this change')
  await expect(page.locator('.text-box.by-claude')).toHaveCount(0)

  await ask('Put a note next to this slide')
  await page.locator('.ghost-actions').getByRole('button', { name: 'Accept', exact: true }).click()
  const note = page.locator('.text-box.by-claude:not(.ghost)')
  await expect(note).toHaveCount(1)
  await expect(note.locator('.katex')).toBeVisible()
  await page.screenshot({ path: path.join('test-results', 'claude-note.png') })

  // Saved to the sidecar as Claude's, in the margin to the right of the 960-point slide.
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  await expect
    .poll(async () => JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}')).pages)
    .toMatchObject({ '1': { textBoxes: [{ author: 'claude' }] } })
  const saved = JSON.parse(await fs.readFile(sidecar, 'utf8'))
  expect(saved.pages['1'].textBoxes[0].x).toBeGreaterThan(960)

  await page.locator('.pdf-scroll').focus()
  await page.keyboard.press('Control+Z')
  await expect(note).toHaveCount(0)
})

const scrollTop = (): Promise<number> =>
  page.locator('.pdf-scroll').evaluate((el) => Math.round(el.scrollTop))

test('Claude looks at a page in view live and at a bigger one off screen, without scrolling', async () => {
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  const stroke = { id: 's1', tool: 'pen', color: '#1f6feb', width: 2, author: 'claude' }
  await fs.writeFile(
    sidecar,
    JSON.stringify({
      version: 1,
      pdf: 'slides.pdf',
      marginWidth: 0.3,
      pages: {
        '1.1': {
          blank: true,
          strokes: [
            {
              ...stroke,
              points: [
                [100, 100, 0.5],
                [400, 300, 0.5]
              ]
            }
          ],
          highlights: [],
          textBoxes: []
        }
      }
    })
  )
  await openSlides()
  const scroller = page.locator('.pdf-scroll')
  await scroller.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+-')
  const blank = page.locator('.pdf-page[data-page="1.1"]')
  await expect(blank.locator('svg.ink path')).toHaveCount(1)
  const view = (await scroller.boundingBox())!
  const sheet = (await blank.boundingBox())!
  expect(sheet.y + sheet.height).toBeLessThan(view.y + view.height)

  // The blank page under the slide is all in view, so Claude sees it as drawn.
  const before = await scrollTop()
  await ask('Look at page 1.1')
  await expect(answers().last()).toContainText('Page 1.1 of')
  await expect(answers().last()).toContainText('as I see it')
  expect(await scrollTop()).toBe(before)

  // Zoomed in, the slide does not fit, so it is drawn off screen and the view stays.
  await scroller.focus()
  for (let i = 0; i < 9; i++) await page.keyboard.press('Control+=')
  await expect
    .poll(async () => (await page.locator('.pdf-page[data-page="1"]').boundingBox())!.height)
    .toBeGreaterThan(view.height)
  const zoomed = await scrollTop()
  await ask('Look at this page')
  await expect(answers().last()).toContainText('drawn off screen')
  expect(await scrollTop()).toBe(zoomed)
  await fs.copyFile(`${fakeLog(env)}.png`, path.join('test-results', 'claude-off-screen-slide.png'))
})

test('off screen, Claude sees text boxes with their formulas and charts drawn', async () => {
  await fs.writeFile(
    path.join(env.vault, `${pdfRel}.annotations.json`),
    JSON.stringify({
      version: 1,
      pdf: 'slides.pdf',
      marginWidth: 0.6,
      pages: {
        '1.1': {
          blank: true,
          strokes: [],
          highlights: [],
          textBoxes: [
            {
              id: 't1',
              x: 40,
              y: 40,
              width: 700,
              fontSize: 22,
              author: 'claude',
              markdown:
                'Entropy $H(S) = -\\sum_i p_i \\log_2 p_i$\n\n' +
                '```mermaid\nflowchart LR\n  Root --> Left\n  Root --> Right\n```'
            }
          ]
        }
      }
    })
  )
  await openSlides()
  // Page 1.1 is below the slide on screen, not wholly in view.
  await expect(page.locator('.pdf-page[data-page="1.1"] .text-box .diagram svg')).toBeAttached()
  await ask('Look at page 1.1')
  await expect(answers().last()).toContainText('as the viewer shows it')
  const png = await fs.readFile(`${fakeLog(env)}.png`)
  // 960 points plus a 0.6 margin, drawn 1400 pixels wide.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1400, 492])
  await fs.copyFile(`${fakeLog(env)}.png`, path.join('test-results', 'claude-off-screen-page.png'))
})

test('Claude can look at a whole page as it is drawn, also when it is bigger than the view', async () => {
  // Allowed to open files, a page bigger than the view is scrolled over in pieces.
  await app.close()
  const config = path.join(env.userData, 'config.json')
  const current = JSON.parse(await fs.readFile(config, 'utf8'))
  await fs.writeFile(config, JSON.stringify({ ...current, claude: { openEditedFiles: true } }))
  ;({ app, page } = await launch(env))
  await openSlides()
  await ask('Put a note next to this slide')
  await page.locator('.ghost-actions').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.locator('.text-box.by-claude:not(.ghost)')).toHaveCount(1)
  // Zoomed in, the page takes several pieces of the view to cover.
  await page.locator('.pdf-scroll').focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+=')
  const view = (await page.locator('.pdf-scroll').boundingBox())!
  const sheet = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!
  expect(sheet.height).toBeGreaterThan(view.height)

  const before = await scrollTop()
  await ask('Look at this page')
  await expect(answers().last()).toContainText('Page 1 of')
  expect(await scrollTop()).toBe(before)
  const text = await answers().last().innerText()
  const perPoint = Number(/1 PDF point is ([\d.]+) px/.exec(text)![1])
  // Width and height of the PNG, from its header.
  const png = await fs.readFile(`${fakeLog(env)}.png`)
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  expect(text).toContain(`(${width}x${height} px)`)
  expect(Math.abs(height - 540 * perPoint)).toBeLessThan(3)
  expect(width).toBeGreaterThan(960 * perPoint)
  await fs.copyFile(`${fakeLog(env)}.png`, path.join('test-results', 'claude-screenshot.png'))
})

test('draws on the slide after I accept', async () => {
  await openSlides()
  await ask('Circle the title')
  await expect(page.locator('svg.ink.ghost path')).toHaveCount(1)
  await page.locator('.ghost-actions').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(answers().last()).toHaveText('Circled it.')
  await expect(page.locator('.pdf-page[data-page="1"] svg.ink:not(.ghost) > path')).toHaveCount(1)
})

test('Accept all lets the rest of the answer edit without asking', async () => {
  await openSlides()
  await ask('Rework the notes on this slide')
  await page.locator('.claude-proposal').getByRole('button', { name: 'Accept all' }).click()
  await expect(answers().last()).toContainText('delete_annotations: No annotation "t_nope"')
  const text = await answers().last().innerText()
  expect(text.split('\n').filter((l) => l.endsWith(': ok'))).toHaveLength(7)

  // Only for that answer: the next one asks again.
  await ask('Put a note next to this slide')
  await expect(page.locator('.text-box.ghost')).toBeVisible()
})

test('adds a blank page and changes, moves and removes annotations', async () => {
  await app.close()
  const config = path.join(env.userData, 'config.json')
  const current = JSON.parse(await fs.readFile(config, 'utf8'))
  await fs.writeFile(config, JSON.stringify({ ...current, claude: { askBeforeEditing: false } }))
  ;({ app, page } = await launch(env))
  await openSlides()

  await ask('Rework the notes on this slide')
  await expect(answers().last()).toContainText('delete_annotations: No annotation "t_nope"')
  const text = await answers().last().innerText()
  expect(text.split('\n').filter((l) => l.endsWith(': ok'))).toHaveLength(7)

  // The box went to the blank page, was changed, then moved back onto slide 1's margin.
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  await expect
    .poll(async () => JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}')).pages)
    .toMatchObject({
      '1': { textBoxes: [{ markdown: 'Worked example, step 2', x: 980, y: 300 }], highlights: [] },
      '1.1': { blank: true, textBoxes: [] }
    })
  await expect(page.locator('.pdf-page[data-page="1.1"]')).toBeAttached()
  await expect(page.locator('.pdf-page[data-page="1"] .text-box')).toHaveText(
    'Worked example, step 2'
  )
})

test('the chat I ask in stays while I open its subfolders; the picker switches', async () => {
  await fs.mkdir(path.join(env.vault, section, 'Exercises'))
  await fs.writeFile(path.join(env.vault, section, 'Exercises/Sheet 1.md'), '# Sheet 1\n')
  await openSlides()
  await ask('What is entropy?')
  await expect(answers()).toHaveText('You asked: What is entropy?')

  await row('Exercises').click()
  await row('Sheet 1').click()
  await expect(page.locator('.md-editor')).toBeVisible()
  await expect(page.locator('.claude-chat-name')).toHaveText('B2 Decision trees')
  await expect(page.locator('.claude-question')).toHaveText('What is entropy?')

  await page.locator('.claude-chat-name').click()
  const menu = page.locator('.claude-chat-menu')
  await expect(menu.locator('.menu-heading')).toHaveText(['This folder', 'Folders above'])
  await menu.getByRole('menuitem', { name: 'Exercises' }).click()
  await expect(page.locator('.claude-chat-name')).toHaveText('Exercises')
  await expect(page.locator('.claude-question')).toHaveCount(0)

  // Back to the lesson chat from the picker, and it stays while I stay in the lesson.
  await page.locator('.claude-chat-name').click()
  await menu.getByRole('menuitem', { name: /B2 Decision trees/ }).click()
  await expect(page.locator('.claude-question')).toHaveText('What is entropy?')
  await row('B3 Ensembles').click()
  await row('Bagging').click()
  await expect(page.locator('.claude-chat-name')).toHaveText('B3 Ensembles')
})

test('Claude looks at a closed note and another slide without taking me there', async () => {
  await openSlides(3)
  await ask('Look at the other files')
  await expect(answers().last()).toContainText('Looked.', { timeout: 20_000 })
  await expect(answers().last()).toContainText('Page 1 of Machine Learning/B2 Decision trees')
  await expect(page.locator('.md-editor')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue('3')
})

test('Claude changes a note in another folder without taking me there', async () => {
  const bagging = path.join(env.vault, 'Machine Learning/B3 Ensembles/Bagging.md')
  await openSlides(3)
  await ask('Update the bagging note')
  await expect(page.locator('.claude-proposal-label', { hasText: 'Bagging.md' })).toBeVisible()
  await expect(page.locator('.md-editor')).toHaveCount(0)
  await page
    .locator('.claude-proposal')
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  await expect(answers().last()).toHaveText('Updated the bagging note.')
  await expect.poll(() => fs.readFile(bagging, 'utf8')).toContain('Bagging averages many trees.')
  await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue('3')
  await expect(page.locator('.claude-chat-name')).toHaveText('B2 Decision trees')
})

test('another chat and a whole folder go along with @', async () => {
  await openSlides()
  await row('B3 Ensembles').click()
  await row('Bagging').click()
  await ask('What is bagging?')
  await expect(answers()).toHaveText('You asked: What is bagging?')

  await row('slides.pdf').click()
  // Opening a PDF focuses it once it has loaded; type after that.
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeAttached()
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await input.click()
  await input.fill('@B3')
  const picker = page.locator('.claude-picker')
  await picker.locator('li', { hasText: 'Chat' }).click()
  await input.fill('@Machine')
  await picker.locator('li', { hasText: 'Everything in it' }).first().click()
  await expect(page.getByRole('button', { name: 'Leave out @B3 Ensembles chat' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leave out @Machine Learning/' })).toBeVisible()
  await ask('Compare this with bagging')
  await expect(answers().last()).toHaveText('You asked: Compare this with bagging')
  const sent = (await readLog()).at(-1)!.text
  expect(sent).toContain('I attached my other chat about Machine Learning/B3 Ensembles')
  expect(sent).toContain('Me: What is bagging?')
  expect(sent).toContain('I attached the folder Machine Learning')
  expect(sent).toContain('- Machine Learning/B3 Ensembles/Bagging.md')
})

test('keeps one conversation per lesson across restarts', async () => {
  await openSlides()
  await ask('What is entropy?')
  await expect(answers()).toHaveText('You asked: What is entropy?')

  await app.close()
  ;({ app, page } = await launch(env))
  await openSlides()
  await page.keyboard.press('Control+L')
  await expect(page.locator('.claude-question')).toHaveText('What is entropy?')
  await expect(answers()).toHaveText('Earlier answer to: What is entropy?')

  // Another lesson has its own conversation.
  await row('B3 Ensembles').click()
  await row('Bagging').click()
  await expect(page.locator('.claude-chat-name')).toHaveText('B3 Ensembles')
  await expect(page.locator('.claude-question')).toHaveCount(0)

  // New chat starts over for this lesson.
  await row('slides.pdf').click()
  await expect(page.locator('.claude-question')).toHaveCount(1)
  await page.getByRole('button', { name: 'New chat' }).click()
  await expect(page.locator('.claude-question')).toHaveCount(0)
})

test('/claude in a note: several at once, each its own undo step and cancel', async () => {
  await openSlides(2)
  await page.keyboard.press('Control+Shift+M')
  // The slides pane loads the PDF again in lecture mode; it must be there to be sent along.
  await expect(page.locator('.lecture-pane .pdf-page[data-page="2"] canvas')).toBeAttached()
  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+End')

  // Enter sends a request and starts a new line, so the next one can be written right away.
  const first = 'The best step size: /claude insert the formula for the optimal alpha'
  await page.keyboard.type(first)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Background: /claude slow')
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-claude-writing')).toHaveCount(2)

  const answer = 'The best step size: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'
  await expect.poll(readSummary).toBe(SUMMARY + answer + '\nBackground: /claude slow\n')
  await expect(page.locator('.cm-claude-writing')).toHaveCount(1)
  const sent = (await readLog()).find((e) => e.text.includes('⟦here⟧: insert the formula'))!
  expect(sent.images).toBe(1)
  expect(sent.text).toContain(`Slides: ${pdfRel}, page 2 of 8.`)
  expect(sent.text).toContain('Later.\nThe best step size: ⟦here⟧')
  expect(sent.text).toContain('My request at ⟦here⟧: insert the formula for the optimal alpha')

  // Each request has its own Cancel; the text stays as typed.
  await page.locator('.cm-claude-cancel').click()
  await expect(page.locator('.cm-claude-writing')).toHaveCount(0)

  // One undo takes the answer out again and brings the request back.
  await page.keyboard.press('Control+Z')
  await expect.poll(readSummary).toBe(SUMMARY + first + '\nBackground: /claude slow\n')

  // Esc cancels the request started last.
  await page.keyboard.type('/claude slow again')
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-claude-writing')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-claude-writing')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('/claude in a text box on a slide, also after the box is closed', async () => {
  await openSlides()
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  const boxes = async (): Promise<string[]> => {
    const file = JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}'))
    return (file.pages?.['1']?.textBoxes ?? []).map((b: { markdown: string }) => b.markdown)
  }
  const page1 = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!

  // Answered while the box is open: it lands in the box I am typing in.
  await page.keyboard.press('KeyT')
  await page.mouse.click(page1.x + 60, page1.y + 60)
  await page.keyboard.type('Step: /claude the optimal alpha')
  await page.keyboard.press('Enter')
  await expect(page.locator('.text-box-claude')).toBeVisible()
  const editorBox = page.locator('.text-box-editor')
  await expect(editorBox).toHaveValue(/Step: \$\\alpha\^\* = /)
  const sent = (await readLog()).find((e) => e.text.includes('the optimal alpha'))!
  expect(sent.text).toContain('a text box on page 1 of')
  expect(sent.images).toBe(1)
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.text-box .katex').first()).toBeVisible()
  await expect.poll(boxes).toEqual(['Step: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'])

  // Answered after the box was closed: it still goes in, as its own undo step.
  await page.keyboard.press('KeyT')
  await page.mouse.click(page1.x + 60, page1.y + 200)
  await page.keyboard.type('Later: /claude later please')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Enter')
  await expect
    .poll(boxes, { timeout: 10_000 })
    .toContain('Later: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$')
  await page.locator('.pdf-scroll').focus()
  await page.keyboard.press('Control+Z')
  await expect.poll(boxes).toContain('Later: /claude later please')
})

test('/claude in a text box keeps its answer when I click away to start another box', async () => {
  await openSlides()
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  const boxes = async (): Promise<string[]> => {
    const file = JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}'))
    return (file.pages?.['1']?.textBoxes ?? []).map((b: { markdown: string }) => b.markdown)
  }
  const page1 = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!

  await page.keyboard.press('KeyT')
  await page.mouse.click(page1.x + 60, page1.y + 60)
  await page.keyboard.type('Later: /claude later please')
  await page.keyboard.press('Enter')
  // A click elsewhere closes the box and starts a new one; Claude is still at work in the first.
  await page.mouse.click(page1.x + 60, page1.y + 250)
  await expect(page.locator('.text-box:not(.editing) .text-box-claude')).toBeVisible()
  await expect(page.locator('.text-box .katex')).toBeVisible({ timeout: 10_000 })
  // The new box stays empty, so it is dropped; the answer must stay.
  await page.keyboard.press('Escape')
  await expect(page.locator('.text-box-editor')).toHaveCount(0)
  await expect(page.locator('.text-box .katex')).toBeVisible()
  await expect.poll(boxes).toEqual(['Later: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'])
})

test('a box Claude wrote into the file past the page bottom moves up when the slides open', async () => {
  // The terminal tab can write the annotation file directly, without the app fitting the box.
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  const markdown = Array.from({ length: 12 }, (_, i) => `- Step ${i + 1} of the proof`).join('\n')
  const box = { id: 't_term', x: 972, y: 480, width: 300, markdown, author: 'claude' }
  const pages = { '1': { strokes: [], highlights: [], textBoxes: [box] } }
  await fs.writeFile(sidecar, JSON.stringify({ version: 1, pdf: 'slides.pdf', pages }))
  await openSlides()

  const shown = page.locator('.pdf-page[data-page="1"] .text-box')
  await expect(shown).toContainText('Step 12')
  const saved = async (): Promise<{ y: number; fontSize?: number }> =>
    JSON.parse(await fs.readFile(sidecar, 'utf8')).pages['1'].textBoxes[0]
  await expect.poll(async () => (await saved()).y).toBeLessThan(300)
  expect((await saved()).fontSize).toBeUndefined()
  const content = shown.locator('.text-box-content')
  expect(await content.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
})

test('a /claude answer too long for the slide moves to a new blank page', async () => {
  await openSlides()
  const sidecar = path.join(env.vault, `${pdfRel}.annotations.json`)
  const page1 = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!

  await page.keyboard.press('KeyT')
  await page.mouse.click(page1.x + 60, page1.y + page1.height * 0.7)
  await page.keyboard.type('/claude long list')
  await page.keyboard.press('Enter')
  await expect(page.locator('.text-box-editor')).toHaveValue(/Point 30/)
  // While I type, the box scrolls instead of running off the page.
  const editor = page.locator('.text-box-editor')
  expect(await editor.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press('Control+Enter')

  await expect(page.locator('.pdf-page[data-page="1.1"] .text-box')).toContainText('Point 30')
  await expect
    .poll(async () => JSON.parse(await fs.readFile(sidecar, 'utf8').catch(() => '{}')).pages)
    .toMatchObject({ '1.1': { blank: true } })
  const file = JSON.parse(await fs.readFile(sidecar, 'utf8'))
  expect(file.pages['1']).toBeUndefined()
  expect(file.pages['1.1'].textBoxes[0].x).toBeLessThan(20)
  // The whole width of the page with its margin, not a narrow column.
  expect(file.pages['1.1'].textBoxes[0].width).toBeGreaterThan(900)
})

test('/summary runs a skill that writes a new note linked to the slides', async () => {
  await openSlides()
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await page.keyboard.press('Control+L')
  await input.fill('/')
  // Four skills, and /uml review.
  await expect(page.locator('.claude-picker li')).toHaveCount(5)
  await input.press('Enter')
  await expect(input).toHaveValue('/summary ')
  await input.press('Enter')

  await expect(page.locator('.claude-question').last()).toHaveText('/summary')
  await page
    .locator('.claude-proposal')
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  await expect(answers().last()).toContainText('got the steps, read 8 pages.')
  await expect(answers().last()).toContainText(`Made ${section}/slides summary.md`)

  const note = path.join(env.vault, section, 'slides summary.md')
  expect(await fs.readFile(note, 'utf8')).toContain('most information gain')
  // It stays closed so I keep my place; the notice opens it next to the slides.
  await expect(page.locator('.md-editor')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('.cm-content')).toContainText('most information gain')
  const state = JSON.parse(
    await fs.readFile(path.join(env.vault, '.marginalia/state.json'), 'utf8')
  )
  expect(state.notes[pdfRel]).toContain(`${section}/slides summary.md`)
})

test('Claude makes folders and moves and renames files like the sidebar does', async () => {
  await openSlides()
  await ask('Tidy up this lesson')
  await page.locator('.claude-proposal').getByRole('button', { name: 'Accept all' }).click()
  await expect(answers().last()).toContainText('rename_item: Renamed to')
  const solved = path.join(env.vault, section, 'Exercises', 'Sheet 1 solved.md')
  await expect.poll(() => fs.readFile(solved, 'utf8').catch(() => null)).toContain('# Sheet 1')
  await expect(answers().last()).toContainText(`create_folder: Made ${section}/Exercises.`)
  await expect(row('Exercises')).toBeVisible()
})

test('/claude changes text that is already there, as one undo step', async () => {
  await row('Machine Learning').click()
  await row('B2 Decision trees').first().click()
  await row('Summary').click()
  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Best: /claude the optimal alpha')
  await page.keyboard.press('Enter')
  const before = 'Best: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$\n'
  await expect.poll(readSummary).toBe(SUMMARY + before)

  // Changes the formula above instead of writing a new one; the request line goes away.
  await page.keyboard.type('/claude change the formula above')
  await page.keyboard.press('Enter')
  const after = 'Best: $\\alpha^* = \\arg\\min_{\\alpha > 0} L(\\alpha)$\n'
  await expect.poll(readSummary).toBe(SUMMARY + after)
  await expect(page.locator('.cm-claude-changed')).toBeVisible()
  const [asked] = (await readLog()).filter((e) => e.text.includes('change the formula above'))
  expect(asked.text).toContain('Best: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$\n⟦here⟧')

  await page.keyboard.press('Control+Z')
  await expect.poll(readSummary).toBe(SUMMARY + before + '/claude change the formula above\n')
})

test('answers with display math inside a line keep the editor working', async () => {
  // Once crashed the editor: a $ left over from "$$...$$" paired with a $ on the next line.
  const errors: string[] = []
  await row('Machine Learning').click()
  await row('B2 Decision trees').first().click()
  await row('Summary').click()
  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Rule: /claude display the update rule')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Best: /claude later the optimal alpha')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cm-claude-writing')).toHaveCount(0, { timeout: 10_000 })
  await expect
    .poll(readSummary)
    .toContain('Rule: $$x_{k+1} = x_k - \\alpha \\nabla f(x_k)$$\nBest: $\\alpha^*')
  // Both answers render, next to $IG(S,t)$ that was already in the note.
  await expect(page.locator('.cm-math-inline')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('/claude at the end of a list item sends and its blocks render', async () => {
  // Enter used to continue the list instead, and a block answer landed mid-line as plain text.
  await row('Machine Learning').click()
  await row('B2 Decision trees').first().click()
  await row('Summary').click()
  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('- Risk /claude block')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cm-claude-writing')).toHaveCount(0, { timeout: 10_000 })
  await expect
    .poll(readSummary)
    .toContain('- Risk \n  The risk:\n  $$\n  R = L \\times I\n  $$\n\n  ```mermaid\n')
  await page.keyboard.press('Control+Home')
  await expect(page.locator('.md-editor .cm-math-block')).toBeVisible()
  await expect(page.locator('.md-editor .cm-diagram svg')).toBeVisible()
  // The / menu still works afterwards.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
})
