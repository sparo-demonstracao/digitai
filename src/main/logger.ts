import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

let logFile: string | null = null

function write(level: string, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`
  try {
    console.log(line)
  } catch {
    // aberto pelo atalho do Windows não há console; escrever nele pode falhar
  }
  try {
    if (!logFile) {
      const dir = app.getPath('logs')
      mkdirSync(dir, { recursive: true })
      logFile = join(dir, 'digitai.log')
    }
    appendFileSync(logFile, line + '\n')
  } catch (err) {
    // log em arquivo é só conveniência; registra a falha num lugar que sempre existe
    try {
      appendFileSync(join(tmpdir(), 'digitai-log-erro.txt'), `${line}\n  falha ao gravar log: ${String(err)}\n`)
    } catch {
      // sem onde registrar
    }
  }
}

export const log = {
  info: (m: string) => write('INFO', m),
  warn: (m: string) => write('WARN', m),
  error: (m: string) => write('ERROR', m),
  file: () => logFile
}
