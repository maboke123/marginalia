import { describe, expect, it } from 'vitest'
import { latexToText, markdownToText } from './plainText'

describe('latexToText', () => {
  it('turns common formulas into readable Unicode', () => {
    expect(latexToText('IG(S,t) = H(S) - \\sum_v \\frac{|S_v|}{|S|} H(S_v)')).toBe(
      'IG(S,t) = H(S) - ∑ᵥ (|Sᵥ|)/(|S|) H(Sᵥ)'
    )
    expect(latexToText('x^2 + y^{10} \\leq \\sqrt{n}')).toBe('x² + y¹⁰ ≤ √n')
    expect(latexToText('\\Delta H \\to \\infty')).toBe('ΔH → ∞')
    expect(latexToText('\\log_2 p + \\log x')).toBe('log₂ p + log x')
  })

  it('keeps what has no Unicode form readable', () => {
    expect(latexToText('e^{-x/2}')).toBe('e^(⁻x/2)'.replace('⁻', '-'))
    expect(latexToText('w_{ij}^T')).toBe('wᵢⱼᵀ')
    expect(latexToText('\\text{gain} \\cdot \\mathbf{x}_{\\text{new}}')).toBe('gain · x_(new)')
    expect(latexToText('\\unknown{a}')).toBe('unknowna')
  })
})

describe('markdownToText', () => {
  it('removes formatting and renders math', () => {
    expect(
      markdownToText('## **Weighted** average! $\\frac{a}{b}$\n- see [slide 3](s.pdf#page=3)')
    ).toBe('Weighted average! a/b\n• see slide 3')
    expect(markdownToText('<u>key</u> idea, `code` and *stress*')).toBe('key idea, code and stress')
    expect(markdownToText('<span style="color: red">overfits</span> fast')).toBe('overfits fast')
  })
})
