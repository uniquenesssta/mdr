param(
  [string]$HostRoot = '.windows-driver-host'
)

$ErrorActionPreference = 'Stop'

function Assert-SingleReplacement {
  param(
    [string]$Content,
    [string]$Needle,
    [string]$Replacement,
    [string]$Description
  )

  $firstIndex = $Content.IndexOf($Needle, [StringComparison]::Ordinal)
  if ($firstIndex -lt 0) {
    throw "Unable to prepare Windows driver host: $Description anchor was not found."
  }
  if ($Content.IndexOf($Needle, $firstIndex + $Needle.Length, [StringComparison]::Ordinal) -ge 0) {
    throw "Unable to prepare Windows driver host: $Description anchor is ambiguous."
  }
  return $Content.Replace($Needle, $Replacement)
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$hostRootPath = Join-Path $repositoryRoot $HostRoot
$archivePath = Join-Path $repositoryRoot '.windows-driver-host.zip'

if (Test-Path $hostRootPath) {
  Remove-Item $hostRootPath -Recurse -Force
}
if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

New-Item -ItemType Directory -Force -Path $hostRootPath | Out-Null

try {
  & git -C $repositoryRoot archive --format=zip --output=$archivePath HEAD src-tauri
  if ($LASTEXITCODE -ne 0) {
    throw 'git archive failed while preparing the isolated Windows driver host.'
  }

  Expand-Archive -Path $archivePath -DestinationPath $hostRootPath -Force
  Copy-Item -Path (Join-Path $repositoryRoot 'dist') -Destination (Join-Path $hostRootPath 'dist') -Recurse -Force

  $manifestPath = Join-Path $hostRootPath 'src-tauri\Cargo.toml'
  $manifest = Get-Content $manifestPath -Raw
  if ($manifest -match 'tauri-plugin-wdio-webdriver') {
    throw 'Production Cargo.toml already contains the Windows automation driver dependency.'
  }
  $driverDependency = @'

[dependencies.tauri-plugin-wdio-webdriver]
version = "1"
'@
  $manifest = $manifest.TrimEnd() + $driverDependency + "`n"
  Set-Content -Path $manifestPath -Value $manifest -Encoding utf8

  $entryPath = Join-Path $hostRootPath 'src-tauri\src\main.rs'
  $entry = Get-Content $entryPath -Raw
  if ($entry -match 'tauri_plugin_wdio_webdriver') {
    throw 'Production main.rs already registers the Windows automation driver.'
  }
  $entry = Assert-SingleReplacement `
    -Content $entry `
    -Needle '    let result = tauri::Builder::default()' `
    -Replacement "    let result = tauri::Builder::default()`n        .plugin(tauri_plugin_wdio_webdriver::init())" `
    -Description 'Tauri builder'
  Set-Content -Path $entryPath -Value $entry -Encoding utf8

  $capabilityPath = Join-Path $hostRootPath 'src-tauri\capabilities\default.json'
  $capability = Get-Content $capabilityPath -Raw | ConvertFrom-Json
  if ($capability.permissions -contains 'wdio-webdriver:default') {
    throw 'Production capability already exposes the Windows automation driver.'
  }
  $capability.permissions = @($capability.permissions) + 'wdio-webdriver:default'
  $capability | ConvertTo-Json -Depth 10 | Set-Content -Path $capabilityPath -Encoding utf8

  $tauriConfigPath = Join-Path $hostRootPath 'src-tauri\tauri.conf.json'
  $tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
  if (-not $tauriConfig.build.frontendDist) {
    throw 'Isolated Windows driver host requires build.frontendDist.'
  }
  $productionDevUrl = $tauriConfig.build.devUrl
  $productionBeforeDevCommand = $tauriConfig.build.beforeDevCommand
  $tauriConfig.build.PSObject.Properties.Remove('devUrl')
  $tauriConfig.build.PSObject.Properties.Remove('beforeDevCommand')
  $tauriConfig | ConvertTo-Json -Depth 20 | Set-Content -Path $tauriConfigPath -Encoding utf8

  & cargo generate-lockfile --manifest-path $manifestPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Cargo lock generation failed for the isolated Windows driver host.'
  }

  [pscustomobject]@{
    hostRoot = $hostRootPath
    manifest = $manifestPath
    binary = (Join-Path $hostRootPath 'src-tauri\target\debug\markdown-editor.exe')
    productionManifestUnchanged = $true
    productionCapabilityUnchanged = $true
    productionConfigUnchanged = $true
    driverProvider = 'embedded'
    frontendSource = 'embedded-dist'
    removedDevUrl = [bool]$productionDevUrl
    removedBeforeDevCommand = [bool]$productionBeforeDevCommand
  } | ConvertTo-Json | Set-Content -Path (Join-Path $hostRootPath 'driver-host.json') -Encoding utf8
} finally {
  if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
  }
}
