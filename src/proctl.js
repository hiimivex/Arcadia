// Pause / reprise / premier plan d'un émulateur externe (Windows), sans module natif : petits scripts PowerShell.
const { spawn } = require('child_process');
const encode = s => Buffer.from(s, 'utf16le').toString('base64');
const NT = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class ArcadiaProc {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool i, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  // Windows refuse le premier plan à un processus d'arrière-plan : on simule Alt et on s'attache au fil actif
  public static void Front(IntPtr w) {
    if (w == IntPtr.Zero) return;
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), me = GetCurrentThreadId();
    if (fg != me) AttachThreadInput(me, fg, true);
    ShowWindow(w, 9); BringWindowToTop(w); SetForegroundWindow(w);
    if (fg != me) AttachThreadInput(me, fg, false);
  }
  public static void Suspend(int pid) { IntPtr h = OpenProcess(0x0800, false, pid); if (h != IntPtr.Zero) { NtSuspendProcess(h); CloseHandle(h); } }
  public static void Resume(int pid) { IntPtr h = OpenProcess(0x0800, false, pid); if (h != IntPtr.Zero) { NtResumeProcess(h); CloseHandle(h); } }
}
"@`;
function run(body, maxMs = 4000) {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise(res => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(`${NT}\n${body}`)], { windowsHide: true });
    p.on('exit', res); p.on('error', res);
    setTimeout(res, maxMs);
  });
}
const suspend = pid => run(`[ArcadiaProc]::Suspend(${Number(pid)})`);
const resume = pid => run(`[ArcadiaProc]::Resume(${Number(pid)})`);
// Ramène la fenêtre du jeu au premier plan (après la fermeture du menu Arcadia)
const focus = pid => run(`$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { [ArcadiaProc]::Front($p.MainWindowHandle) }`);
// Au lancement : attend la fenêtre du moteur, lui donne le titre du jeu et le premier plan
const psq = s => `'${String(s || '').replace(/'/g, "''")}'`; // chaîne PowerShell littérale
const adopt = (pid, title) => run(`$t = ${psq(title)}
for ($i = 0; $i -lt 60; $i++) {
  $p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue
  if (-not $p) { break }
  if ($p.MainWindowHandle -ne 0) { Start-Sleep -Milliseconds 600; $p.Refresh(); if ($t) { [ArcadiaProc]::SetWindowText($p.MainWindowHandle, $t) | Out-Null }; [ArcadiaProc]::Front($p.MainWindowHandle); break }
  Start-Sleep -Milliseconds 250
}`, 20000);
module.exports = { suspend, resume, focus, adopt };
