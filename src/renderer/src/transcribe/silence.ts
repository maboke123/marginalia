// A muted microphone on Windows still records, but every sample is zero. A quiet room with
// noise suppression stays well above this.
const QUIET = 1e-5

/** Notices when the microphone has given (almost) pure silence for `after` seconds. */
export class SilenceWatch {
  private quietFor = 0

  constructor(private readonly after = 3) {}

  /** One block of audio: its loudness (RMS) and length. True while it has been silent long enough. */
  push(rms: number, seconds: number): boolean {
    this.quietFor = rms < QUIET ? this.quietFor + seconds : 0
    return this.quietFor >= this.after
  }
}
