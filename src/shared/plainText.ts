// Markdown and LaTeX as plain, readable text, for places that cannot render them:
// text boxes in an exported PDF.

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  eta: 'η',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω',
  sum: '∑',
  prod: '∏',
  int: '∫',
  infty: '∞',
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  sim: '∼',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  iff: '⇔',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  partial: '∂',
  nabla: '∇',
  ldots: '…',
  cdots: '⋯',
  mid: '|',
  quad: ' ',
  qquad: '  '
}

const SUPERSCRIPT: Record<string, string> = {
  ...Object.fromEntries([...'0123456789'].map((d, i) => [d, '⁰¹²³⁴⁵⁶⁷⁸⁹'[i]])),
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  T: 'ᵀ'
}

const SUBSCRIPT: Record<string, string> = {
  ...Object.fromEntries([...'0123456789'].map((d, i) => [d, '₀₁₂₃₄₅₆₇₈₉'[i]])),
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  ...Object.fromEntries([...'aehijklmnoprstuvx'].map((c, i) => [c, 'ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'[i]]))
}

/** The {group} or single character at `i`; returns its text and the index after it. */
function group(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++
  if (s[i] !== '{') {
    if (s[i] === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))!
      return [m[0], i + m[0].length]
    }
    return [s[i] ?? '', i + 1]
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return [s.slice(i + 1), s.length]
}

function script(text: string, map: Record<string, string>, mark: string): string {
  const chars = [...text]
  if (chars.length && chars.every((c) => map[c])) return chars.map((c) => map[c]).join('')
  return chars.length === 1 ? mark + text : `${mark}(${text})`
}

const wrap = (t: string): string => (t.length > 1 ? `(${t})` : t)

/** "\frac{|S_v|}{|S|}" -> "(|Sᵥ|)/(|S|)": common LaTeX as Unicode text. */
export function latexToText(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      const name = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))![1]
      i += name.length + 1
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, j] = group(src, i)
        const [b, k] = group(src, j)
        out += `${wrap(latexToText(a))}/${wrap(latexToText(b))}`
        i = k
      } else if (name === 'sqrt') {
        const [a, j] = group(src, i)
        out += `√${wrap(latexToText(a))}`
        i = j
      } else if (
        /^(text|textrm|mathrm|mathbf|mathit|mathcal|operatorname|boldsymbol)$/.test(name)
      ) {
        const [a, j] = group(src, i)
        out += latexToText(a)
        i = j
      } else if (name === 'left' || name === 'right' || name === 'displaystyle') {
        continue
      } else if (name === ',' || name === ';' || name === ' ') {
        out += ' '
      } else if (name === '{' || name === '}' || name === '%' || name === '$') {
        out += name
      } else {
        const symbol = SYMBOLS[name] ?? name
        out += symbol
        // Like LaTeX, a space after "\Delta" ends the command name and is not printed;
        // after operators such as "\cdot" it is kept, which reads better as plain text.
        if (SYMBOLS[name] && /^\p{L}+$/u.test(symbol)) while (src[i] === ' ') i++
      }
    } else if (ch === '^' || ch === '_') {
      const [a, j] = group(src, i + 1)
      out += script(latexToText(a), ch === '^' ? SUPERSCRIPT : SUBSCRIPT, ch)
      i = j
    } else if (ch === '{' || ch === '}') {
      i++
    } else {
      out += ch
      i++
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** A text box's Markdown as plain lines: formatting marks removed, math as Unicode. */
export function markdownToText(md: string): string {
  const withMath = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => latexToText(tex))
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => latexToText(tex))
  return withMath
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<\/?u>/gi, '')
        .replace(/<\/?span[^>]*>/gi, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
        .replace(/`([^`]*)`/g, '$1')
    )
    .join('\n')
    .trim()
}
