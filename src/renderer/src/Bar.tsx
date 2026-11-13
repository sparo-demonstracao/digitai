import { useEffect, useRef, useState } from 'react'
import type { BarCard, BarState, CardAction } from '../../shared/ipc'
import { Recorder, RecorderError } from './recorder'
import { sounds } from './sounds'

const BAR_COUNT = 18
const CARD_MS = 15_000 // o cartão some sozinho; com o mouse em cima, espera

const ACTION_LABELS: Record<CardAction, string> = { colar: 'Colar', copiar: 'Copiar', painel: 'Abrir painel' }
const ENDING_MS = 60_000 // no último minuto do limite, o tempo fica em destaque

// Microfone travado: quando o ditado começou (no relógio da barra) e até quando pode ir.
interface Lock {
  startedAt: number
  limitMs: number
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function LockIcon() {
  return (
    <svg className="lock" width="11" height="13" viewBox="0 0 11 13" aria-hidden="true">
      <rect x="0.75" y="5.25" width="9.5" height="7" rx="1.6" fill="currentColor" />
      <path d="M2.75 5.5V3.75a2.75 2.75 0 0 1 5.5 0V5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function Bar() {
  const [state, setState] = useState<BarState>('idle')
  const [message, setMessage] = useState('')
  const [card, setCard] = useState<BarCard | null>(null)
  const [lock, setLock] = useState<Lock | null>(null)
  const [now, setNow] = useState(() => performance.now())
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const recorderRef = useRef<Recorder | null>(null)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    // O bipe de início espera o microfone abrir e, em atalhos como Ctrl+S, a janela de toque rápido.
    const dictation = { id: 0, startedAt: 0, beepDelayMs: 0, beepTimer: 0 }

    const recorder = new Recorder(
      (payload) => window.ditado.sendAudio(payload),
      (id) => {
        if (id !== dictation.id) return
        const wait = Math.max(0, dictation.startedAt + dictation.beepDelayMs - performance.now())
        dictation.beepTimer = window.setTimeout(() => {
          if (dictation.id === id) sounds.start()
        }, wait)
      }
    )
    recorderRef.current = recorder

    const endDictation = () => {
      window.clearTimeout(dictation.beepTimer)
      dictation.id = 0
    }

    window.ditado.onCommand(({ command, id, quiet, beepDelayMs }) => {
      if (command === 'start') {
        Object.assign(dictation, { id, startedAt: performance.now(), beepDelayMs: beepDelayMs ?? 0 })
        recorder.start(id).catch((err) => {
          endDictation()
          sounds.error()
          window.ditado.sendError(id, err instanceof RecorderError ? err.message : String(err))
        })
      } else if (command === 'stop') {
        endDictation()
        sounds.stop()
        recorder.stop(id)
      } else {
        endDictation()
        if (!quiet) sounds.cancel()
        recorder.cancel(id)
      }
    })

    window.ditado.onState(({ state: next, message: text, card: nextCard, lock: nextLock }) => {
      window.clearTimeout(resetTimer.current)
      setState(next)
      setMessage(text ?? '')
      setCard(nextCard ?? null)
      if (nextLock) {
        sounds.lock()
        setLock({ startedAt: performance.now() - nextLock.elapsedMs, limitMs: nextLock.limitMs })
      } else if (next !== 'recording') {
        setLock(null)
      }
      if (next === 'card') {
        if (nextCard?.tone === 'erro') sounds.error()
        else sounds.start()
        resetTimer.current = window.setTimeout(() => setState('idle'), CARD_MS)
      } else if (next === 'error') {
        sounds.error()
        resetTimer.current = window.setTimeout(() => setState('idle'), 3500)
      } else if (next === 'info') {
        resetTimer.current = window.setTimeout(() => setState('idle'), 2500)
      } else if (next === 'done') {
        resetTimer.current = window.setTimeout(() => setState('idle'), 700)
      }
    })
  }, [])

  // Onda do áudio: desloca as barras para a esquerda a cada quadro enquanto grava.
  useEffect(() => {
    if (state !== 'recording') {
      setLevels(Array(BAR_COUNT).fill(0))
      return
    }
    let frame = 0
    let tick = 0
    const loop = () => {
      const level = recorderRef.current?.level() ?? 0
      if (tick++ % 3 === 0) setLevels((prev) => [...prev.slice(1), level])
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [state])

  // Travado, o tempo gravado anda de segundo em segundo.
  useEffect(() => {
    if (state !== 'recording' || !lock) return
    setNow(performance.now())
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state, lock])

  // O mouse só é acompanhado enquanto o cartão está na tela (vale também quando ele some sozinho).
  useEffect(() => {
    window.ditado.setMouse(state === 'card' ? 'watch' : 'ignore')
  }, [state])

  const closeCard = () => {
    window.clearTimeout(resetTimer.current)
    setState('idle')
  }

  if (state === 'card' && card) {
    return (
      <div className="stage">
        <div
          className={`card card--${card.tone ?? 'ok'}`}
          role="dialog"
          aria-label={card.title}
          onMouseEnter={() => {
            window.clearTimeout(resetTimer.current)
            window.ditado.setMouse('interactive')
          }}
          onMouseLeave={() => {
            window.ditado.setMouse('watch')
            resetTimer.current = window.setTimeout(() => setState('idle'), 6000)
          }}
        >
          <div className="card__head">
            <p className="card__title">{card.title}</p>
            <button type="button" className="card__close" aria-label="Fechar" onClick={closeCard}>
              ×
            </button>
          </div>
          <p className="card__text">{card.text}</p>
          <div className="card__actions">
            {card.actions.map((action, i) => (
              <button
                key={action}
                type="button"
                className={`card__button${i === 0 ? ' card__button--primary' : ''}`}
                onClick={() => {
                  closeCard()
                  window.ditado.cardAction(action, card.entryId)
                }}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stage">
      <div className={`pill pill--${state}${state === 'recording' && lock ? ' pill--locked' : ''}`}>
        {state === 'recording' && lock && <LockIcon />}
        {state === 'recording' && (
          <div className="wave">
            {levels.map((l, i) => (
              <span key={i} style={{ height: `${Math.max(3, l * 22)}px` }} />
            ))}
          </div>
        )}
        {state === 'recording' && lock && (
          <span className={`elapsed${lock.limitMs - (now - lock.startedAt) < ENDING_MS ? ' elapsed--ending' : ''}`}>
            {formatElapsed(now - lock.startedAt)}
          </span>
        )}
        {state === 'processing' && (
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
        )}
        {state === 'done' && <div className="check">✓</div>}
        {(state === 'error' || state === 'info') && <div className="message">{message}</div>}
      </div>
    </div>
  )
}
