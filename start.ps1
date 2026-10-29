param(
    [string]$BunPath = '',
    [int]$Port = 4190,
    [string]$Workspace = $PSScriptRoot,
    [string]$PrivateOrigin = '',
    [switch]$NoBrowser,
    [switch]$Rebuild,
    [switch]$InstallOpenCode
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be between 1024 and 65535.' }
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { throw 'Workspace must be an existing directory.' }
$taskTemp = Join-Path $PSScriptRoot '.local/temp'
New-Item -ItemType Directory -Path $taskTemp -Force | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:TMPDIR = $taskTemp
$env:BUN_INSTALL_CACHE_DIR = Join-Path $PSScriptRoot '.local/bun-cache'
$env:npm_config_cache = Join-Path $PSScriptRoot '.local/npm-cache'
if (-not $BunPath) {
    $BunPath = Join-Path $PSScriptRoot '.local/tools/node_modules/bun/bin/bun.exe'
    if (-not (Test-Path -LiteralPath $BunPath)) {
        $existingBun = Get-Command bun -ErrorAction SilentlyContinue
        if ($existingBun) { $BunPath = $existingBun.Source }
        else {
            & npm.cmd install --prefix (Join-Path $PSScriptRoot '.local/tools') bun@1.3.14 --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the project-local Bun runtime.' }
        }
    }
}
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath node_modules/typescript)) {
        & $BunPath install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Could not install project dependencies.' }
    }
    if ($InstallOpenCode) {
        & npm.cmd install --prefix (Join-Path $PSScriptRoot '.local/agents') opencode-ai@1.19.3 --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Could not install the local OpenCode runtime.' }
    }
    # A small build keeps the shortcut synchronized with source edits.
    & $BunPath run build
    if ($LASTEXITCODE -ne 0) { throw 'Console build failed.' }
    $env:AGENT_DESK_PORT = "$Port"
    $env:AGENT_DESK_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).Path
    $env:AGENT_DESK_PRIVATE_ORIGIN = $PrivateOrigin
    $env:AGENT_DESK_OPEN_BROWSER = if ($NoBrowser) { '0' } else { '1' }
    Write-Host "Agent Desk: http://127.0.0.1:$Port/workflows"
    Write-Host 'The service is loopback-only. No firewall rule or public port mapping will be created.'
    & $BunPath run start
    exit $LASTEXITCODE
} finally { Pop-Location }
