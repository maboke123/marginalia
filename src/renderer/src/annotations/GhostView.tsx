import { useMemo } from 'react'
import { useChat } from '../claude/chat'
import { RenderedHtml } from '../components/RenderedHtml'
import { renderMarkdown } from '../lib/markdown'
import type { Ghost } from './doc'
import { strokePath } from './ink'

/** An annotation Claude proposes, drawn faintly with Accept and Reject next to it. */
export function GhostView({ ghost, scale }: { ghost: Ghost; scale: number }): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(ghost.textBox?.markdown ?? ''), [ghost.textBox])
  const box = ghost.textBox
  const first = ghost.highlight?.rects[0]
  const start = ghost.strokes?.[0]?.points[0]
  const at = box
    ? { x: box.x, y: box.y }
    : first
      ? { x: first[0], y: first[1] + first[3] + 2 }
      : start
        ? { x: start[0], y: start[1] + 4 }
        : null

  return (
    <>
      {ghost.highlight?.rects.map(([x, y, w, h], i) => (
        <div
          key={i}
          className="hl highlight ghost"
          style={{ left: x, top: y, width: w, height: h, color: ghost.highlight!.color }}
        />
      ))}
      {ghost.strokes && (
        <svg className="ink ghost" width={1} height={1}>
          {ghost.strokes.map((s) => (
            <path key={s.id} d={strokePath(s)} fill={s.color} />
          ))}
        </svg>
      )}
      {box && (
        <div
          className="text-box by-claude ghost passive"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            fontSize: box.fontSize,
            color: box.color
          }}
        >
          <RenderedHtml className="text-box-content" html={html} surface="paper" />
        </div>
      )}
      {at && (
        <div
          className="ghost-actions"
          // The overlay is scaled with the page; keep the buttons at their normal size.
          style={{
            left: at.x,
            top: at.y,
            transform: `scale(${1 / scale}) translateY(${box ? '-100%' : '0'})`
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="button primary" onClick={() => ghost.decide(true)}>
            Accept
          </button>
          <button
            className="button"
            title="Accept this and every other change in this answer"
            onClick={() => useChat.getState().acceptAll()}
          >
            Accept all
          </button>
          <button className="button" onClick={() => ghost.decide(false)}>
            Reject
          </button>
        </div>
      )}
    </>
  )
}
