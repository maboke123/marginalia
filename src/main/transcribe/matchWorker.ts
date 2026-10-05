// Matching a lecture's frames to its slides takes seconds; a worker keeps the app responsive.
import { parentPort, workerData } from 'node:worker_threads'
import { matchSlides, type SlideThumb } from '../../shared/slideMatch'

const { frames, slides, secondsPerFrame } = workerData as {
  frames: Uint8Array[]
  slides: SlideThumb[]
  secondsPerFrame: number
}
parentPort!.postMessage(matchSlides(frames, slides, secondsPerFrame))
