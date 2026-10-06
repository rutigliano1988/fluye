# Runs the production focus algorithm with simulated Win32/UIA providers.
# No real windows, clipboard contents, or keyboard input are touched.
$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot '../src/main/windows-input.ts'
$source = Get-Content -Raw $file
$native = [regex]::Match($source, '(?s)nativeInputSource = String.raw`(.*?)`').Groups[1].Value
if (-not $native) { throw 'Native source not found' }
$native = $native.Replace('using System.Windows.Automation;', 'using FluyeFocusTest;')
$native = $native.Replace('public static class FluyeInput', 'public static partial class FluyeInput')
$native = [regex]::Replace($native, '(?m)^\s*\[DllImport[^\r\n]+', '')
$fixture = @'
namespace FluyeFocusTest {
  public class ElementNotAvailableException : System.Exception { }
  public class AutomationElement {
    public int Handle;
    public AutomationElement(int handle) { Handle = handle; }
    public AutomationElement Current { get { return this; } }
    public int NativeWindowHandle { get { return Handle; } }
    public static AutomationElement FocusedElement { get { return FluyeInput.ActiveElement; } }
    public void SetFocus() {
      if (FluyeInput.EditorGone) throw new ElementNotAvailableException();
      // Reproduces a pane that cannot restore its editor while the sheet has focus.
      if (FluyeInput.NativeFocus != new System.IntPtr(11) || FluyeInput.RefuseEditor) throw new System.Exception();
      FluyeInput.ActiveElement = this;
    }
  }
  public static class Automation {
    public static bool Compare(AutomationElement a, AutomationElement b) { return object.ReferenceEquals(a, b); }
  }
  public class TreeWalker {
    public static TreeWalker RawViewWalker = new TreeWalker();
    public AutomationElement GetParent(AutomationElement element) { return null; }
  }
}
public static partial class FluyeInput {
  public static IntPtr NativeFocus;
  public static AutomationElement ActiveElement;
  public static bool RefuseEditor, EditorGone;
  static IntPtr activeWindow;
  static AutomationElement editor = new AutomationElement(11), sheet = new AutomationElement(12);
  static bool refuseWindow, closed;
  static int writes, activations, restores;
  static IntPtr GetForegroundWindow() { return activeWindow; }
  static bool GetGUIThreadInfo(uint thread, ref GuiInfo info) { info.Focus = NativeFocus; return true; }
  static uint GetWindowThreadProcessId(IntPtr handle, out uint process) { process = 100; return (uint)handle.ToInt64(); }
  static bool IsWindow(IntPtr handle) { return !closed && handle != IntPtr.Zero; }
  static bool IsChild(IntPtr parent, IntPtr child) { return parent == new IntPtr(1) && (child == new IntPtr(11) || child == new IntPtr(12)); }
  static bool IsIconic(IntPtr handle) { return false; }
  static bool ShowWindowAsync(IntPtr handle, int command) { restores++; return true; }
  static bool SetForegroundWindow(IntPtr handle) {
    activations++;
    if (refuseWindow) return false;
    activeWindow = handle; NativeFocus = new IntPtr(12); ActiveElement = sheet; return true;
  }
  static bool BringWindowToTop(IntPtr handle) { return true; }
  static IntPtr SetFocus(IntPtr handle) { NativeFocus = handle; return handle; }
  static bool AttachThreadInput(uint from, uint to, bool attach) { return true; }
  static uint GetCurrentThreadId() { return 999; }
  static short GetAsyncKeyState(int key) { return 0; }
  static void keybd_event(byte key, byte scan, uint flags, UIntPtr extra) {
    if (key == 86 && flags == 0) {
      if (activeWindow != new IntPtr(1) || (element != null && ActiveElement != editor)) throw new Exception("wrong destination");
      writes++;
    }
  }
  static string Setup() {
    activeWindow = new IntPtr(1); NativeFocus = new IntPtr(11); ActiveElement = editor;
    writes = activations = restores = 0; refuseWindow = closed = RefuseEditor = EditorGone = false;
    return Capture(1);
  }
  static void SwitchAway() { activeWindow = new IntPtr(2); NativeFocus = new IntPtr(22); ActiveElement = null; }
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  static void ExpectFailure(string id, string code) {
    try { Send(id, 86, new int[0]); throw new Exception("unexpected paste"); }
    catch (Exception error) { Check(error.Message == code, "expected " + code + ", got " + error.Message); }
    Check(writes == 0, "pasted despite failure");
  }
  public static void RunFocusTests() {
    string id = Setup(); Send(id, 86, new int[0]);
    Check(writes == 1 && activations == 0 && restores == 0, "active editor was disturbed");
    Console.WriteLine("PASS: active editor is not reactivated");
    id = Setup(); SwitchAway(); Send(id, 86, new int[0]);
    Check(writes == 1 && NativeFocus == new IntPtr(11) && ActiveElement == editor && restores == 0, "pane not restored");
    Console.WriteLine("PASS: switching away restores pane before editor and pastes once");
    id = Setup(); SwitchAway(); RefuseEditor = true; ExpectFailure(id, "editor-focus");
    Console.WriteLine("PASS: unresponsive editor never receives a blind paste");
    id = Setup(); SwitchAway(); EditorGone = true; ExpectFailure(id, "editor-gone");
    Console.WriteLine("PASS: vanished editor never falls back to worksheet");
    id = Setup(); SwitchAway(); refuseWindow = true; ExpectFailure(id, "foreground");
    Console.WriteLine("PASS: refused activation never pastes into other application");
    id = Setup(); SwitchAway(); closed = true; ExpectFailure(id, "target");
    Console.WriteLine("PASS: closed window is rejected");
    Setup(); ActiveElement = null; id = Capture(1); SwitchAway(); Send(id, 86, new int[0]);
    Check(writes == 1 && NativeFocus == new IntPtr(11), "native editor regression");
    Console.WriteLine("PASS: native editor without UI Automation restores correctly");
  }
}
'@
Add-Type -TypeDefinition ($native + $fixture)
[FluyeInput]::RunFocusTests()
