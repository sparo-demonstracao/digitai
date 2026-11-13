// WAV PCM 16 bits mono, o formato que a barra grava: ler, cortar em pedaços e medir se há fala.

export interface Pcm {
  sampleRate: number
  samples: Int16Array
}

/** Lê um WAV PCM 16 bits mono. Devolve null para qualquer outro formato. */
export function parseWav(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16 || !sampleRate) return null
      const length = Math.min(size, buf.length - body) & ~1
      // slice copia para um ArrayBuffer próprio, alinhado como o Int16Array exige.
      const copy = buf.buffer.slice(buf.byteOffset + body, buf.byteOffset + body + length)
      return { sampleRate, samples: new Int16Array(copy) }
    }
    offset = body + size + (size % 2)
  }
  return null
}

export function encodeWav(samples: Int16Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.byteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.byteLength, 40)
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)])
}

const FRAME_SEC = 0.05
const PAUSE_FRAMES = 6 // procura a pausa de 300 ms mais silenciosa: uma pausa entre frases, não o "p" de uma palavra

/**
 * Corta o áudio em pedaços de até `maxSec`. Cada corte cai no trecho mais silencioso
 * dos últimos `searchSec` antes do limite, para não partir uma palavra ao meio.
 */
export function splitAtPauses({ sampleRate, samples }: Pcm, maxSec: number, searchSec: number): Int16Array[] {
  const max = Math.floor(maxSec * sampleRate)
  const frame = Math.floor(FRAME_SEC * sampleRate)
  const searchFrames = Math.floor(searchSec / FRAME_SEC)
  const pieces: Int16Array[] = []
  let start = 0
  while (samples.length - start > max) {
    const searchStart = start + max - searchFrames * frame
    const energy = new Float64Array(searchFrames)
    for (let f = 0; f < searchFrames; f++) {
      let sum = 0
      for (let i = searchStart + f * frame, end = i + frame; i < end; i++) sum += samples[i] * samples[i]
      energy[f] = sum
    }
    let best = 0
    let bestSum = Infinity
    for (let f = 0; f + PAUSE_FRAMES <= searchFrames; f++) {
      let sum = 0
      for (let k = 0; k < PAUSE_FRAMES; k++) sum += energy[f + k]
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    const cut = searchStart + (best + PAUSE_FRAMES / 2) * frame
    pieces.push(samples.subarray(start, cut))
    start = cut
  }
  pieces.push(samples.subarray(start))
  return pieces
}

const SPEECH_RMS = 0.02 * 0x7fff

/** Fração (0 a 1) dos trechos de 50 ms com volume de fala. */
export function speechRatio(samples: Int16Array, sampleRate: number): number {
  const frame = Math.floor(FRAME_SEC * sampleRate)
  const frames = Math.floor(samples.length / frame)
  if (frames === 0) return 0
  let loud = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * frame, end = i + frame; i < end; i++) sum += samples[i] * samples[i]
    if (Math.sqrt(sum / frame) > SPEECH_RMS) loud++
  }
  return loud / frames
}
