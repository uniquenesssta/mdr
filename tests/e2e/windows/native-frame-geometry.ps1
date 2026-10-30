param([int]$AppProcessId, [string]$ScreenshotPath, [switch]$Reveal, [int]$WindowWidth, [int]$WindowHeight, [switch]$ResizeBurst)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MdrFrameProbe {
  public delegate bool Visitor(IntPtr window, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr hdc, uint flags);
  public static IntPtr Find(uint wanted) {
    IntPtr found=IntPtr.Zero; long area=0;
    EnumWindows((window,param)=>{uint pid;GetWindowThreadProcessId(window,out pid);
      Rect rect; if(pid==wanted && GetWindowRect(window,out rect)) {
        long next=(long)(rect.Right-rect.Left)*(rect.Bottom-rect.Top);
        if(next>area){area=next;found=window;}
      } return true;},IntPtr.Zero);return found;
  }
}
'@
$frameWindow = [MdrFrameProbe]::Find($AppProcessId)
if ($frameWindow -eq [IntPtr]::Zero) { throw 'Owned Tauri window was not found.' }
if ($Reveal) {
  [void][MdrFrameProbe]::ShowWindow($frameWindow, 4)
  [void][MdrFrameProbe]::SetWindowPos($frameWindow, [IntPtr]1, 0, 0, 0, 0, 19)
}
if ($WindowWidth -gt 0 -and $WindowHeight -gt 0) {
  if (-not [MdrFrameProbe]::SetWindowPos($frameWindow,[IntPtr]::Zero,0,0,$WindowWidth,$WindowHeight,22)) { throw 'Owned window resize failed.' }
}
if ($ResizeBurst) {
  foreach ($size in @(@(1240,880),@(1200,890),@(1160,900),@(1120,910))) {
    if (-not [MdrFrameProbe]::SetWindowPos($frameWindow,[IntPtr]::Zero,0,0,$size[0],$size[1],22)) { throw 'Owned resize burst failed.' }
    [System.Threading.Thread]::Sleep(30)
  }
}
$outer = [MdrFrameProbe+Rect]::new()
$client = [MdrFrameProbe+Rect]::new()
$origin = [MdrFrameProbe+Point]::new()
if (-not [MdrFrameProbe]::GetWindowRect($frameWindow,[ref]$outer)) { throw 'GetWindowRect failed.' }
if (-not [MdrFrameProbe]::GetClientRect($frameWindow,[ref]$client)) { throw 'GetClientRect failed.' }
if (-not [MdrFrameProbe]::ClientToScreen($frameWindow,[ref]$origin)) { throw 'ClientToScreen failed.' }
$captured = $false
$visiblePixelSamples = 0
if ($ScreenshotPath) {
  $bitmap = [System.Drawing.Bitmap]::new($outer.Right-$outer.Left,$outer.Bottom-$outer.Top)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  try { $captured = [MdrFrameProbe]::PrintWindow($frameWindow,$hdc,2) }
  finally { $graphics.ReleaseHdc($hdc); $graphics.Dispose() }
  try {
    if ($captured) {
      for ($row=0; $row -lt 8; $row++) {
        for ($column=0; $column -lt 8; $column++) {
          $pixel=$bitmap.GetPixel([int](($column+0.5)*$bitmap.Width/8),[int](($row+0.5)*$bitmap.Height/8))
          if ($pixel.R -gt 0 -or $pixel.G -gt 0 -or $pixel.B -gt 0) { $visiblePixelSamples++ }
        }
      }
      $bitmap.Save($ScreenshotPath,[System.Drawing.Imaging.ImageFormat]::Png)
    }
  }
  finally { $bitmap.Dispose() }
}
[ordered]@{
  processId=$AppProcessId; handle=$frameWindow.ToInt64(); dpi=[MdrFrameProbe]::GetDpiForWindow($frameWindow)
  maximized=[MdrFrameProbe]::IsZoomed($frameWindow)
  width=$outer.Right-$outer.Left; height=$outer.Bottom-$outer.Top
  clientWidth=$client.Right; clientHeight=$client.Bottom
  nonclient=[ordered]@{left=$origin.X-$outer.Left;top=$origin.Y-$outer.Top;right=$outer.Right-$origin.X-$client.Right;bottom=$outer.Bottom-$origin.Y-$client.Bottom}
  nativeScreenshotCaptured=$captured
  visiblePixelSamples=$visiblePixelSamples
} | ConvertTo-Json -Depth 4 -Compress
