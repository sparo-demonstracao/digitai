import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { HistoryEntry } from '../../../shared/painel'
import { wordDiff } from './diff'
import { appName, clock, countWords, formatNumber, fullDate, ipcMessage, modelName, seconds, timeOf } from './format'
import { CheckIcon, CopyIcon, PauseIcon, PlayIcon, RetryIcon, TrashIcon } from './icons'

function useCopied(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return [
    copied,
    async (text) => {
      await window.painel.copy(text)
      setCopied(true)
    }
  ]
}

// Carrega o áudio só quando a pessoa pede para ouvir.
function AudioAction({ entry }: { entry: HistoryEntry }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [missing, setMissing] = useState(!entry.audioFile)

  useEffect(
    () => () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    []
  )

  if (missing) return null

  const toggle = async () => {
    if (!audioRef.current) {
      const result = await window.painel.audio(entry.id)
      if (!result) {
        setMissing(true)
        return
      }
      urlRef.current = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: result.mimeType }))
      const audio = new Audio(urlRef.current)
      audio.ontimeupdate = () => setPosition(audio.currentTime * 1000)
      audio.onended = () => {
        setPlaying(false)
        setPosition(0)
      }
      audioRef.current = audio
    }
    const audio = audioRef.current
    if (audio.paused) {
      await audio.play()
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  const shown = playing || position > 0 ? position : entry.durationMs
  return (
    <button type="button" className="action" onClick={() => void toggle()} aria-pressed={playing}>
      {playing ? <PauseIcon /> : <PlayIcon />}
      <span className="tabular">{playing ? `Pausar ${clock(shown)}` : `Ouvir ${clock(shown)}`}</span>
    </button>
  )
}

function DeleteAction({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`action action--end${armed ? ' action--danger' : ''}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      <TrashIcon />
      <span>{armed ? 'Confirmar exclusão' : 'Excluir'}</span>
    </button>
  )
}

/** Uma frase com o que o app fez, em vez de uma lista de rótulos. */
function summary(entry: HistoryEntry): string {
  const app = appName(entry.app)
  if (entry.status === 'erro') {
    const audio = entry.audioFile ? ' O áudio ficou guardado e pode ser transcrito de novo.' : ''
    return `Gravado no ${app}.${audio}`
  }
  const by = modelName(entry.model)
  const parts = [
    `Transcrito${by ? ` pelo ${by}` : ''} em ${seconds(entry.timings.transcribeMs)}`,
    entry.cleaned
      ? `limpo${entry.cleanupModel ? ` pelo ${modelName(entry.cleanupModel)}` : ''} em ${seconds(entry.timings.cleanupMs)}`
      : '',
    `colado no ${app}`
  ].filter(Boolean)
  const last = parts.pop()
  const words = countWords(entry.finalText)
  return `${parts.join(', ')} e ${last}. ${formatNumber(words)} ${words === 1 ? 'palavra' : 'palavras'} em ${clock(entry.durationMs)}.`
}

export function Entry({
  entry,
  open,
  onToggle,
  onUpdate,
  onRemove
}: {
  entry: HistoryEntry
  open: boolean
  onToggle: () => void
  onUpdate: (entry: HistoryEntry) => void
  onRemove: (id: string) => void
}) {
  const [copied, copy] = useCopied()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const failed = entry.status === 'erro'
  const changedByCleanup = entry.cleaned && !!entry.rawText && entry.rawText !== entry.finalText
  const windowTitle = entry.window && entry.window !== appName(entry.app) ? entry.window : ''

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }

  const quickCopy = (e: MouseEvent) => {
    e.stopPropagation()
    void copy(entry.finalText)
  }

  const retranscribe = async () => {
    setBusy(true)
    setActionError('')
    try {
      onUpdate(await window.painel.retranscribe(entry.id))
    } catch (err) {
      setActionError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      await window.painel.remove(entry.id)
      onRemove(entry.id)
    } catch (err) {
      setActionError(ipcMessage(err))
    }
  }

  return (
    <li className={`entry${open ? ' entry--open' : ''}${failed ? ' entry--erro' : ''}`}>
      <div className="entry__main" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={onKey}>
        <time className="entry__time" dateTime={entry.at}>
          {timeOf(entry.at)}
        </time>
        <p className="entry__text">
          {failed
            ? `Não transcrito. ${entry.error ?? ''}`
            : open
              ? entry.finalText
              : entry.finalText.replace(/\s*\n+\s*/g, ' ') /* fechado, as quebras de linha viram espaço */}
        </p>
        {!failed && (
          <button
            type="button"
            className="quick-copy"
            onClick={quickCopy}
            aria-label={copied ? 'Copiado' : 'Copiar texto'}
            title={copied ? 'Copiado' : 'Copiar texto'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {/* Ditado que falhou: dá para transcrever direto da lista, sem abrir. */}
        {failed && entry.audioFile && !open && (
          <button
            type="button"
            className="row-retry"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              void retranscribe()
            }}
          >
            <RetryIcon />
            <span>{busy ? 'Transcrevendo…' : 'Transcrever áudio'}</span>
          </button>
        )}
      </div>
      {failed && !open && actionError && (
        <p className="entry__error entry__error--row" role="alert">
          {actionError}
        </p>
      )}

      {open && (
        <div className="entry__more">
          <p className="entry__info">
            {summary(entry)}
            {windowTitle && <span className="entry__window"> Janela: {windowTitle}</span>}
            {entry.retranscribedAt && ` Transcrito de novo em ${fullDate(entry.retranscribedAt, false)}.`}
          </p>

          {changedByCleanup && (
            <details className="cleanup">
              <summary>Ver o que a limpeza mudou</summary>
              <p className="cleanup__diff">
                {wordDiff(entry.rawText, entry.finalText).map((part, i) =>
                  part.kind === 'same' ? (
                    <span key={i}>{part.text}</span>
                  ) : part.kind === 'removed' ? (
                    <del key={i}>{part.text}</del>
                  ) : (
                    <ins key={i}>{part.text}</ins>
                  )
                )}
              </p>
            </details>
          )}

          <div className="entry__actions">
            {!failed && (
              <button type="button" className="action" onClick={() => void copy(entry.finalText)}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            )}
            <AudioAction entry={entry} />
            {entry.audioFile && (
              <button
                type="button"
                className={`action${failed ? ' action--primary' : ''}`}
                onClick={() => void retranscribe()}
                disabled={busy}
              >
                <RetryIcon />
                <span>{busy ? 'Transcrevendo…' : failed ? 'Transcrever áudio' : 'Transcrever de novo'}</span>
              </button>
            )}
            <DeleteAction onConfirm={() => void remove()} />
          </div>
          {actionError && (
            <p className="entry__error" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
