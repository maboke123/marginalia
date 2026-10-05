import { Easing, interpolate } from 'remotion'

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

export const seconds = (value: number): number => Math.round(value * FPS)

/** 0 before `start`, 1 after `end`, eased in between. */
export const ramp = (frame: number, start: number, end: number): number =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic)
  })
