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

test('adds to the summary under a heading after Accept, and one undo removes it', async () => {
  await openSlides()
  await page.keyboard.press('Control+Shift+M')
  await expect(page.locator('.md-editor .cm-content')).toBeVisible()

  await ask('Add a short version under Information gain')
  await expect(page.locator('.cm-proposal')).toContainText('Short version: pick the split')
  await page.screenshot({ path: path.join('test-results', 'claude-proposal.png') })
  expect(await readSummary()).toBe(SUMMARY)

  await page.locator('.claude-proposal').getByRole('button', { name: 'Accept' }).click()
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
  await page.locator('.ghost-actions').getByRole('button', { name: 'Accept' }).click()
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

test('/claude in a note writes at that spot; one undo brings the request back', async () => {
  await openSlides(2)
  await page.keyboard.press('Control+Shift+M')
  // The slides pane loads the PDF again in lecture mode; it must be there to be sent along.
  await expect(page.locator('.lecture-pane .pdf-page[data-page="2"] canvas')).toBeAttached()
  await page.locator('.md-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('The best step size: /claude insert the formula for the optimal alpha')
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-claude-writing')).toBeVisible()

  const answer = 'The best step size: $\\alpha^* = \\arg\\min_\\alpha L(\\alpha)$'
  await expect.poll(readSummary).toBe(SUMMARY + answer)
  const [sent] = await readLog()
  expect(sent.images).toBe(1)
  expect(sent.text).toContain(`Slides: ${pdfRel}, page 2 of 8.`)
  expect(sent.text).toContain('Later.\nThe best step size: ⟦here⟧')
  expect(sent.text).toContain('What to write at ⟦here⟧: insert the formula for the optimal alpha')

  await page.keyboard.press('Control+Z')
  await expect
    .poll(readSummary)
    .toBe(SUMMARY + 'The best step size: /claude insert the formula for the optimal alpha')

  // Esc cancels a request and leaves the text as it was.
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' /claude slow')
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-claude-writing')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-claude-writing')).toHaveCount(0)
  await expect.poll(readSummary).toContain('/claude slow')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
