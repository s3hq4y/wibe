# Build a timestamped, version-bumped VSIX.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/_build_versioned.ps1
$ErrorActionPreference = "Stop"

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$ver = "0.1.1-dev.$ts"
Write-Host "=== Building version: $ver (timestamp $ts) ==="

function Write-NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $path), $text, $enc)
}

# 1) Bump version in package.json (first/top-level "version" only; idempotent)
$pj = Get-Content "package.json" -Raw
$pj = ([regex]'"version":\s*"(?:0\.1\.0|0\.1\.1-dev\.[^"]+)"').Replace($pj, '"version": "' + $ver + '"', 1)
Write-NoBom "package.json" $pj
Write-Host "package.json -> $ver"

# 2) Bump root version in package-lock.json (root package appears twice in lock v3).
#    Match the released version or any previous dev timestamp so the script is re-runnable.
$pl = Get-Content "package-lock.json" -Raw
$lockPat = '"version":\s*"(?:0\.1\.0|0\.1\.1-dev\.[^"]+)"'
$pl = [regex]::Replace($pl, $lockPat, ('"version": "' + $ver + '"'))
Write-NoBom "package-lock.json" $pl
Write-Host "package-lock.json -> $ver"

# 3) Embed build timestamp (src/.buildTimestamp.ts)
Write-Host "=== write-build-timestamp ==="
node scripts/write-build-timestamp.js
if ($LASTEXITCODE -ne 0) { throw "write-build-timestamp failed ($LASTEXITCODE)" }

# 4) Full build: gui (vite + copy assets) then minified extension bundle
Write-Host "=== npm run build ==="
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)" }

# 5) Package VSIX
Write-Host "=== npm run package ==="
npm run package
if ($LASTEXITCODE -ne 0) { throw "npm run package failed ($LASTEXITCODE)" }

# 6) Report artifact
Write-Host "=== build output ==="
Get-ChildItem "build" -Filter "*.vsix" | Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "=== DONE version=$ver ==="
