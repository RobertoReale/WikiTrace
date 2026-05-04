# WikiTrace — build script
# Creates ready-to-upload ZIP files for Chrome Web Store and Firefox AMO.
#
# Usage:
#   .\build.ps1              # builds both chrome and firefox (default)
#   .\build.ps1 -Target chrome
#   .\build.ps1 -Target firefox

param(
  [ValidateSet('chrome', 'firefox', 'both')]
  [string]$Target = 'both'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $MyInvocation.MyCommand.Path -Parent
$Dist = Join-Path $Root 'dist'

# Patterns (relative paths) to exclude from both builds
$ExcludePatterns = @(
  '^\.git[\\/]',
  '^dist[\\/]',
  '^build\.ps1$',
  '^manifest\.firefox\.json$',
  '^ROADMAP\.txt$',
  '^PUBLISH_CHECKLIST\.txt$',
  '^\.gitignore$',
  '^README\.md$',
  '^node_modules[\\/]'
)

function Test-Excluded ([string]$RelPath) {
  foreach ($p in $ExcludePatterns) {
    if ($RelPath -match $p) { return $true }
  }
  return $false
}

# Copies extension source into $Dest, then drops $ManifestSrc in as manifest.json.
function Copy-Build ([string]$Dest, [string]$ManifestSrc) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null

  Get-ChildItem -Recurse -File -Path $Root | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
    if ($rel -eq 'manifest.json') { return }   # replaced below
    if (Test-Excluded $rel) { return }

    $dst = Join-Path $Dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item $_.FullName -Destination $dst -Force
  }

  Copy-Item $ManifestSrc -Destination (Join-Path $Dest 'manifest.json') -Force
}

function Build-Chrome {
  Write-Host 'Building Chrome...' -ForegroundColor Cyan
  $tmp = Join-Path $Dist '_chrome'
  $zip = Join-Path $Dist 'wikitrace-chrome.zip'

  Copy-Build -Dest $tmp -ManifestSrc (Join-Path $Root 'manifest.json')

  if (Test-Path $zip) { Remove-Item $zip }
  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip
  Remove-Item -Recurse -Force $tmp

  Write-Host "  => $zip" -ForegroundColor Green
}

function Build-Firefox {
  Write-Host 'Building Firefox...' -ForegroundColor Cyan
  $ffManifest = Join-Path $Root 'manifest.firefox.json'
  if (-not (Test-Path $ffManifest)) {
    Write-Error 'manifest.firefox.json not found.'
    return
  }

  $tmp = Join-Path $Dist '_firefox'
  $zip = Join-Path $Dist 'wikitrace-firefox.zip'

  Copy-Build -Dest $tmp -ManifestSrc $ffManifest

  if (Test-Path $zip) { Remove-Item $zip }
  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip
  Remove-Item -Recurse -Force $tmp

  Write-Host "  => $zip" -ForegroundColor Green
}

# Pre-flight checks
if (-not (Test-Path (Join-Path $Root 'lib\d3.min.js'))) {
  Write-Warning 'lib\d3.min.js is missing. Download D3 v7 from https://d3js.org/ and place it in lib\'
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null

switch ($Target) {
  'chrome'  { Build-Chrome }
  'firefox' { Build-Firefox }
  'both'    { Build-Chrome; Build-Firefox }
}

Write-Host 'Done.' -ForegroundColor Green
