// Bipes curtos gerados na hora (sem arquivos de áudio).
// Cada bipe abre e fecha o próprio AudioContext: um contexto aberto gasta CPU mesmo em silêncio.
function tone(freqs: number[], durationMs: number, volume = 0.06): void {
  const ctx = new AudioContext()
  const now = ctx.currentTime
  const step = durationMs / 1000 / freqs.length
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = now + i * step
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(volume, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + step + 0.02)
  })
  setTimeout(() => void ctx.close(), durationMs + 200)
}

export const sounds = {
  start: () => tone([660, 880], 120),
  lock: () => tone([660, 880, 1175], 210), // travou: o mesmo bipe de início com uma nota a mais
  stop: () => tone([880, 660], 120),
  cancel: () => tone([440, 330], 140, 0.05),
  error: () => tone([300, 220], 220, 0.05)
}
