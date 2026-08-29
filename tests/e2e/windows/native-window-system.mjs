import { spawnSync } from 'node:child_process';
import {
  prepareNativeWindowInterop,
  replaceNativeApiCompilation
} from './native-window-interop.mjs';

const PROCESS_NAME = 'markdown-editor';
const WINDOW_TITLE = 'Markdown Editor';
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 480;

function runPowerShell(script) {
  if (process.platform !== 'win32') {
    throw new Error('Windows native window automation requires win32.');
  }

  const preparedScript = replaceNativeApiCompilation(script, nativeApiSource());
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', preparedScript],
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

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)]
    public MOUSEINPUT mouse;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION data;
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
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

  public static string ReadWindowTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    var builder = new StringBuilder(Math.Max(length + 1, 2));
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static void SendMouseButton(uint flags) {
    var input = new INPUT {
      type = 0,
      data = new INPUTUNION {
        mouse = new MOUSEINPUT {
          dx = 0,
          dy = 0,
          mouseData = 0,
          dwFlags = flags,
          time = 0,
          dwExtraInfo = UIntPtr.Zero
        }
      }
    };
    var inputs = new[] { input };
    uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 1) {
      throw new InvalidOperationException("SendInput failed with Win32 error " + Marshal.GetLastWin32Error());
    }
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

if (process.platform === 'win32') {
  prepareNativeWindowInterop(nativeApiSource());
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

function assertFiniteNumber(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
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

export function dragWindowFromViewport({
  startX,
  startY,
  endX,
  endY,
  viewportWidth,
  viewportHeight
}) {
  for (const [name, value] of Object.entries({
    startX,
    startY,
    endX,
    endY,
    viewportWidth,
    viewportHeight
  })) {
    assertFiniteNumber(name, value);
  }
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    throw new RangeError('viewportWidth and viewportHeight must be positive.');
  }

  const output = runPowerShell(String.raw`
${nativeApiSource()}
${mainWindowLookupSource()}
$clientRect = New-Object MarkdownEditorWindowAutomation+RECT
if (-not [MarkdownEditorWindowAutomation]::GetClientRect($windowHandle, [ref]$clientRect)) {
  throw 'GetClientRect failed.'
}
$clientWidth = $clientRect.Right - $clientRect.Left
$clientHeight = $clientRect.Bottom - $clientRect.Top
if ($clientWidth -le 0 -or $clientHeight -le 0) {
  throw 'Markdown Editor client area is empty.'
}
$scaleX = $clientWidth / ${viewportWidth}
$scaleY = $clientHeight / ${viewportHeight}
$startPoint = New-Object MarkdownEditorWindowAutomation+POINT
$startPoint.X = [Math]::Round(${startX} * $scaleX)
$startPoint.Y = [Math]::Round(${startY} * $scaleY)
$endPoint = New-Object MarkdownEditorWindowAutomation+POINT
$endPoint.X = [Math]::Round(${endX} * $scaleX)
$endPoint.Y = [Math]::Round(${endY} * $scaleY)
if (-not [MarkdownEditorWindowAutomation]::ClientToScreen($windowHandle, [ref]$startPoint)) {
  throw 'ClientToScreen failed for drag start.'
}
if (-not [MarkdownEditorWindowAutomation]::ClientToScreen($windowHandle, [ref]$endPoint)) {
  throw 'ClientToScreen failed for drag end.'
}
[void][MarkdownEditorWindowAutomation]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 250
if (-not [MarkdownEditorWindowAutomation]::SetCursorPos($startPoint.X, $startPoint.Y)) {
  throw 'SetCursorPos failed for drag start.'
}
Start-Sleep -Milliseconds 150
[MarkdownEditorWindowAutomation]::SendMouseButton(0x0002)
Start-Sleep -Milliseconds 250
$steps = 16
for ($index = 1; $index -le $steps; $index += 1) {
  $x = [Math]::Round($startPoint.X + (($endPoint.X - $startPoint.X) * $index / $steps))
  $y = [Math]::Round($startPoint.Y + (($endPoint.Y - $startPoint.Y) * $index / $steps))
  if (-not [MarkdownEditorWindowAutomation]::SetCursorPos($x, $y)) {
    throw "SetCursorPos failed during drag at step $index."
  }
  Start-Sleep -Milliseconds 40
}
[MarkdownEditorWindowAutomation]::SendMouseButton(0x0004)
Start-Sleep -Milliseconds 350
[pscustomobject]@{
  clientWidth = $clientWidth
  clientHeight = $clientHeight
  viewportWidth = ${viewportWidth}
  viewportHeight = ${viewportHeight}
  scaleX = $scaleX
  scaleY = $scaleY
  startScreenX = $startPoint.X
  startScreenY = $startPoint.Y
  endScreenX = $endPoint.X
  endScreenY = $endPoint.Y
} | ConvertTo-Json -Compress
`);
  return JSON.parse(output);
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
