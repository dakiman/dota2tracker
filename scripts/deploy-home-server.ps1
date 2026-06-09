#Requires -Version 5.1
<#
.SYNOPSIS
  Archives the repo (no node_modules), uploads it, and runs docker compose on the home server.

.PARAMETER IdentityFile
  Path to an SSH private key. If omitted, uses the first existing of:
  $env:USERPROFILE\.ssh\id_ed25519, id_rsa

Prerequisites on the server: Docker Engine + Docker Compose plugin, user in docker group (or use sudo).
First-time DB: after deploy, run migrations (see DEPLOY.md).
#>
param(
  [string]$RemoteUser = "dakiman",
  [string]$RemoteHost = "192.168.100.253",
  [string]$RemoteDir = "dota2chipetracker",
  [string]$IdentityFile = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-SshKeyArg {
  if ($IdentityFile) {
    if (-not (Test-Path -LiteralPath $IdentityFile)) {
      throw "Identity file not found: $IdentityFile"
    }
    return @("-i", $IdentityFile)
  }
  foreach ($name in @("id_ed25519", "id_rsa", "id_ecdsa")) {
    $p = Join-Path $env:USERPROFILE ".ssh\$name"
    if (Test-Path -LiteralPath $p) { return @("-i", $p) }
  }
  return @()
}

$keyArg = Get-SshKeyArg
$target = "${RemoteUser}@${RemoteHost}"

$Tgz = Join-Path $env:TEMP "dota2chipetracker-deploy-$(Get-Date -Format 'yyyyMMddHHmmss').tgz"
try {
  try {
    Push-Location $Root
    Write-Host "Creating archive (excluding node_modules, .git)..."
    & tar -czf $Tgz --exclude=node_modules --exclude=.git .
  } finally {
    Pop-Location
  }

  Write-Host "Testing SSH to $target ..."
  $sshTest = & ssh @keyArg -o BatchMode=yes -o ConnectTimeout=15 $target "echo ok" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host $sshTest
    Write-Error @"
SSH authentication failed. From this PC, install your public key on the server, then re-run:

  type `$env:USERPROFILE\.ssh\id_ed25519.pub | ssh ${target} "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

(Use your actual .pub file if different.)
"@
    exit 1
  }

  Write-Host "Uploading archive..."
  & scp @keyArg $Tgz "${target}:~/dota2chipetracker-deploy.tgz"
  if ($LASTEXITCODE -ne 0) { throw "scp failed" }

  $remoteCmd = "mkdir -p ~/$RemoteDir && tar -xzf ~/dota2chipetracker-deploy.tgz -C ~/$RemoteDir && rm -f ~/dota2chipetracker-deploy.tgz && cd ~/$RemoteDir && docker compose up -d --build && docker compose ps"

  Write-Host "Extracting and starting stack on server..."
  & ssh @keyArg $target $remoteCmd
  if ($LASTEXITCODE -ne 0) { throw "Remote docker compose failed" }

  Write-Host ""
  Write-Host "Done. From your LAN open: http://${RemoteHost}/"
  Write-Host "API health (proxied): http://${RemoteHost}/api/health"
  Write-Host "If the DB is new, run migrations from your dev machine (see DEPLOY.md)."
} finally {
  if (Test-Path -LiteralPath $Tgz) { Remove-Item -LiteralPath $Tgz -Force -ErrorAction SilentlyContinue }
}
