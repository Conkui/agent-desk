param([int]$Port = 4190)
$ErrorActionPreference = 'Stop'
Write-Host 'Agent Desk does not expose a public computer port.'
$tailscaleTool = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $tailscaleTool) {
    Write-Host 'Tailscale is not installed. Install it yourself on the PC and phone, then join the same private network.'
} else {
    & $tailscaleTool.Source status
}
Write-Host 'Manual private HTTPS setup, after checking existing Serve configuration:'
Write-Host "  tailscale serve --bg http://127.0.0.1:$Port"
Write-Host 'Restart Agent Desk with -PrivateOrigin https://<your-device>.<tailnet>.ts.net'
Write-Host 'Use Serve only, never Funnel. Do not add router port forwarding or a public firewall rule.'
Write-Host 'This diagnostic script has not changed your network configuration.'
