import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { FadeUp } from './FadeUp'

type CaptionProps = {
  title: ReactNode
  body: string
  children: ReactNode
}

/** A screen scene: heading and one sentence on the left, the app on the right. */
export function Caption({ title, body, children }: CaptionProps) {
  return (
    <AbsoluteFill className="bg-surface">
      <div className="absolute left-40 top-[140px] flex w-[500px] flex-col gap-8">
        <FadeUp>
          <h2 className="text-[96px] leading-[1.02]">{title}</h2>
        </FadeUp>
        <FadeUp delay={10}>
          <p className="text-[40px] leading-[1.3] text-muted-foreground">{body}</p>
        </FadeUp>
      </div>
      {children}
    </AbsoluteFill>
  )
}
