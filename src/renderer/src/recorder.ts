import type { AudioPayload } from '../../shared/ipc'

const MIME_TYPE = 'audio/webm;codecs=opus'

export class RecorderError extends Error {}

const WAV_SAMPLE_RATE = 16_000 // o suficiente para voz e o que os modelos de transcrição usam

/** Decodifica a gravação e gera um WAV mono 16 kHz, 16 bits. */
async function toWav16k(blob: Blob): Promise<Uint8Array> {
  // Um contexto a 16 kHz já decodifica reamostrado: num ditado travado de 15 minutos,
  // evita segurar o áudio inteiro a 48 kHz na memória.
  const decodeCtx = new AudioContext({ sampleRate: WAV_SAMPLE_RATE })
  let samples: Float32Array
  try {
    samples = (await decodeCtx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0)
  } finally {
    void decodeCtx.close()
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // tamanho do bloco fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, WAV_SAMPLE_RATE, true)
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true) // bytes por segundo
  view.setUint16(32, 2, true) // bytes por amostra
  view.setUint16(34, 16, true) // bits por amostra
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  const pcm = new Int16Array(buffer, 44, samples.length) // o Windows é little-endian, como o WAV
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff
  return new Uint8Array(buffer)
}

function describeMicError(err: unknown): string {
  const name = (err as DOMException)?.name
  if (name === 'NotAllowedError') return 'Microfone bloqueado. Libere em Configurações > Privacidade > Microfone.'
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado.'
  if (name === 'NotReadableError') return 'O microfone está sendo usado por outro programa.'
  return `Erro no microfone: ${String(err)}`
}

/**
 * Grava o microfone enquanto o atalho está pressionado.
 * Mede o volume em tempo real (para a onda na barra e para detectar silêncio).
 */
export class Recorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Float32Array<ArrayBuffer> | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private peak = 0
  private id = 0
  // O atalho pode ser solto antes de o microfone terminar de abrir.
  private pending: 'stop' | 'cancel' | null = null

  constructor(
    private onAudio: (payload: AudioPayload) => void,
    private onStarted: (id: number) => void
  ) {}

  async start(id: number): Promise<void> {
    this.id = id
    this.pending = null
    this.chunks = []
    this.peak = 0

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      })
    } catch (err) {
      throw new RecorderError(describeMicError(err))
    }
    if (this.id !== id) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    this.audioCtx = new AudioContext()
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 1024
    this.samples = new Float32Array(this.analyser.fftSize)
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser)

    this.recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE, audioBitsPerSecond: 32_000 })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start(250)
    this.startedAt = performance.now()
    this.onStarted(id)

    if (this.pending === 'stop') this.stop(id)
    else if (this.pending === 'cancel') this.cancel(id)
  }

  /** Volume atual de 0 a 1 (chamado a cada quadro pela barra). */
  level(): number {
    if (!this.analyser || !this.samples) return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    let max = 0
    for (const s of this.samples) {
      sum += s * s
      const a = Math.abs(s)
      if (a > max) max = a
    }
    if (max > this.peak) this.peak = max
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 6)
  }

  stop(id: number): void {
    if (id !== this.id) return
    const recorder = this.recorder
    if (!recorder) {
      this.pending = 'stop'
      return
    }
    this.level() // garante uma última medição de pico
    recorder.onstop = async () => {
      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      const durationMs = performance.now() - this.startedAt
      const peak = this.peak
      this.release()
      // WAV é aceito por todos os serviços (o OpenRouter não aceita webm); se a conversão falhar, vai o original.
      try {
        const data = await toWav16k(blob)
        this.onAudio({ id, data, mimeType: 'audio/wav', durationMs, peak })
      } catch {
        const data = new Uint8Array(await blob.arrayBuffer())
        this.onAudio({ id, data, mimeType: recorder.mimeType, durationMs, peak })
      }
    }
    recorder.stop()
  }

  cancel(id: number): void {
    if (id !== this.id) return
    if (!this.recorder) {
      this.pending = 'cancel'
      return
    }
    this.recorder.onstop = () => this.release()
    this.recorder.stop()
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.audioCtx?.close()
    this.stream = null
    this.recorder = null
    this.audioCtx = null
    this.analyser = null
    this.samples = null
    this.chunks = []
  }
}
