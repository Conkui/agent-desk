param([int]$Port = 4181)
$ErrorActionPreference = 'Stop'
$command = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $command) {
    Write-Host 'Tailscale is not installed. Install the official client on the PC and phone, then sign both into the same personal network.'
    Write-Host 'Download: https://tailscale.com/download'
    Write-Host 'This diagnostic does not install a VPN, change firewall rules, or expose the Hub.'
    exit 0
}
$rawStatus = & $command.Source status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale is not running or not signed in.' }
$status = $rawStatus | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw 'Sign in to Tailscale on this computer first.' }
$dns = $status.Self.DNSName.TrimEnd('.')
if (-not $dns) { throw 'Enable MagicDNS and HTTPS in your Tailscale network first.' }
Write-Host 'The following commands are instructions only; no network settings were changed.'
Write-Host 'Check that port 443 is not already used by another Tailscale Serve service:'
Write-Host '  tailscale serve status'
Write-Host 'Enable private HTTPS (visible only inside your Tailscale network):'
Write-Host "  tailscale serve --bg http://127.0.0.1:$Port"
Write-Host 'Start the Demo with the HTTPS origin so terminal connections accept it:'
Write-Host "  .\start.ps1 -Port $Port -PublicUrl https://$dns"
Write-Host "Phone URL: https://$dns/workflows"
Write-Host 'Use the same local pairing key at first login. Never paste it into a public chat or URL.'
Write-Host 'To turn off the HTTPS service you created on port 443:'
Write-Host '  tailscale serve --https=443 off'
