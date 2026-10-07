import { useLayoutEffect, useRef } from 'react'
import { hydrateDiagrams, type Surface } from '../lib/diagrams'

/**
 * HTML from renderMarkdown, with its diagrams drawn. `delay` waits until the text stops
 * changing, so a chat answer that is still streaming does not draw half a chart.
 */
export function RenderedHtml({
  html,
  className,
  surface,
  delay = 0,
  style
}: {
  html: string
  className: string
  surface: Surface
  delay?: number
  style?: React.CSSProperties
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !html.includes('class="diagram"')) return
    if (!delay) {
      hydrateDiagrams(el, surface)
      return
    }
    const timer = setTimeout(() => hydrateDiagrams(el, surface), delay)
    return () => clearTimeout(timer)
  }, [html, surface, delay])
  return (
    <div ref={ref} className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
