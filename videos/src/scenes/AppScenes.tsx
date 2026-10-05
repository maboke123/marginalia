import { useCurrentFrame } from 'remotion'
import { Caption } from '../components/Caption'
import { FULL, Reveal, Screen, Shot, useCamera } from '../components/Screen'
import screens from '../screens.json'
import { ramp } from '../video'

const [overcast, outlook, arrowLine, arrowHead] = screens.slides.ink
const [rootNote, pureNote] = screens.slides.textBoxes

// The capture script draws ellipses clockwise from t = -2.4 rad; CSS conic angles start at the top.
const ELLIPSE_FROM = (-2.4 * 180) / Math.PI + 90

const drawEllipse = (progress: number) => {
  const mask = `conic-gradient(from ${ELLIPSE_FROM}deg, #000 ${progress * 360}deg, transparent 0)`
  return { maskImage: mask, WebkitMaskImage: mask }
}

// The arrow is drawn from the margin towards the slide, so right to left.
const drawLeftwards = (progress: number) => {
  const mask = `linear-gradient(to left, #000 ${progress * 100}%, transparent 0)`
  return { maskImage: mask, WebkitMaskImage: mask }
}

export function Annotate() {
  const frame = useCurrentFrame()
  const camera = useCamera(FULL, { x: 270, y: 50, scale: 1.33 }, [10, 60])

  return (
    <Caption
      title="Write on the slides."
      body="Pen, highlighter and text boxes, with a margin next to every slide."
    >
      <Screen camera={camera}>
        <Shot name="slides-clean" />
        {overcast && (
          <Reveal name="slides" box={overcast} style={drawEllipse(ramp(frame, 62, 84))} />
        )}
        {pureNote && (
          <Reveal name="slides" box={pureNote} style={{ opacity: ramp(frame, 88, 100) }} />
        )}
        {outlook && (
          <Reveal name="slides" box={outlook} style={drawEllipse(ramp(frame, 108, 130))} />
        )}
        {arrowLine && (
          <Reveal name="slides" box={arrowLine} style={drawLeftwards(ramp(frame, 132, 152))} />
        )}
        {arrowHead && (
          <Reveal
            name="slides"
            box={arrowHead}
            pad={4}
            style={{ opacity: ramp(frame, 150, 154) }}
          />
        )}
        {rootNote && (
          <Reveal name="slides" box={rootNote} style={{ opacity: ramp(frame, 158, 170) }} />
        )}
      </Screen>
    </Caption>
  )
}

export function Lecture() {
  const camera = useCamera(FULL, { x: 120, y: 20, scale: 1.16 }, [0, 150])

  return (
    <Caption title="Slides left, summary right." body="Markdown and LaTeX, rendered as you type.">
      <Screen camera={camera}>
        <Shot name="lecture" />
      </Screen>
    </Caption>
  )
}

export function Chat() {
  const frame = useCurrentFrame()
  const camera = useCamera(FULL, { x: 0, y: 80, scale: 1.3 }, [70, 120])

  return (
    <Caption
      title="Ask about this slide."
      body="Claude already sees the slide, your notes and your annotations."
    >
      <Screen camera={camera}>
        <Shot name="slides" />
        <Shot name="chat-ask" opacity={ramp(frame, 24, 34)} />
        <Shot name="chat-answer" opacity={ramp(frame, 76, 88)} />
      </Screen>
    </Caption>
  )
}

export function Write() {
  const frame = useCurrentFrame()
  const camera = useCamera({ x: 715, y: 280, scale: 2.1 }, { x: 715, y: 355, scale: 2.1 }, [0, 70])

  return (
    <Caption
      title={
        <>
          Write with <span className="font-mono text-accent-1">/claude</span>.
        </>
      }
      body="Type a request in your notes. The answer lands right there."
    >
      <Screen camera={camera}>
        <Shot name="write-pending" />
        <Shot name="write-answer" opacity={ramp(frame, 84, 96)} />
      </Screen>
    </Caption>
  )
}
