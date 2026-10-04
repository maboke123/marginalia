import { Chunker, RATE, type Chunk } from './chunker'

export interface Microphone {
  /** Stops recording; resolves once the last audio and the last chunk were handed over. */
  stop(): Promise<void>
}

export interface MicrophoneHandlers {
  /** About 30 s of 16 kHz audio, for whisper. */
  onChunk(chunk: Chunk): void
  /** Compressed audio (webm/opus) to keep, every few seconds. */
  onAudio(data: Uint8Array): Promise<void>
  /** Loudness from 0 to 1, about ten times a second, for the level meter. */
  onLevel(level: number): void
}

// Speech stays clear at this rate and an hour is about 15 MB.
const AUDIO_BITS = 32_000

/**
 * The microphone, recorded two ways at once: 16 kHz samples cut into chunks for whisper,
 * and compressed audio that is kept with the transcript.
 */
export async function startMicrophone(handlers: MicrophoneHandlers): Promise<Microphone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // A lecturer far away: let the browser even out loudness and filter steady noise.
      autoGainControl: true,
      noiseSuppression: true,
      echoCancellation: false
    }
  })
  const context = new AudioContext({ sampleRate: RATE })
  const source = context.createMediaStreamSource(stream)
  // A ScriptProcessor rather than an AudioWorklet: a worklet module cannot be loaded from the
  // file:// page of the installed app. 4096 samples is a quarter of a second.
  const capture = context.createScriptProcessor(4096, 1, 1)
  // Connected through a muted gain so the graph runs without playing the microphone back.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(capture).connect(mute).connect(context.destination)

  const chunker = new Chunker()
  capture.onaudioprocess = (e) => {
    const block = new Float32Array(e.inputBuffer.getChannelData(0))
    let sum = 0
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
    handlers.onLevel(Math.min(1, Math.sqrt(sum / block.length) * 4))
    for (const chunk of chunker.push(block)) handlers.onChunk(chunk)
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: AUDIO_BITS
  })
  let writes = Promise.resolve()
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return
    writes = writes.then(async () => handlers.onAudio(new Uint8Array(await e.data.arrayBuffer())))
  }
  // Written every 5 s, so a crash loses at most that.
  recorder.start(5000)

  return {
    async stop() {
      const stopped = new Promise((r) => recorder.addEventListener('stop', r, { once: true }))
      recorder.stop()
      await stopped
      capture.onaudioprocess = null
      capture.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      await context.close()
      const rest = chunker.flush()
      if (rest) handlers.onChunk(rest)
      await writes
    }
  }
}
