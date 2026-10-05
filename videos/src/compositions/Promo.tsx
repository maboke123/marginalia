import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { Fragment } from 'react'
import { Annotate, Chat, Lecture, Write } from '../scenes/AppScenes'
import { Files, Hook, Intro, Outro } from '../scenes/Statements'
import { seconds } from '../video'

const TRANSITION = seconds(0.5)

export const SCENES = [
  { name: 'hook', Scene: Hook, duration: seconds(5.5) },
  { name: 'intro', Scene: Intro, duration: seconds(4) },
  { name: 'annotate', Scene: Annotate, duration: seconds(7) },
  { name: 'lecture', Scene: Lecture, duration: seconds(5) },
  { name: 'chat', Scene: Chat, duration: seconds(6.5) },
  { name: 'write', Scene: Write, duration: seconds(6.5) },
  { name: 'files', Scene: Files, duration: seconds(6) },
  { name: 'outro', Scene: Outro, duration: seconds(4) }
]

export const PROMO_DURATION =
  SCENES.reduce((total, scene) => total + scene.duration, 0) - TRANSITION * (SCENES.length - 1)

/** First frame of each scene in the finished video. */
export const sceneStarts = (): number[] =>
  SCENES.map((_, index) =>
    SCENES.slice(0, index).reduce((total, scene) => total + scene.duration - TRANSITION, 0)
  )

export function Promo() {
  return (
    <TransitionSeries>
      {SCENES.map(({ name, Scene, duration }, index) => (
        <Fragment key={name}>
          {index > 0 && (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION })}
            />
          )}
          <TransitionSeries.Sequence durationInFrames={duration}>
            <Scene />
          </TransitionSeries.Sequence>
        </Fragment>
      ))}
    </TransitionSeries>
  )
}
