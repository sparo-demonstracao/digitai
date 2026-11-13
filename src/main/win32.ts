import { basename } from 'node:path'
import koffi from 'koffi'

// Chamadas diretas à API do Windows (sem compilar nada: o koffi já vem pronto para Windows x64).
const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32.func('uint32_t GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)')
const GetAsyncKeyState = user32.func('int16_t GetAsyncKeyState(int vKey)')
const keybd_event = user32.func('void keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)')

const OpenProcess = kernel32.func('void *OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)')
const QueryFullProcessImageNameW = kernel32.func(
  'int QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, _Inout_ uint32_t *lpdwSize)'
)
const CloseHandle = kernel32.func('int CloseHandle(void *hObject)')

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const KEYEVENTF_KEYUP = 0x0002
const VK_CONTROL = 0x11
const VK_V = 0x56
// Tecla virtual sem uso no Windows: apertá-la enquanto Win está seguro impede que soltar Win abra o menu Iniciar.
const VK_UNASSIGNED = 0xe8

export interface ActiveWindow {
  title: string
  processName: string // ex.: "chrome.exe"
  pid: number
}

export function getActiveWindow(): ActiveWindow | null {
  const hwnd = GetForegroundWindow()
  if (!hwnd) return null

  const titleBuf = Buffer.alloc(1024)
  const titleLen = GetWindowTextW(hwnd, titleBuf, 512)
  const title = titleBuf.toString('utf16le', 0, titleLen * 2)

  const pidOut = [0]
  GetWindowThreadProcessId(hwnd, pidOut)
  const pid = pidOut[0]

  let processName = ''
  const handle = pid ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) : null
  if (handle) {
    try {
      const pathBuf = Buffer.alloc(2048)
      const size = [1024]
      if (QueryFullProcessImageNameW(handle, 0, pathBuf, size)) {
        processName = basename(pathBuf.toString('utf16le', 0, size[0] * 2))
      }
    } finally {
      CloseHandle(handle)
    }
  }
  return { title, processName, pid }
}

export function isKeyDown(vk: number): boolean {
  return GetAsyncKeyState(vk) < 0
}

// ---------- teclas que nós mesmos enviamos ----------

// Marca gravada em cada tecla simulada pelo app: o gancho de teclado reconhece e deixa passar.
export const OWN_INPUT_MARKER = 0x44495441 // "DITA"

function key(vk: number, up = false): void {
  keybd_event(vk, 0, up ? KEYEVENTF_KEYUP : 0, OWN_INPUT_MARKER)
}

/**
 * Evita que soltar Win/Alt sozinho abra o menu Iniciar ou ative o menu do app.
 * Com Alt a máscara precisa ser um toque de Ctrl: o Bloco de notas e outros apps ignoram a tecla 0xE8.
 */
export function maskModifierRelease(withCtrl: boolean): void {
  const vk = withCtrl ? VK_CONTROL : VK_UNASSIGNED
  key(vk)
  key(vk, true)
}

export function sendCtrlV(): void {
  key(VK_CONTROL)
  key(VK_V)
  key(VK_V, true)
  key(VK_CONTROL, true)
}

/** Reenvia um toque de tecla (ex.: o S de um Ctrl+S rápido, que o atalho tinha segurado). */
export function tapKey(vk: number, modifiers: number[] = []): void {
  modifiers.forEach((m) => key(m))
  key(vk)
  key(vk, true)
  ;[...modifiers].reverse().forEach((m) => key(m, true))
}

// ---------- gancho global de teclado (WH_KEYBOARD_LL) ----------

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32_t',
  scanCode: 'uint32_t',
  flags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t'
})
const LowLevelKeyboardProc = koffi.proto('intptr_t LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)')
const SetWindowsHookExW = user32.func('SetWindowsHookExW', 'void *', [
  'int',
  koffi.pointer(LowLevelKeyboardProc),
  'void *',
  'uint32_t'
])
const CallNextHookEx = user32.func('intptr_t CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)')
const UnhookWindowsHookEx = user32.func('int UnhookWindowsHookEx(void *hhk)')
const GetModuleHandleW = kernel32.func('void *GetModuleHandleW(void *lpModuleName)')

const WH_KEYBOARD_LL = 13
const LLKHF_UP = 0x80

export interface RawKeyEvent {
  vk: number
  down: boolean
  own: boolean // tecla enviada pelo próprio app
}

/**
 * Instala o gancho de teclado. O handler roda para cada tecla do sistema e devolve `true`
 * para "engolir" a tecla (o app em foco não a recebe). Precisa ser rápido.
 * Retorna a função que remove o gancho.
 */
export function installKeyboardHook(handler: (e: RawKeyEvent) => boolean): () => void {
  let hook: unknown = null
  const callback = koffi.register(
    (nCode: number, wParam: number, lParam: unknown) => {
      if (nCode >= 0) {
        try {
          const info = koffi.decode(lParam, KBDLLHOOKSTRUCT) as { vkCode: number; flags: number; dwExtraInfo: number | bigint }
          const swallow = handler({
            vk: info.vkCode,
            down: (info.flags & LLKHF_UP) === 0,
            own: Number(info.dwExtraInfo) === OWN_INPUT_MARKER
          })
          if (swallow) return 1
        } catch {
          // um erro no handler nunca pode travar o teclado
        }
      }
      return CallNextHookEx(hook, nCode, wParam, lParam)
    },
    koffi.pointer(LowLevelKeyboardProc)
  )
  hook = SetWindowsHookExW(WH_KEYBOARD_LL, callback, GetModuleHandleW(null), 0)
  if (!hook) {
    koffi.unregister(callback)
    throw new Error('Não foi possível instalar o gancho de teclado do Windows')
  }
  return () => {
    UnhookWindowsHookEx(hook)
    koffi.unregister(callback)
  }
}
