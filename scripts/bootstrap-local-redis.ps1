# Redis 8.x محلي لـ BullMQ (Windows) — لا يُضاف إلى git (.redis-local/)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dir = Join-Path $Root ".redis-local"
$Zip = Join-Path $Dir "redis.zip"
$Url = "https://github.com/redis-windows/redis-windows/releases/download/8.8.0/Redis-8.8.0-Windows-x64-msys2.zip"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$exe = Get-ChildItem -Path $Dir -Recurse -Filter "redis-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  Write-Host "Downloading Redis 8.8..."
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
  Expand-Archive -Path $Zip -DestinationPath $Dir -Force
  Remove-Item $Zip -Force -ErrorAction SilentlyContinue
  $exe = Get-ChildItem -Path $Dir -Recurse -Filter "redis-server.exe" | Select-Object -First 1
}

if (-not $exe) { throw "redis-server.exe not found under $Dir" }

$redisDir = Split-Path $exe.FullName -Parent
$conf = Join-Path $redisDir "redis.conf"
if (-not (Test-Path $conf)) { throw "redis.conf missing in $redisDir" }

$running = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "REDIS_ALREADY_LISTENING 6379"
} else {
  Start-Process -FilePath $exe.FullName -ArgumentList $conf -WorkingDirectory $redisDir -WindowStyle Hidden
  Start-Sleep -Seconds 3
  $pong = & (Join-Path $redisDir "redis-cli.exe") ping 2>&1
  if ($pong -ne "PONG") { throw "redis-cli ping failed: $pong" }
  Write-Host "REDIS_STARTED" $exe.FullName "version" (& (Join-Path $redisDir "redis-cli.exe") INFO server | Select-String "redis_version")
}

node (Join-Path $Root "scripts\set-redis-url.mjs") "redis://127.0.0.1:6379"
