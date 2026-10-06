/**
 * ```mermaid and ```vega-lite blocks drawn as SVG. Both libraries are large, so they load the
 * first time a note or text box has a diagram. Results are cached per source, so a text box
 * that renders again shows its chart at once.
 */

export const DIAGRAM_LANGS = new Set(['mermaid', 'vega-lite'])

/** Text boxes sit on white slide paper, also in dark mode; notes and chat follow the theme. */
export type Surface = 'app' | 'paper'

type Result = { svg: string } | { error: string }

const cache = new Map<string, Promise<Result>>()
const done = new Map<string, Result>()

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)
}

/** What markdown-it puts in the page; `hydrateDiagrams` swaps it for the drawing. */
export function diagramPlaceholder(lang: string, source: string): string {
  return (
    `<div class="diagram" data-lang="${lang}" data-source="${escapeHtml(source)}">` +
    `<pre class="diagram-source"><code>${escapeHtml(source)}</code></pre></div>`
  )
}

function dark(surface: Surface): boolean {
  return surface === 'app' && matchMedia('(prefers-color-scheme: dark)').matches
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const CATEGORY = ['blue', 'red', 'green', 'orange', 'teal', 'pink', 'yellow', 'gray']

async function renderVegaLite(source: string, surface: Surface): Promise<string> {
  const [{ parse, View }, { compile }, { expressionInterpreter }] = await Promise.all([
    import('vega'),
    import('vega-lite'),
    import('vega-interpreter')
  ])
  const text = surface === 'paper' ? token('--paper-text') : token('--text')
  const muted = surface === 'paper' ? token('--paper-text') : token('--text-muted')
  const rule = surface === 'paper' ? token('--paper-rule') : token('--border-strong')
  const font = token('--font')
  const spec = compile(JSON.parse(source), {
    config: {
      background: 'transparent',
      font,
      view: { stroke: null },
      title: { color: text, fontWeight: 600 },
      axis: {
        labelColor: muted,
        titleColor: text,
        gridColor: rule,
        domainColor: rule,
        tickColor: rule
      },
      legend: { labelColor: text, titleColor: text },
      range: { category: CATEGORY.map((c) => token(`--nb-${c}`)) }
    }
  }).spec
  // The interpreter evaluates expressions without eval, which the page's CSP forbids.
  const view = new View(parse(spec, undefined, { ast: true }), {
    expr: expressionInterpreter,
    renderer: 'none'
  })
  try {
    return await view.toSVG()
  } finally {
    view.finalize()
  }
}

let mermaidQueue: Promise<unknown> = Promise.resolve()
let mermaidId = 0

function renderMermaid(source: string, surface: Surface): Promise<string> {
  // mermaid keeps global state while it draws, so one diagram at a time.
  const run = mermaidQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark(surface) ? 'dark' : 'default',
      fontFamily: token('--font'),
      xyChart: { width: 560, height: 340 },
      // The default palette draws a second line almost white.
      themeVariables: {
        xyChart: { plotColorPalette: CATEGORY.map((c) => token(`--nb-${c}`)).join(', ') }
      }
    })
    const { svg } = await mermaid.render(`diagram-${++mermaidId}`, source)
    return svg
  })
  mermaidQueue = run.catch(() => undefined)
  return run
}

function render(key: string, lang: string, source: string, surface: Surface): Promise<Result> {
  let result = cache.get(key)
  if (!result) {
    const svg =
      lang === 'mermaid' ? renderMermaid(source, surface) : renderVegaLite(source, surface)
    result = svg.then(
      (svg): Result => ({ svg }),
      (err): Result => ({ error: err instanceof Error ? err.message : String(err) })
    )
    result.then((r) => done.set(key, r))
    cache.set(key, result)
  }
  return result
}

function show(el: HTMLElement, key: string, result: Result): void {
  el.dataset.drawn = key
  if ('svg' in result) {
    el.innerHTML = result.svg
    el.classList.remove('failed')
  } else {
    el.classList.add('failed')
    const source = el.querySelector('.diagram-source')?.outerHTML ?? ''
    el.innerHTML = `<div class="diagram-error">${escapeHtml(result.error)}</div>${source}`
  }
}

/** Draws every diagram placeholder under `root`; `onDrawn` runs when one changed size. */
export function hydrateDiagrams(root: HTMLElement, surface: Surface, onDrawn?: () => void): void {
  for (const el of root.querySelectorAll<HTMLElement>('.diagram[data-source]')) {
    const lang = el.dataset.lang ?? ''
    const source = el.dataset.source ?? ''
    const key = `${surface}|${dark(surface)}|${lang}|${source}`
    if (el.dataset.drawn === key) continue
    const ready = done.get(key)
    if (ready) {
      show(el, key, ready)
      continue
    }
    void render(key, lang, source, surface).then((result) => {
      if (!el.isConnected || el.dataset.source !== source) return
      show(el, key, result)
      onDrawn?.()
    })
  }
}
