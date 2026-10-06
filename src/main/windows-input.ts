import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

// Compiled once in a persistent worker. UI Automation keeps the actual editor
// (including editors inside WebView task panes), not just its Office window.
export const nativeInputSource = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
public static class FluyeInput {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct GuiInfo {
    public int Size, Flags;
    public IntPtr Active, Focus, Capture, Menu, Move, Caret;
    public Rect CaretRect;
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  static IntPtr window, focus;
  static uint processId, focusProcessId;
  static AutomationElement element;
  static string token;
  static IntPtr FocusedHandle() {
    var info = new GuiInfo(); info.Size = Marshal.SizeOf(info);
    return GetGUIThreadInfo(0, ref info) ? info.Focus : IntPtr.Zero;
  }
  static bool BelongsToWindow(AutomationElement candidate) {
    for (int i = 0; candidate != null && i < 40; i++) {
      var handle = new IntPtr(candidate.Current.NativeWindowHandle);
      if (handle != IntPtr.Zero && (handle == window || IsChild(window, handle))) return true;
      candidate = TreeWalker.RawViewWalker.GetParent(candidate);
    }
    return false;
  }
  public static string Capture(long expected) {
    token = null; element = null;
    window = GetForegroundWindow();
    if (window == IntPtr.Zero || (expected != 0 && window.ToInt64() != expected)) throw new Exception("target");
    GetWindowThreadProcessId(window, out processId);
    focus = FocusedHandle();
    GetWindowThreadProcessId(focus, out focusProcessId);
    try {
      var candidate = AutomationElement.FocusedElement;
      if (candidate != null && BelongsToWindow(candidate)) element = candidate;
    } catch { /* Native child focus remains available for non-UIA applications. */ }
    if (GetForegroundWindow() != window || FocusedHandle() != focus) throw new Exception("target");
    if (focus == IntPtr.Zero && element == null) throw new Exception("target");
    token = Guid.NewGuid().ToString("N");
    return token;
  }
  static bool SameElement() {
    try { return element != null && Automation.Compare(element, AutomationElement.FocusedElement); }
    catch { return false; }
  }
  static bool RestoreNativeFocus() {
    if (FocusedHandle() == focus) return true;
    if (focus == IntPtr.Zero || !IsWindow(focus) || (focus != window && !IsChild(window, focus))) return false;
    uint currentProcess;
    var owner = GetWindowThreadProcessId(focus, out currentProcess);
    if (currentProcess != focusProcessId) return false;
    var current = GetCurrentThreadId();
    bool attached = owner != current && AttachThreadInput(current, owner, true);
    try { SetFocus(focus); }
    finally { if (attached) AttachThreadInput(current, owner, false); }
    for (int i = 0; i < 10 && FocusedHandle() != focus; i++) Thread.Sleep(20);
    return FocusedHandle() == focus;
  }
  static bool WaitForEditor(int milliseconds) {
    var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
    do {
      if (GetForegroundWindow() != window) throw new Exception("foreground");
      if (SameElement()) return true;
      Thread.Sleep(20);
    } while (DateTime.UtcNow < deadline);
    return false;
  }
  public static void Send(string expectedToken, byte key, int[] releaseKeys) {
    if (token == null || expectedToken != token || !IsWindow(window)) throw new Exception("target");
    uint currentProcess; GetWindowThreadProcessId(window, out currentProcess);
    if (currentProcess != processId) throw new Exception("target");
    var deadline = DateTime.UtcNow.AddMilliseconds(1800);
    while (true) {
      bool down = false;
      foreach (var k in releaseKeys) if ((GetAsyncKeyState(k) & 0x8000) != 0) down = true;
      if (!down) break;
      if (DateTime.UtcNow >= deadline) throw new Exception("keys");
      Thread.Sleep(12);
    }
    // Do not reactivate an already active Office window: it can focus the sheet.
    if (GetForegroundWindow() != window) {
      if (IsIconic(window)) {
        ShowWindowAsync(window, 9);
        for (int i = 0; i < 25 && IsIconic(window); i++) Thread.Sleep(20);
      }
      uint unused;
      var current = GetCurrentThreadId();
      var foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
      var targetThread = GetWindowThreadProcessId(window, out unused);
      bool attachedForeground = foregroundThread != current && AttachThreadInput(current, foregroundThread, true);
      bool attachedTarget = targetThread != current && targetThread != foregroundThread && AttachThreadInput(current, targetThread, true);
      try {
        BringWindowToTop(window);
        SetForegroundWindow(window);
      } finally {
        if (attachedTarget) AttachThreadInput(current, targetThread, false);
        if (attachedForeground) AttachThreadInput(current, foregroundThread, false);
      }
      for (int i = 0; i < 40 && GetForegroundWindow() != window; i++) Thread.Sleep(20);
      if (GetForegroundWindow() != window) throw new Exception("foreground");
    }
    if (element != null) {
      if (!SameElement()) {
        // Office may reactivate its worksheet. Return keyboard focus to the
        // saved WebView child before asking its provider to focus the editor.
        RestoreNativeFocus();
        for (int attempt = 0; attempt < 2 && !SameElement(); attempt++) {
          try { element.SetFocus(); }
          catch (ElementNotAvailableException) { throw new Exception("editor-gone"); }
          catch { /* The provider may still be reactivating; verify, then retry. */ }
          if (WaitForEditor(400)) break;
        }
        if (!SameElement()) throw new Exception("editor-focus");
      }
    } else if (FocusedHandle() != focus) {
      if (!RestoreNativeFocus()) throw new Exception("native-focus");
    }
    if (GetForegroundWindow() != window) throw new Exception("foreground");
    if (element != null ? !SameElement() : FocusedHandle() != focus) throw new Exception("editor-focus");
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    try { keybd_event(key, 0, 0, UIntPtr.Zero); }
    finally {
      keybd_event(key, 0, 2, UIntPtr.Zero);
      keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }
  }
}
`

export const workerScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -TypeDefinition @'
${nativeInputSource}
'@ -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($request.action -eq 'capture') {
      $value = [FluyeInput]::Capture([long]$request.handle)
    } elseif ($request.action -eq 'send') {
      [FluyeInput]::Send([string]$request.token, [byte]$request.key, [int[]]$request.release)
      $value = 'ok'
    } else { throw 'action' }
    $result = @{ id = $request.id; value = $value }
  } catch {
    $message = $_.Exception.GetBaseException().Message
    $result = @{ id = $request.id; error = $message }
  }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`

export function inputErrorMessage(code: string): string {
  if (code === 'keys') return 'Suelta el atajo antes de terminar la acción.'
  const recovery = ' El dictado queda en el portapapeles.'
  if (code === 'foreground') return 'Windows no permitió volver a la ventana de origen.' + recovery
  if (code === 'editor-gone') return 'El campo de texto original ya no está disponible.' + recovery
  if (code === 'native-focus') return 'La ventana volvió, pero no se pudo activar el panel original.' + recovery
  return 'No se pudo recuperar el campo de texto original.' + recovery + ' Pégalo en el chat.'
}

export class WindowsInput {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private sequence = 0
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()

  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-EncodedCommand', Buffer.from(workerScript, 'utf16le').toString('base64')], { windowsHide: true })
      this.child = child
      const timer = setTimeout(() => fail(), 10_000)
      const fail = () => {
        clearTimeout(timer)
        if (this.child !== child) return
        this.child = null
        this.ready = null
        child.kill()
        const error = new Error('No se pudo preparar el control de escritura de Windows. Inténtalo de nuevo.')
        reject(error)
        for (const request of this.pending.values()) request.reject(error)
        this.pending.clear()
      }
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        output += chunk
        const lines = output.split(/\r?\n/)
        output = lines.pop() ?? ''
        for (const line of lines) {
          if (line === 'READY') { clearTimeout(timer); resolve(); continue }
          try {
            const response = JSON.parse(line)
            const request = this.pending.get(response.id)
            if (!request) continue
            this.pending.delete(response.id)
            if (response.error) {
              const code = ['keys', 'target', 'foreground', 'native-focus', 'editor-focus', 'editor-gone'].includes(response.error)
                ? response.error : 'unknown'
              console.warn(`[Fluye input] ${code}`)
              request.reject(new Error(inputErrorMessage(code)))
            } else request.resolve(response.value)
          } catch { /* Ignore non-protocol startup output. */ }
        }
      })
      child.stderr.resume()
      child.stdin.on('error', fail)
      child.once('error', fail)
      child.once('exit', fail)
    }).catch(error => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async request(payload: Record<string, unknown>): Promise<string> {
    await this.start()
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      // Killing on timeout prevents a blocked automation provider from pasting later.
      const timer = setTimeout(() => {
        console.warn(`[Fluye input] ${payload.action === 'send' ? 'send' : 'capture'}-timeout`)
        this.child?.kill()
      }, payload.action === 'send' ? 6000 : 4000)
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) }
      })
      this.child!.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
    })
  }

  capture(handle?: string): Promise<string> {
    return this.request({ action: 'capture', handle: handle && /^\d+$/.test(handle) ? handle : '0' })
  }

  async send(token: string | null, key: number, release: number[] = []): Promise<void> {
    if (!token) throw new Error('No se pudo identificar el campo de destino. El dictado queda en el portapapeles.')
    await this.request({ action: 'send', token, key, release: [...new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, ...release])] })
  }

  stop(): void { this.child?.kill() }
}
