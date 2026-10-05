import type { ReactNode } from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

type FadeUpProps = {
  delay?: number
  children: ReactNode
}

export function FadeUp({ delay = 0, children }: FadeUpProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 }
  })

  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [24, 0])}px)`
      }}
    >
      {children}
    </div>
  )
}
