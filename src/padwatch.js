// Manette pendant une partie, même quand l'émulateur est au premier plan :
//   Back + Start maintenus 1,5 s → QUIT ; Back + Start bref ou bouton Guide → MENU (menu Arcadia).
// Lit la manette via XInput (Windows) dans un petit PowerShell en arrière-plan : aucun module natif à compiler.
const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ArcadiaXI {
  [StructLayout(LayoutKind.Sequential)]
  public struct GAMEPAD { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY; }
  [StructLayout(LayoutKind.Sequential)]
  public struct STATE { public uint dwPacketNumber; public GAMEPAD Gamepad; }
  [DllImport("xinput1_4.dll")] public static extern uint XInputGetState(uint idx, out STATE s);
  [DllImport("xinput1_4.dll", EntryPoint = "#100")] public static extern uint XInputGetStateEx(uint idx, out STATE s); // inclut le bouton Guide
  public static short LX, LY;
  public static ushort Buttons() {
    ushort all = 0; LX = 0; LY = 0;
    for (uint i = 0; i < 4; i++) {
      STATE s;
      uint r;
      try { r = XInputGetStateEx(i, out s); } catch { r = XInputGetState(i, out s); }
      if (r == 0) { all |= s.Gamepad.wButtons; if (Math.Abs((int)s.Gamepad.sThumbLX) > Math.Abs((int)LX)) LX = s.Gamepad.sThumbLX; if (Math.Abs((int)s.Gamepad.sThumbLY) > Math.Abs((int)LY)) LY = s.Gamepad.sThumbLY; }
    }
    return all;
  }
}
"@
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
$held = 0; $guide = $false; $nav = 0; $rep = 0
$keys = @{ 0x0001 = 'up'; 0x0002 = 'down'; 0x0004 = 'left'; 0x0008 = 'right'; 0x1000 = 'a'; 0x2000 = 'b'; 0x0100 = 'lb'; 0x0200 = 'rb' }
function Say($w) { [Console]::Out.WriteLine($w); [Console]::Out.Flush() }
while ($true) {
  $b = [ArcadiaXI]::Buttons()
  if (($b -band 0x0030) -eq 0x0030) {
    if ($held -ge 0) { $held += 50; if ($held -ge 1500) { Say 'QUIT'; $held = -1 } }
  } else {
    if ($held -gt 0 -and $held -lt 1500) { Say 'MENU' }
    $held = 0
  }
  $g = ($b -band 0x0400) -ne 0
  if ($guide -and -not $g) { Say 'MENU' }
  $guide = $g
  # navigation du menu Arcadia (croix, stick gauche, A, B, LB, RB) : fronts montants + répétition
  $n = $b -band 0x330F
  $y = [ArcadiaXI]::LY; $x = [ArcadiaXI]::LX
  if ($y -gt 16000) { $n = $n -bor 0x0001 } elseif ($y -lt -16000) { $n = $n -bor 0x0002 }
  if ($x -lt -16000) { $n = $n -bor 0x0004 } elseif ($x -gt 16000) { $n = $n -bor 0x0008 }
  $new = $n -band (-bnot $nav)
  $dirs = $n -band 0x000F
  if ($dirs -ne 0 -and $dirs -eq ($nav -band 0x000F)) { $rep += 50; if ($rep -ge 400) { $new = $new -bor $dirs; $rep = 320 } } else { $rep = 0 }
  foreach ($k in $keys.Keys) { if ($new -band $k) { Say ('NAV ' + $keys[$k]) } }
  $nav = $n
  Start-Sleep -Milliseconds 50
}
`;

const encode = s => Buffer.from(s, 'utf16le').toString('base64');

// onCombo() : Back + Start maintenus ; onMenu() : Guide ou Back + Start bref ; onNav(touche) : navigation du menu. Renvoie { stop() }.
function watchPad(onCombo, onLog, onMenu, onNav) {
  if (process.platform !== 'win32') return { stop() {} };
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(SCRIPT)], { windowsHide: true });
  let buf = '';
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === 'QUIT') onCombo && onCombo();
      else if (line === 'MENU') onMenu && onMenu();
      else if (line.startsWith('NAV ')) onNav && onNav(line.slice(4));
    }
  });
  p.stderr.on('data', d => onLog && onLog(String(d).slice(0, 500)));
  p.on('error', e => onLog && onLog(e.message));
  return { stop() { try { p.kill(); } catch { /* déjà fermé */ } } };
}

// Ferme proprement la fenêtre de l'émulateur, puis force la fermeture s'il résiste.
function closeProcess(pid, isAlive) {
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      encode(`$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow() }`)], { windowsHide: true });
  } else { try { process.kill(pid, 'SIGTERM'); } catch { /* */ } }
  setTimeout(() => { if (isAlive()) { try { process.kill(pid); } catch { /* déjà fermé */ } } }, 6000);
}

module.exports = { watchPad, closeProcess, SCRIPT };
