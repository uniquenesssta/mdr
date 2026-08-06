$ErrorActionPreference = 'Stop'

$webViewRoot = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'
$edgeRoot = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application'

function Get-VersionDirectory([string]$Root) {
  if (-not (Test-Path $Root)) {
    return $null
  }

  return Get-ChildItem $Root -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
}

$runtime = Get-VersionDirectory $webViewRoot
if ($null -eq $runtime) {
  $runtime = Get-VersionDirectory $edgeRoot
}
if ($null -eq $runtime) {
  throw 'Neither Microsoft Edge WebView2 Runtime nor Microsoft Edge was found.'
}

$version = $runtime.Name
$driverDirectory = Join-Path $env:RUNNER_TEMP "msedgedriver-$version"
$driverExecutable = Join-Path $driverDirectory 'msedgedriver.exe'
$downloadUrl = "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip"
$archive = Join-Path $env:RUNNER_TEMP "msedgedriver-$version.zip"

if (-not (Test-Path $driverExecutable)) {
  Write-Host "Downloading Microsoft Edge WebDriver $version"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
  if (Test-Path $driverDirectory) {
    Remove-Item $driverDirectory -Recurse -Force
  }
  Expand-Archive -Path $archive -DestinationPath $driverDirectory -Force
}

if (-not (Test-Path $driverExecutable)) {
  throw "Microsoft Edge WebDriver was not extracted to $driverExecutable"
}

$driverDirectory | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
"MSEDGEDRIVER_PATH=$driverExecutable" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"MSEDGEDRIVER_TELEMETRY_OPTOUT=1" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"MSEDGEDRIVER_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append

[pscustomobject]@{
  webViewOrEdgeVersion = $version
  driverPath = $driverExecutable
  source = $downloadUrl
} | ConvertTo-Json | Set-Content -Path 'artifacts/stage-03/windows-window/driver-environment.json' -Encoding utf8

& $driverExecutable --version
