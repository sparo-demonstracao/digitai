import { clipboard, ClipboardItem } from 'electron'
import { sendCtrlV } from './win32'

type ClipboardEntry = Record<string, Blob | Electron.ClipboardBookmark>

// Copia de verdade todos os formatos (texto, HTML, imagem...): os itens lidos do clipboard
// são preguiçosos e, sem isso, passariam a devolver o nosso próprio texto.
async function snapshot(): Promise<ClipboardEntry[]> {
  const items = await clipboard.read()
  const entries: ClipboardEntry[] = []
  for (const item of items) {
    const entry: ClipboardEntry = {}
    for (const type of item.types) {
      try {
        entry[type] = await item.getType(type)
      } catch {
        // formato que o sistema anuncia mas não entrega; ignora
      }
    }
    if (Object.keys(entry).length > 0) entries.push(entry)
  }
  return entries
}

async function restore(entries: ClipboardEntry[]): Promise<void> {
  if (entries.length === 0) {
    clipboard.clear()
    return
  }
  await clipboard.write(entries.map((entry) => new ClipboardItem(entry)))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cola o texto no app em foco: guarda o clipboard, escreve o texto, simula Ctrl+V
 * e devolve o que a pessoa tinha copiado antes.
 */
export async function pasteText(text: string): Promise<void> {
  const previous = await snapshot().catch(() => null)
  await clipboard.writeText(text)
  await sleep(30)
  sendCtrlV()
  // Alguns apps (Electron, navegadores) leem o clipboard um pouco depois do Ctrl+V.
  await sleep(450)
  if (previous && (await clipboard.readText()) === text) {
    await restore(previous).catch(() => undefined)
  }
}
