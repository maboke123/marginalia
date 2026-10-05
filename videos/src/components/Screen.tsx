import type { CSSProperties, ReactNode } from 'react'
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import screens from '../screens.json'

// Screens are the app window at 3x; everything inside a Screen is in app pixels.
export const APP = screens.size

// The frame sits right of the caption column and runs off the right edge of the canvas.
const FRAME = { left: 720, top: 140, width: 1200, height: 800 }

export type Camera = { x: number; y: number; scale: number }

/** Moves from one camera to the next between two frames, kept inside the screenshot. */
export function useCamera(from: Camera, to: Camera, [start, end]: [number, number]): Camera {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic)
  })
  const scale = from.scale + (to.scale - from.scale) * t
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max))
  return {
    scale,
    x: clamp(from.x + (to.x - from.x) * t, APP.width - FRAME.width / scale),
    y: clamp(from.y + (to.y - from.y) * t, APP.height - FRAME.height / scale)
  }
}

/** The camera that shows the whole window height. */
export const FULL: Camera = { x: 0, y: 0, scale: FRAME.height / APP.height }

type ScreenProps = {
  camera: Camera
  children: ReactNode
}

export function Screen({ camera, children }: ScreenProps) {
  return (
    <div
      className="absolute overflow-hidden border border-r-0 border-border bg-background"
      style={FRAME}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: APP.width,
          height: APP.height,
          transformOrigin: '0 0',
          transform: `scale(${camera.scale}) translate(${-camera.x}px, ${-camera.y}px)`
        }}
      >
        {children}
      </div>
    </div>
  )
}

type ShotProps = {
  name: string
  opacity?: number
}

/** One screenshot covering the whole app window. */
export function Shot({ name, opacity = 1 }: ShotProps) {
  return (
    <Img
      src={staticFile(`screens/${name}.png`)}
      className="absolute left-0 top-0"
      style={{ width: APP.width, height: APP.height, opacity }}
    />
  )
}

export type Box = { x: number; y: number; width: number; height: number }

type RevealProps = {
  name: string
  box: Box
  pad?: number
  style?: CSSProperties
}

/** Part of a screenshot, laid exactly over the same spot of another one. */
export function Reveal({ name, box, pad = 6, style }: RevealProps) {
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: box.x - pad,
        top: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        ...style
      }}
    >
      <Img
        src={staticFile(`screens/${name}.png`)}
        className="absolute max-w-none"
        style={{ left: pad - box.x, top: pad - box.y, width: APP.width, height: APP.height }}
      />
    </div>
  )
}
