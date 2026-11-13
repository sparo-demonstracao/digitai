import { cpSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  shell,
  Tray
} from 'electron'
import envTemplate from '../../.env.example?raw'
import { cleanupActive, configProblems, envFilePath, loadConfig, readKey, saveSettings, settingsView, type Config } from './config'
import { verifyKey } from './verify'
import { HoldHotkey, TAP_MS } from './hotkey'
import { LOST_PART, transcribe, TranscriptionError } from './transcribe'
import { cleanupText } from './cleanup'
import { pasteText } from './paste'
import { deleteHistory, findHistory, listHistory, newHistoryId, readAudio, saveAudio, saveHistory, updateHistory } from './history'
import { getActiveWindow, type ActiveWindow } from './win32'
import { log } from './logger'
import type { AudioPayload, BarCard, BarMouse, BarState, CardAction, RecCommand } from '../shared/ipc'
import type { HistoryEntry, HistoryTimings, KeyCheck, KeyName, PanelAudio, PanelData, PanelView, SettingsPatch, SettingsView } from '../shared/painel'

const MAX_RECORDING_MS = 5 * 60_000
const MAX_LOCKED_MS = 15 * 60_000 // travado (sem segurar o atalho) dá para falar por mais tempo
const MIN_RECORDING_MS = 350 // menos que isso é toque acidental no atalho
const SILENCE_PEAK = 0.015 // pico de volume abaixo disso = microfone mudo

type Phase = 'idle' | 'recording' | 'processing'

interface Dictation {
  id: number
  config: Config
  win: ActiveWindow | null
  startedAt: number
  locked: boolean
  maxTimer: NodeJS.Timeout
  showTimer: NodeJS.Timeout // mostra a barra de gravação só depois da janela de "toque rápido"
}

let bar: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let tray: Tray | null = null
let hotkey: HoldHotkey | null = null
let phase: Phase = 'idle'
let current: Dictation | null = null
let nextId = 1
let lastText = ''
let pendingNotice: NodeJS.Timeout | null = null

// ---------- barra flutuante ----------

const BAR_WIDTH = 420 // largura e altura comportam o cartão de transcrição pronta
const BAR_HEIGHT = 200

function positionBar(): void {
  if (!bar) return
  const { workArea } = screen.getPrimaryDisplay()
  bar.setBounds({
    x: Math.round(workArea.x + (workArea.width - BAR_WIDTH) / 2),
    y: workArea.y + workArea.height - BAR_HEIGHT,
    width: BAR_WIDTH,
    height: BAR_HEIGHT
  })
}

function createBar(): void {
  bar = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false, // nunca rouba o foco do app em que a pessoa está digitando
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      // A barra nunca recebe clique; sem isso o Chromium deixa o áudio suspenso (sem medidor nem bipes).
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.setIgnoreMouseEvents(true) // cliques atravessam a barra
  barMouse = 'ignore'
  positionBar()

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    bar.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    bar.loadFile(join(__dirname, '../renderer/index.html'))
  }
  bar.once('ready-to-show', () => bar?.showInactive())
  bar.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') log.warn(`[barra] ${event.message}`)
  })
}

// No Windows, uma janela "sempre por cima" que nunca recebe foco pode cair para trás de outros apps.
// Antes de aparecer, ela volta para o topo (desligar e religar recoloca no alto da pilha).
function raiseBar(): void {
  if (!bar) return
  bar.setAlwaysOnTop(false)
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.moveTop()
}

let barMouse: BarMouse = 'ignore'

// Só com o cartão na tela a barra acompanha o mouse (para aceitar cliques quando ele está em cima).
// Acompanhar o tempo todo faria o Windows avisar o app a cada movimento do mouse, gastando CPU à toa.
function setBarMouse(mode: BarMouse): void {
  if (!bar || mode === barMouse) return
  barMouse = mode
  if (mode === 'interactive') bar.setIgnoreMouseEvents(false)
  else bar.setIgnoreMouseEvents(true, { forward: mode === 'watch' })
}

function setBar(state: BarState, message?: string): void {
  if (state !== 'idle') raiseBar()
  bar?.webContents.send('bar:state', { state, message })
}

function sendCommand(command: RecCommand, id: number, extra: { quiet?: boolean; beepDelayMs?: number } = {}): void {
  bar?.webContents.send('rec:command', { command, id, ...extra })
}

function showError(message: string): void {
  log.warn(message)
  setBar('error', message)
}

// ---------- ciclo do ditado ----------

function startDictation(): void {
  if (phase !== 'idle') return
  const config = loadConfig() // relê o .env a cada ditado: editar as chaves não exige reiniciar
  // Com atalho de tecla comum (Ctrl+S), um toque rápido é o "Salvar" do app: nada de bipe nem barra.
  const delay = hotkey?.hasTrigger ? TAP_MS : 0
  const problems = configProblems(config)
  if (problems.length > 0) {
    pendingNotice = setTimeout(() => {
      pendingNotice = null
      showError(`${problems.join('. ')}. Abra as configurações no ícone da bandeja.`)
      refreshTray(config)
    }, delay)
    return
  }

  const id = nextId++
  current = {
    id,
    config,
    win: getActiveWindow(), // app onde o texto vai entrar
    startedAt: Date.now(),
    locked: false,
    maxTimer: setTimeout(() => stopDictation(), MAX_RECORDING_MS),
    showTimer: setTimeout(() => {
      if (current?.id === id && phase === 'recording') setBar('recording')
    }, delay)
  }
  phase = 'recording'
  sendCommand('start', id, { beepDelayMs: delay })
  log.info(`Gravando #${id} em ${current.win?.processName ?? '?'} — "${current.win?.title ?? ''}"`)
}

// Atalho + Espaço: o microfone segue gravando sem segurar; o atalho de novo termina.
function lockDictation(): void {
  if (phase !== 'recording' || !current) return
  const dictation = current
  const elapsedMs = Date.now() - dictation.startedAt
  dictation.locked = true
  clearTimeout(dictation.showTimer)
  clearTimeout(dictation.maxTimer)
  dictation.maxTimer = setTimeout(() => stopDictation(), MAX_LOCKED_MS - elapsedMs)
  raiseBar()
  bar?.webContents.send('bar:state', { state: 'recording', lock: { elapsedMs, limitMs: MAX_LOCKED_MS } })
  log.info(`#${dictation.id} travado: o atalho de novo termina`)
}

function stopDictation(): void {
  if (phase !== 'recording' || !current) return
  clearTimeout(current.maxTimer)
  clearTimeout(current.showTimer)
  hotkey?.unlock() // se parou pelo limite de tempo, o próximo atalho é um ditado novo
  if (current.locked) log.info(`#${current.id} travado por ${Math.round((Date.now() - current.startedAt) / 1000)} s`)
  phase = 'processing'
  sendCommand('stop', current.id)
  setBar('processing')
}

function cancelDictation(quiet = false): void {
  if (phase !== 'recording' || !current) return
  clearTimeout(current.maxTimer)
  clearTimeout(current.showTimer)
  hotkey?.unlock()
  sendCommand('cancel', current.id, { quiet })
  if (!quiet) log.info(`Ditado #${current.id} cancelado`)
  current = null
  phase = 'idle'
  setBar('idle')
}

// Toque rápido no atalho (ex.: Ctrl+S para salvar): já foi reenviado ao app; descarta a gravação.
function onTap(): void {
  if (pendingNotice) clearTimeout(pendingNotice)
  pendingNotice = null
  if (current) log.info(`#${current.id} era só um toque rápido: atalho devolvido ao app`)
  cancelDictation(true)
}

function finish(state: BarState = 'idle', message?: string): void {
  current = null
  phase = 'idle'
  hotkey?.unlock()
  if (state === 'error' && message) showError(message)
  else setBar(state, message)
}

async function waitForHotkeyRelease(timeoutMs = 1500): Promise<void> {
  const until = Date.now() + timeoutMs
  while (hotkey?.isAnyHeld() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 30))
  }
}

const NOTHING_HEARD = 'Não entendi o áudio. Tente de novo.'

interface PipelineResult {
  rawText: string
  finalText: string
  cleaned: boolean
  cleanupModel?: string
  timings: HistoryTimings
}

/** Transcreve e limpa um áudio. Usado no ditado e no "Transcrever de novo" do painel. */
async function runPipeline(audio: Buffer, mimeType: string, win: ActiveWindow | null, config: Config): Promise<PipelineResult> {
  const t0 = Date.now()
  const rawText = config.testText || (await transcribe(audio, mimeType, config))
  const t1 = Date.now()
  const finalText = rawText ? await cleanupText(rawText, win, config) : ''
  const t2 = Date.now()
  return {
    rawText,
    finalText: finalText.trim() ? finalText : '',
    cleaned: !!rawText && cleanupActive(config),
    cleanupModel: rawText && cleanupActive(config) ? config.claudeModel : undefined,
    timings: { transcribeMs: t1 - t0, cleanupMs: t2 - t1, totalMs: t2 - t0 }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof TranscriptionError ? err.message : `Erro inesperado: ${String(err)}`
}

async function handleAudio(payload: AudioPayload): Promise<void> {
  const dictation = current
  if (!dictation || payload.id !== dictation.id || phase !== 'processing') return

  const { config } = dictation
  log.info(`#${dictation.id} áudio: ${Math.round(payload.durationMs)}ms, ${payload.data.byteLength} bytes, pico ${payload.peak.toFixed(3)}`)
  if (process.env['DEBUG_AUDIO']) {
    const ext = payload.mimeType.includes('wav') ? 'wav' : 'webm'
    writeFileSync(join(app.getPath('userData'), `ultimo-audio.${ext}`), payload.data)
  }
  // Modo de teste: troca o que o microfone gravou por um arquivo de áudio.
  const testAudio = config.testAudio ? readFileSync(config.testAudio) : null
  if (payload.durationMs < MIN_RECORDING_MS) return finish('idle')
  if (payload.peak < SILENCE_PEAK && !config.testText && !testAudio) return finish('error', 'Não ouvi nada. Confira o microfone.')

  const audio = testAudio ?? Buffer.from(payload.data)
  const mimeType = testAudio ? 'audio/wav' : payload.mimeType
  const id = newHistoryId()
  const base = {
    id,
    at: new Date().toISOString(),
    app: dictation.win?.processName ?? '',
    window: dictation.win?.title ?? '',
    durationMs: Math.round(payload.durationMs),
    provider: config.transcribeProvider,
    model: config.transcribeModel,
    audioFile: saveAudio(id, audio, mimeType), // guardado mesmo se falhar: dá para transcrever de novo
    audioMime: mimeType
  }

  try {
    const result = await runPipeline(audio, mimeType, dictation.win, config)
    if (!result.finalText) throw new TranscriptionError(NOTHING_HEARD)

    await waitForHotkeyRelease()
    await pasteText(result.finalText)
    lastText = result.finalText
    refreshTray(config)

    log.info(
      `#${dictation.id} ok (${base.durationMs}ms de áudio; transcrição ${result.timings.transcribeMs}ms, limpeza ${result.timings.cleanupMs}ms)`
    )
    saveHistory({ ...base, status: 'ok', ...result })
    if (result.finalText.includes(LOST_PART)) {
      log.warn(`#${dictation.id}: um trecho não saiu e ficou marcado com ${LOST_PART}`)
      finish('info', `Um trecho não saiu e ficou marcado com ${LOST_PART}. Dá para transcrever de novo pelo painel.`)
    } else {
      finish('done')
    }
  } catch (err) {
    const message = errorMessage(err)
    const retry = err instanceof TranscriptionError && err.retryable
    saveHistory({
      ...base,
      status: 'erro',
      error: retry ? `${message} Tentando de novo…` : message,
      rawText: '',
      finalText: '',
      timings: { transcribeMs: 0, cleanupMs: 0, totalMs: 0 }
    })
    if (retry) {
      log.warn(`#${dictation.id} falhou (${message}); novas tentativas em segundo plano`)
      finish('info', 'Não consegui transcrever agora. Vou tentar de novo em alguns segundos.')
      void retryInBackground(id, audio, mimeType, dictation.win)
    } else {
      finish('error', message)
    }
  }
  panel?.webContents.send('painel:mudou')
}

// Instabilidade da API costuma passar em segundos: tenta de novo depois de 3 s, 8 s e 20 s.
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function retryInBackground(id: string, audio: Buffer, mimeType: string, win: ActiveWindow | null): Promise<void> {
  let lastError = NOTHING_HEARD
  for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
    await sleep(delay)
    const config = loadConfig()
    try {
      const result = await runPipeline(audio, mimeType, win, config)
      if (!result.finalText) throw new TranscriptionError(NOTHING_HEARD)
      updateHistory(id, {
        ...result,
        status: 'ok',
        error: undefined,
        provider: config.transcribeProvider,
        model: config.transcribeModel,
        retranscribedAt: new Date().toISOString()
      })
      lastText = result.finalText
      refreshTray(config)
      panel?.webContents.send('painel:mudou')
      log.info(`Ditado ${id} transcrito na tentativa ${i + 2}`)
      // Não cola sozinho: a pessoa pode estar em outro lugar. O cartão oferece Colar e Copiar.
      showCard({ entryId: id, title: 'Transcrição pronta', text: result.finalText, actions: ['colar', 'copiar'], tone: 'ok' })
      return
    } catch (err) {
      lastError = errorMessage(err)
      log.warn(`Ditado ${id}: tentativa ${i + 2} falhou (${lastError})`)
      if (err instanceof TranscriptionError && !err.retryable) break
    }
  }
  updateHistory(id, { error: lastError })
  panel?.webContents.send('painel:mudou')
  showCard({
    entryId: id,
    title: 'Não consegui transcrever',
    text: 'O áudio ficou salvo no painel. Abra o painel e clique em Transcrever áudio quando a conexão voltar.',
    actions: ['painel'],
    tone: 'erro'
  })
}

function showCard(card: BarCard): void {
  if (phase !== 'idle') {
    // No meio de um ditado novo, o cartão espera ele terminar para não atrapalhar.
    setTimeout(() => showCard(card), 1500)
    return
  }
  raiseBar()
  bar?.webContents.send('bar:state', { state: 'card', card })
}

async function onCardAction(action: CardAction, entryId: string): Promise<void> {
  setBarMouse('ignore')
  setBar('idle')
  if (action === 'painel') return showPanel()
  const text = findHistory(entryId)?.finalText
  if (!text) return
  if (action === 'copiar') {
    await clipboard.writeText(text)
    setBar('info', 'Copiado')
  } else {
    // A barra nunca recebe foco, então o clique não tira o cursor do app em que a pessoa está.
    await pasteText(text)
  }
}

// ---------- painel ----------

function iconPath(file: string): string {
  return app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../resources', file)
}

/**
 * Abre o painel. Ele só existe enquanto está aberto: ao fechar, a janela é destruída
 * e não sobra nada rodando em segundo plano.
 */
// Mica: o fundo translúcido do Windows 11 (22H2+). Desenhado pelo próprio Windows, não custa nada ao app.
const SUPPORTS_MICA = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621
const TITLE_BAR_HEIGHT = 44

function titleBarOverlay(): Electron.TitleBarOverlay {
  return {
    color: '#00000000', // transparente: o fundo do painel aparece atrás dos botões da janela
    symbolColor: nativeTheme.shouldUseDarkColors ? '#d6d9e8' : '#2a2e40',
    height: TITLE_BAR_HEIGHT
  }
}

// O Windows pode minimizar a janela sem o Electron saber (ex.: app aberto por um lançador oculto),
// então isMinimized() não é confiável: restaura sempre, a menos que a pessoa tenha maximizado.
function bringToFront(win: BrowserWindow): void {
  if (!win.isMaximized()) win.restore()
  win.show()
  win.focus()
}

function showPanel(view: PanelView = 'ditados'): void {
  if (panel) {
    bringToFront(panel)
    panel.webContents.send('painel:mostrar', view)
    return
  }
  const dark = nativeTheme.shouldUseDarkColors
  panel = new BrowserWindow({
    width: 880,
    height: 740,
    minWidth: 560,
    minHeight: 480,
    show: false,
    title: 'DigitAI',
    icon: iconPath('icon.png'),
    titleBarStyle: 'hidden', // barra de título desenhada pelo painel, com os botões nativos da janela
    titleBarOverlay: titleBarOverlay(),
    backgroundMaterial: SUPPORTS_MICA ? 'mica' : undefined,
    backgroundColor: SUPPORTS_MICA ? '#00000000' : dark ? '#14172A' : '#F1F2F8',
    webPreferences: {
      preload: join(__dirname, '../preload/panel.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  panel.removeMenu()
  const material = SUPPORTS_MICA ? 'mica' : 'solido'
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/panel.html?material=${material}&view=${view}`)
  } else {
    panel.loadFile(join(__dirname, '../renderer/panel.html'), { query: { material, view } })
  }
  panel.once('ready-to-show', () => panel && bringToFront(panel))
  panel.on('closed', () => {
    panel = null
    hotkey?.setPaused(false) // caso a janela feche no meio da gravação de um atalho novo
  })
  panel.webContents.on('console-message', (event) => {
    if (event.level === 'error') log.warn(`[painel] ${event.message}`)
  })
}

function fromPanel(event: Electron.IpcMainInvokeEvent): void {
  if (!panel || event.sender !== panel.webContents) throw new Error('Pedido fora do painel')
}

function registerPanelHandlers(): void {
  ipcMain.handle('painel:dados', (event): PanelData => {
    fromPanel(event)
    const config = loadConfig()
    return { entries: listHistory(), hotkeyLabel: hotkey?.label ?? config.hotkey, cleanupOn: cleanupActive(config) }
  })

  ipcMain.handle('painel:copiar', async (event, text: string) => {
    fromPanel(event)
    await clipboard.writeText(String(text))
  })

  ipcMain.handle('painel:excluir', (event, id: string) => {
    fromPanel(event)
    deleteHistory(id)
  })

  ipcMain.handle('painel:audio', (event, id: string): PanelAudio | null => {
    fromPanel(event)
    const entry = findHistory(id)
    const data = entry ? readAudio(entry) : null
    return data && entry ? { data: new Uint8Array(data), mimeType: entry.audioMime ?? 'audio/wav' } : null
  })

  ipcMain.handle('painel:retranscrever', async (event, id: string): Promise<HistoryEntry> => {
    fromPanel(event)
    const entry = findHistory(id)
    if (!entry) throw new Error('Ditado não encontrado.')
    const audio = readAudio(entry)
    if (!audio) throw new Error('O áudio deste ditado não foi guardado.')
    const config = loadConfig()
    const problems = configProblems(config)
    if (problems.length > 0) throw new Error(`${problems.join('. ')}. Configure em Configurações.`)

    let result: PipelineResult
    try {
      result = await runPipeline(audio, entry.audioMime ?? 'audio/wav', { title: entry.window, processName: entry.app, pid: 0 }, config)
    } catch (err) {
      throw new Error(errorMessage(err))
    }
    if (!result.finalText) throw new Error(NOTHING_HEARD)
    const updated = updateHistory(id, {
      ...result,
      status: 'ok',
      error: undefined,
      provider: config.transcribeProvider,
      model: config.transcribeModel,
      retranscribedAt: new Date().toISOString()
    })
    if (!updated) throw new Error('Ditado não encontrado.')
    log.info(`Ditado ${id} transcrito de novo pelo painel`)
    return updated
  })

  ipcMain.handle('painel:config', (event): SettingsView => {
    fromPanel(event)
    return settingsView(hotkey?.label ?? loadConfig().hotkey)
  })

  ipcMain.handle('painel:salvar-config', (event, patch: SettingsPatch): SettingsView => {
    fromPanel(event)
    if (patch.hotkey !== undefined) {
      patch.hotkey = patch.hotkey.toLowerCase()
      new HoldHotkey(patch.hotkey) // valida; lança "Atalho inválido…" se não der
    }
    ensureEnvFile()
    saveSettings(patch)
    onEnvChanged() // aplica na hora (o aviso do Windows sobre o arquivo também chega, sem problema)
    return settingsView(hotkey?.label ?? loadConfig().hotkey)
  })

  ipcMain.handle('painel:verificar-chave', (event, name: KeyName): Promise<KeyCheck> => {
    fromPanel(event)
    return verifyKey(name, readKey(name))
  })

  ipcMain.handle('painel:pausar-atalho', (event, paused: boolean) => {
    fromPanel(event)
    hotkey?.setPaused(!!paused)
  })
}

// ---------- bandeja ----------

function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(iconPath('tray.png'))
}

function ensureEnvFile(): string {
  const path = envFilePath()
  if (!existsSync(path)) writeFileSync(path, envTemplate, 'utf8')
  return path
}

function refreshTray(config: Config = loadConfig()): void {
  if (!tray) return
  const problems = configProblems(config)
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Abrir painel', click: () => showPanel() },
    { type: 'separator' },
    { label: `Segure ${hotkey?.label ?? config.hotkey} para falar`, enabled: false },
    {
      label: cleanupActive(config)
        ? 'Limpeza do texto: ligada (Claude)'
        : 'Limpeza do texto: desligada',
      enabled: false
    },
    ...(problems.length > 0
      ? [{ label: `⚠ ${problems.join('. ')}`, click: () => showPanel('configuracoes') }]
      : []),
    { type: 'separator' },
    { label: 'Copiar último texto', enabled: !!lastText, click: () => void clipboard.writeText(lastText) },
    { label: 'Configurações', click: () => showPanel('configuracoes') },
    { label: 'Abrir log', click: () => log.file() && shell.openPath(log.file()!) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(problems.length > 0 ? `DigitAI — ${problems.join('. ')}` : 'DigitAI — pronto')
}

// As chaves já são relidas a cada ditado; o atalho precisa ser trocado assim que o .env muda.
function onEnvChanged(): void {
  const config = loadConfig()
  refreshTray(config)
  if (!hotkey || config.hotkey === hotkey.spec) return
  try {
    hotkey.setSpec(config.hotkey)
    log.info(`Atalho trocado para ${hotkey.label}`)
    setBar('info', `Atalho agora: segure ${hotkey.label}`)
    refreshTray(config)
  } catch (err) {
    showError(String(err instanceof Error ? err.message : err))
  }
}

// Aviso do Windows quando o .env muda (sem ficar consultando o arquivo a cada segundo).
// Observa a pasta porque alguns editores salvam criando um arquivo novo no lugar.
function watchEnvFile(envPath: string): void {
  let debounce: NodeJS.Timeout | null = null
  try {
    watch(dirname(envPath), (_event, file) => {
      if (file !== basename(envPath)) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(onEnvChanged, 300)
    })
  } catch (err) {
    log.warn(`Não consegui observar o .env (${String(err)}); troque o atalho e reinicie o app`)
  }
}

// O app se chamava "Ditado": na primeira vez como DigitAI, traz o histórico e os áudios da pasta antiga.
function migrateOldData(): void {
  const oldDir = join(app.getPath('appData'), 'Ditado')
  const newDir = app.getPath('userData')
  if (!existsSync(oldDir) || existsSync(join(newDir, 'historico.jsonl'))) return
  try {
    mkdirSync(newDir, { recursive: true })
    for (const item of ['historico.jsonl', 'audios']) {
      const from = join(oldDir, item)
      if (existsSync(from)) cpSync(from, join(newDir, item), { recursive: true })
    }
    log.info(`Histórico copiado de ${oldDir}`)
  } catch (err) {
    log.warn(`Não consegui copiar o histórico antigo: ${String(err)}`)
  }
}

// ---------- inicialização ----------

// Leveza em segundo plano: a barrinha é simples e não precisa de GPU (economiza um processo de ~80 MB).
app.disableHardwareAcceleration()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('com.digitai.app')

  process.on('uncaughtException', (err) => log.error(`Erro não tratado: ${err.stack ?? String(err)}`))
  process.on('unhandledRejection', (err) => log.error(`Erro não tratado (promise): ${err instanceof Error ? err.stack : String(err)}`))

  app.whenReady().then(() => {
    migrateOldData()
    log.info(`Iniciando (pid ${process.pid}, pasta ${process.cwd()}, log ${app.getPath('logs')})`)
    // A barra precisa do microfone; nenhuma outra permissão é concedida.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'))
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

    ensureEnvFile()
    const config = loadConfig()
    createBar()

    ipcMain.on('rec:audio', (_e, payload: AudioPayload) => void handleAudio(payload))
    ipcMain.on('bar:mouse', (_e, mode: BarMouse) => setBarMouse(mode))
    ipcMain.on('bar:acao', (_e, { action, entryId }: { action: CardAction; entryId: string }) => void onCardAction(action, entryId))
    ipcMain.on('rec:error', (_e, { id, message }: { id: number; message: string }) => {
      if (current?.id !== id) return
      clearTimeout(current.maxTimer)
      clearTimeout(current.showTimer)
      finish('error', message)
    })

    try {
      hotkey = new HoldHotkey(config.hotkey)
    } catch (err) {
      log.error(String(err))
      hotkey = new HoldHotkey('ctrl+win')
    }
    hotkey.on('down', startDictation)
    hotkey.on('up', stopDictation)
    hotkey.on('cancel', () => cancelDictation())
    hotkey.on('tap', onTap)
    hotkey.on('lock', lockDictation)
    hotkey.start()

    powerMonitor.on('lock-screen', () => hotkey?.reset())
    powerMonitor.on('resume', () => hotkey?.reset())
    screen.on('display-metrics-changed', positionBar)
    screen.on('display-added', positionBar)
    screen.on('display-removed', positionBar)

    tray = new Tray(trayIcon())
    tray.on('click', () => showPanel())
    // Os botões da janela do painel acompanham o tema claro/escuro do Windows.
    nativeTheme.on('updated', () => panel?.setTitleBarOverlay(titleBarOverlay()))
    refreshTray(config)
    registerPanelHandlers()
    watchEnvFile(config.envPath)

    const problems = configProblems(config)
    log.info(`DigitAI iniciado. Atalho: ${hotkey.label}. .env: ${config.envPath}`)
    // Falta alguma chave: o painel já abre nas configurações.
    if (!process.argv.includes('--oculto')) showPanel(problems.length > 0 ? 'configuracoes' : 'ditados')
    if (problems.length > 0) {
      setTimeout(() => showError(`${problems.join('. ')}. Abra as configurações no ícone da bandeja.`), 1200)
    }
  })

  // Abrir o atalho com o app já rodando mostra o painel.
  app.on('second-instance', () => showPanel())

  app.on('window-all-closed', () => {
    // app de bandeja: continua rodando sem janelas
  })

  app.on('will-quit', () => hotkey?.stop())
}
