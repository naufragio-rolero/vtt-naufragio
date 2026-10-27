param(
    [Parameter(Mandatory = $true)][string]$SshTarget,
    [Parameter(Mandatory = $true)][string]$IdentityFile,
    [ValidateRange(1024, 65535)][int]$RemotePort = 3400
)
$ErrorActionPreference = 'Stop'
if ($SshTarget.StartsWith('-') -or $SshTarget -notmatch '^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9_.:-]+$') { throw 'INVALID_SSH_TARGET' }
if ($RemotePort -in @(3306, 8787, 9090)) { throw 'EXISTING_SERVICE_PORT_FORBIDDEN' }
$identity = (Resolve-Path -LiteralPath $IdentityFile).Path
$sshArguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-i', $identity)
# No sudo, installations, file writes, forwarding listeners or daemon changes.
& ssh @sshArguments $SshTarget 'uname -m; getconf LONG_BIT; free -m; df -Pm /var/tmp; cat /sys/class/thermal/thermal_zone0/temp; uptime; systemctl is-active apache2 mariadb ssh; pgrep -x node || true'
if ($LASTEXITCODE -ne 0) { throw 'SSH_BASELINE_FAILED' }
# Test an unused destination. Refused = forwarding permitted; prohibited = stop.
# timeout bounds even a misconfigured destination that unexpectedly accepts TCP.
$probe = New-Object System.Diagnostics.ProcessStartInfo
$probe.FileName = 'ssh.exe'
$probe.UseShellExecute = $false
$probe.CreateNoWindow = $true
$probe.RedirectStandardError = $true
$probe.RedirectStandardOutput = $true
# Arguments contain only validated target/port and a resolved key path; no shell.
if ($identity.Contains('"')) { throw 'INVALID_IDENTITY_PATH' }
$probe.Arguments = '-o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -i "' + $identity + '" -W 127.0.0.1:' + $RemotePort + ' ' + $SshTarget
$process = [System.Diagnostics.Process]::Start($probe)
try {
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'PORT_NOT_CONFIRMED_FREE' }
    $message = $process.StandardError.ReadToEnd()
    if ($message -match 'administratively prohibited') { throw 'SSH_FORWARDING_DENIED: no iniciar ni transferir el piloto; requiere una ruta autorizada por operaciones.' }
    if ($message -notmatch 'connect failed: Connection refused') { throw 'FORWARDING_OR_FREE_PORT_UNCONFIRMED' }
    Write-Output 'FORWARDING_PERMITTED_DESTINATION_REFUSED: repetir recursos y puerto libre antes de preparar el piloto.'
} finally { $process.Dispose() }
