import { spawnSync } from 'node:child_process';

const PROCESS_NAME = 'markdown-editor';
const WINDOW_TITLE = 'Markdown Editor';
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 480;

function runPowerShell(script) {
  if (process.platform !== 'win32') {
    throw new Error('Windows native window automation requires win32.');
  }

  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: false,
      timeout: 30_000
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'PowerShell command failed').trim());
  }
  return String(result.stdout || '').trim();
}

function nativeApiSource() {
  return String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MarkdownEditorWindowAutomation {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int Length;
    public int Flags;
    public int ShowCmd;
    public POINT MinPosition;
    public POINT MaxPosition;
    public RECT NormalPosition;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

  public static string ReadWindowTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    var builder = new StringBuilder(Math.Max(length + 1, 2));
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static IntPtr FindMainWindow(
    uint processId,
    string expectedTitle,
    int minWidth,
    int minHeight
  ) {
    IntPtr titledCandidate = IntPtr.Zero;
    long titledArea = -1;
    IntPtr sizedCandidate = IntPtr.Zero;
    long sizedArea = -1;

    EnumWindows((hWnd, lParam) => {
      uint windowProcessId;
      GetWindowThreadProcessId(hWnd, out windowProcessId);
      if (windowProcessId != processId || !IsWindowVisible(hWnd)) return true;

      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return true;

      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width <= 0 || height <= 0) return true;

      long area = (long)width * height;
      string title = ReadWindowTitle(hWnd);

      if (string.Equals(title, expectedTitle, StringComparison.Ordinal) && area > titledArea) {
        titledCandidate = hWnd;
        titledArea = area;
      }

      if (width >= minWidth && height >= minHeight && area > sizedArea) {
        sizedCandidate = hWnd;
        sizedArea = area;
      }

      return true;
    }, IntPtr.Zero);

    return titledCandidate != IntPtr.Zero ? titledCandidate : sizedCandidate;
  }
}
'@
`;
}

function processLookupSource() {
  return String.raw`
$process = Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if ($null -eq $process) {
  throw 'Markdown Editor native window process was not found.'
}
`;
}

function mainWindowLookupSource() {
  return String.raw`
${processLookupSource()}
$windowHandle = [MarkdownEditorWindowAutomation]::FindMainWindow(
  [uint32]$process.Id,
  '${WINDOW_TITLE}',
  ${MIN_WINDOW_WIDTH},
  ${MIN_WINDOW_HEIGHT}
)
if ($windowHandle -eq [IntPtr]::Zero) {
  throw 'Markdown Editor main native window was not found for the current process.'
}
`;
}

export function getWindowSnapshot() {
  const output = runPowerShell(String.raw`
${nativeApiSource()}
${mainWindowLookupSource()}
$rect = New-Object MarkdownEditorWindowAutomation+RECT
$placement = New-Object MarkdownEditorWindowAutomation+WINDOWPLACEMENT
$placement.Length = [Runtime.InteropServices.Marshal]::SizeOf($placement)
if (-not [MarkdownEditorWindowAutomation]::GetWindowRect($windowHandle, [ref]$rect)) {
  throw 'GetWindowRect failed.'
}
if (-not [MarkdownEditorWindowAutomation]::GetWindowPlacement($windowHandle, [ref]$placement)) {
  throw 'GetWindowPlacement failed.'
}
[pscustomobject]@{
  pid = $process.Id
  handle = [int64]$windowHandle
  title = [MarkdownEditorWindowAutomation]::ReadWindowTitle($windowHandle)
  showCmd = $placement.ShowCmd
  left = $rect.Left
  top = $rect.Top
  right = $rect.Right
  bottom = $rect.Bottom
  width = $rect.Right - $rect.Left
  height = $rect.Bottom - $rect.Top
} | ConvertTo-Json -Compress
`);
  return JSON.parse(output);
}

export function restoreWindow() {
  runPowerShell(String.raw`
${nativeApiSource()}
${mainWindowLookupSource()}
[void][MarkdownEditorWindowAutomation]::ShowWindowAsync($windowHandle, 9)
Start-Sleep -Milliseconds 250
[void][MarkdownEditorWindowAutomation]::SetForegroundWindow($windowHandle)
`);
}

export function dragWindow({ startX, startY, endX, endY }) {
  for (const [name, value] of Object.entries({ startX, startY, endX, endY })) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  }

  runPowerShell(String.raw`
${nativeApiSource()}
${mainWindowLookupSource()}
[void][MarkdownEditorWindowAutomation]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 300
[void][MarkdownEditorWindowAutomation]::SetCursorPos(${Math.round(startX)}, ${Math.round(startY)})
Start-Sleep -Milliseconds 150
[MarkdownEditorWindowAutomation]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 200
$steps = 12
for ($index = 1; $index -le $steps; $index += 1) {
  $x = [Math]::Round(${Math.round(startX)} + ((${Math.round(endX)} - ${Math.round(startX)}) * $index / $steps))
  $y = [Math]::Round(${Math.round(startY)} + ((${Math.round(endY)} - ${Math.round(startY)}) * $index / $steps))
  [void][MarkdownEditorWindowAutomation]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 35
}
[MarkdownEditorWindowAutomation]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 350
`);
}

export async function waitForWindowSnapshot(predicate, {
  timeoutMs = 10_000,
  intervalMs = 150
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      lastSnapshot = getWindowSnapshot();
      if (predicate(lastSnapshot)) return lastSnapshot;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  const detail = lastError?.message || JSON.stringify(lastSnapshot);
  throw new Error(`Timed out waiting for native window state: ${detail}`);
}

export async function waitForProcessExit({
  timeoutMs = 15_000,
  intervalMs = 200
} = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const output = runPowerShell(String.raw`
$process = Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue
if ($null -eq $process) { 'exited' } else { 'running' }
`);
    if (output === 'exited') return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}
