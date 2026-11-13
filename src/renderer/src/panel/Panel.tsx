import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry, PanelData, PanelView } from '../../../shared/painel'
import { Entry } from './Entry'
import { appName, countWords, formatNumber, groupByDay, ipcMessage, searchable } from './format'
import { BrandMark, SearchIcon, SettingsIcon } from './icons'
import { Settings } from './Settings'

const initialView: PanelView = new URLSearchParams(location.search).get('view') === 'configuracoes' ? 'configuracoes' : 'ditados'

function headline(entries: HistoryEntry[], hotkey: string): string {
  if (entries.length === 0) return `Segure ${hotkey} e fale`
  const today = new Date().toDateString()
  const words = entries
    .filter((e) => e.status === 'ok' && new Date(e.at).toDateString() === today)
    .reduce((sum, e) => sum + countWords(e.finalText), 0)
  if (words === 0) return 'Nada ditado hoje'
  return `${formatNumber(words)} ${words === 1 ? 'palavra' : 'palavras'} hoje`
}

export function Panel() {
  const [data, setData] = useState<PanelData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [view, setView] = useState<PanelView>(initialView)
  const searchRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      setData(await window.painel.load())
      setLoadError('')
    } catch (err) {
      setLoadError(ipcMessage(err))
    }
  }, [])

  useEffect(() => {
    void reload()
    window.painel.onChanged(() => void reload())
    window.painel.onShow(setView) // a bandeja pode pedir uma tela específica
  }, [reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setView('ditados')
        setTimeout(() => {
          searchRef.current?.focus()
          searchRef.current?.select()
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const entries = data?.entries ?? []
  const filtered = useMemo(() => {
    const q = searchable(query.trim())
    if (!q) return entries
    return entries.filter((e) =>
      searchable([e.finalText, e.rawText, appName(e.app), e.window, e.error ?? ''].join(' ')).includes(q)
    )
  }, [entries, query])
  const groups = useMemo(() => groupByDay(filtered), [filtered])

  const replaceEntry = (entry: HistoryEntry) =>
    setData((d) => d && { ...d, entries: d.entries.map((e) => (e.id === entry.id ? entry : e)) })

  const removeEntry = (id: string) => {
    setOpenId(null)
    setData((d) => d && { ...d, entries: d.entries.filter((e) => e.id !== id) })
  }

  const hotkey = data?.hotkeyLabel ?? 'o atalho'

  return (
    <div className="window">
      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <span className="brand__name">DigitAI</span>
        </div>
        <div className="titlebar__tools">
          <label className={`search${view === 'ditados' ? '' : ' search--hidden'}`}>
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              placeholder="Buscar"
              aria-label="Buscar no que você ditou"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!query && <kbd className="search__hint">Ctrl F</kbd>}
          </label>
          <button
            type="button"
            className={`icon-button${view === 'configuracoes' ? ' icon-button--on' : ''}`}
            onClick={() => setView((v) => (v === 'configuracoes' ? 'ditados' : 'configuracoes'))}
            aria-pressed={view === 'configuracoes'}
            aria-label="Configurações"
            title="Configurações"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="scroll">
        {view === 'configuracoes' ? (
          <Settings onBack={() => setView('ditados')} onSaved={() => void reload()} />
        ) : (
          <main className="feed">
            {data && <h1 className="headline">{headline(entries, hotkey)}</h1>}
            {loadError && <p className="load-error">Não consegui ler o histórico: {loadError}</p>}
  
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="day">{group.label}</h2>
                <ul className="entries">
                  {group.entries.map((entry) => (
                    <Entry
                      key={entry.id}
                      entry={entry}
                      open={entry.id === openId}
                      onToggle={() => setOpenId((id) => (id === entry.id ? null : entry.id))}
                      onUpdate={replaceEntry}
                      onRemove={removeEntry}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {data && entries.length > 0 && filtered.length === 0 && (
              <p className="empty">Nada encontrado para “{query}”.</p>
            )}
            {data && entries.length === 0 && (
              <p className="empty">Segure {hotkey} em qualquer campo de texto e fale. O que você ditar aparece aqui.</p>
            )}
          </main>
        )}
      </div>
    </div>
  )
}
