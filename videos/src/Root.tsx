import { Composition } from 'remotion'
import { Promo, PROMO_DURATION } from './compositions/Promo'
import { waitForFonts } from './fonts'
import { FPS, HEIGHT, WIDTH } from './video'
import './index.css'

waitForFonts()

export function Root() {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={PROMO_DURATION}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  )
}
