import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.ts'

const execFileAsync = promisify(execFile)
// 接続ごとに別の X display と VNC ポートを割り当てる。
let nextDisplay = 100

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => Promise<boolean>, process: ChildProcess, name: string): Promise<void> {
  // 子プロセスが生きているだけでは利用できないため、ソケットなどの準備完了を待つ。
  for (let attempt = 0; attempt < 50; attempt++) {
    if (process.exitCode !== null) throw new Error(`${name} exited with code ${process.exitCode}`)
    if (await check()) return
    await pause(100)
  }
  throw new Error(`${name} did not become ready`)
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

export class VncDisplay {
  readonly display = nextDisplay++
  readonly port = 5900 + this.display
  private dbusPid?: number
  private fcitx?: ChildProcess
  private dbusAddress?: string
  private runtimeDir?: string
  private imeReady = false
  private xvfb?: ChildProcess
  private vnc?: ChildProcess
  private closed = false

  get japaneseImeReady(): boolean { return this.imeReady }

  get environment(): NodeJS.ProcessEnv {
    // Chromium はこのセッションの X display に接続する。IME 起動失敗時も画面は使える。
    const base = {
      ...process.env,
      DISPLAY: `:${this.display}`,
    }
    if (!this.imeReady) return base
    return {
      ...base,
      DBUS_SESSION_BUS_ADDRESS: this.dbusAddress,
      XDG_RUNTIME_DIR: this.runtimeDir,
      XMODIFIERS: '@im=fcitx',
      GTK_IM_MODULE: 'fcitx',
      QT_IM_MODULE: 'fcitx',
    }
  }

  private get imeEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DISPLAY: `:${this.display}`,
      DBUS_SESSION_BUS_ADDRESS: this.dbusAddress,
      XDG_RUNTIME_DIR: this.runtimeDir,
      XMODIFIERS: '@im=fcitx',
      GTK_IM_MODULE: 'fcitx',
      QT_IM_MODULE: 'fcitx',
    }
  }

  private async startIme(): Promise<void> {
    // Fcitx5 の D-Bus と実行ディレクトリを画面ごとに分離する。
    this.runtimeDir = await mkdtemp(join(tmpdir(), 'behavior-ime-'))
    const { stdout } = await execFileAsync('dbus-launch', ['--sh-syntax'], { env: this.imeEnvironment })
    const address = stdout.match(/DBUS_SESSION_BUS_ADDRESS='([^']+)'/)
    const pid = stdout.match(/DBUS_SESSION_BUS_PID=(\d+)/)
    if (!address || !pid) throw new Error('D-Bus session did not start')
    this.dbusAddress = address[1]
    this.dbusPid = Number(pid[1])
    if (this.closed) return
    this.fcitx = spawn('fcitx5', [], { env: this.imeEnvironment, stdio: ['ignore', 'ignore', 'pipe'] })
    this.fcitx.stderr?.on('data', (data: Buffer) => { console.error('Fcitx5:', data.toString().trimEnd()) })
    this.fcitx.on('error', (error) => { console.error('Fcitx5 起動エラー:', error) })
    await waitFor(async () => {
      try {
        const { stdout } = await execFileAsync('dbus-send', [
          '--session', '--print-reply', '--dest=org.freedesktop.DBus', '/',
          'org.freedesktop.DBus.NameHasOwner', 'string:org.fcitx.Fcitx5',
        ], { env: this.imeEnvironment })
        return stdout.includes('boolean true')
      } catch { return false }
    }, this.fcitx, 'Fcitx5')
    try { await execFileAsync('fcitx5-remote', ['-o'], { env: this.imeEnvironment }) }
    catch (error) { console.error('Fcitx5 の初期有効化に失敗しました:', error) }
    this.imeReady = true
  }

  private stopIme(): void {
    this.imeReady = false
    this.fcitx?.kill()
    this.fcitx = undefined
    if (this.dbusPid) {
      try { process.kill(this.dbusPid) } catch { /* already stopped */ }
      this.dbusPid = undefined
    }
    if (this.runtimeDir) {
      void rm(this.runtimeDir, { recursive: true, force: true }).catch((error) => console.error('IME 実行時ディレクトリ削除エラー:', error))
      this.runtimeDir = undefined
    }
    this.dbusAddress = undefined
  }

  async start(): Promise<void> {
    if (this.closed) return
    try {
      // Xvfb → IME → VNC の順に起動し、ブラウザーを開く前に画面を用意する。
      this.xvfb = spawn('Xvfb', [`:${this.display}`, '-screen', '0', `${config.viewport.width}x${config.viewport.height}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' })
      this.xvfb.on('error', (error) => { console.error('Xvfb 起動エラー:', error) })
      await waitFor(async () => {
        try { await access(`/tmp/.X11-unix/X${this.display}`); return true } catch { return false }
      }, this.xvfb, 'Xvfb')
      if (this.closed) return
      try {
        await this.startIme()
      } catch (error) {
        console.error('日本語 IME の起動に失敗しました。画面は起動します:', error)
        this.stopIme()
      }
      if (this.closed) { this.close(); return }
      // VNC の TCP ポートはループバックに限定し、外部へは server.ts が中継する。
      this.vnc = spawn('x11vnc', ['-display', `:${this.display}`, '-rfbport', String(this.port), '-localhost', '-forever', '-shared', '-nopw', '-quiet'], { stdio: 'ignore' })
      this.vnc.on('error', (error) => { console.error('x11vnc 起動エラー:', error) })
      await waitFor(() => portOpen(this.port), this.vnc, 'x11vnc')
    } catch (error) {
      this.close()
      throw error
    }
  }

  close(): void {
    this.closed = true
    this.vnc?.kill()
    this.stopIme()
    this.xvfb?.kill()
  }
}
