import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

type LogoProps = {
  size: number
  delay?: number
}

// build/icon.svg: the tile fades in, then the nib slides down onto it along its own axis.
export function Logo({ size, delay = 0 }: LogoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const tile = spring({ frame: frame - delay, fps, config: { damping: 200 } })
  const nib = spring({ frame: frame - delay - 8, fps, config: { damping: 200 } })
  const offset = interpolate(nib, [0, 1], [-40, 0])

  return (
    <svg viewBox="0 0 512 512" width={size} height={size}>
      <rect
        x="16"
        y="16"
        width="480"
        height="480"
        rx="104"
        className="fill-inverse"
        opacity={tile}
      />
      <g
        opacity={nib}
        transform={`translate(${262 + offset * 0.7} ${250 + offset * 0.7}) rotate(45) scale(1.08)`}
      >
        <path
          d="M0 156C18 124 90 64 90 -6C90 -38 70 -54 64 -70L64 -118Q64 -134 48 -134L-48 -134Q-64 -134 -64 -118L-64 -70C-70 -54 -90 -38 -90 -6C-90 64 -18 124 0 156Z"
          className="fill-accent-2"
        />
        <rect x="-72" y="-86" width="144" height="13" className="fill-inverse" />
        <path d="M0 30L0 160" className="stroke-inverse" strokeWidth="11" />
        <circle cx="0" cy="16" r="17" className="fill-inverse" />
      </g>
    </svg>
  )
}
