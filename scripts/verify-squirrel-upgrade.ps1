[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PreviousSetup,

  [Parameter(Mandatory = $true)]
  [string]$CandidateSetup,

  [Parameter(Mandatory = $true)]
  [string]$CandidateVersion,

  [switch]$AllowLocalMachine
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:GITHUB_ACTIONS -ne 'true' -and -not $AllowLocalMachine) {
  throw 'This installer test is isolated to GitHub Actions by default. Use -AllowLocalMachine only on a disposable Windows account.'
}

function Resolve-SetupFile([string]$PathValue) {
  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
  if ((Get-Item -LiteralPath $resolved.Path).PSIsContainer) {
    throw "Installer path is a directory: $PathValue"
  }
  return $resolved.Path
}

function Invoke-SquirrelSetup([string]$SetupPath) {
  $process = Start-Process `
    -FilePath $SetupPath `
    -ArgumentList '--silent' `
    -PassThru `
    -Wait `
    -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "Squirrel installer exited with code $($process.ExitCode)."
  }
}

function Stop-AppProcesses([string]$InstallRoot) {
  $resolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
  Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $processPath = $_.Path
      if ($processPath -and $processPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
      # Some system processes deny path inspection; they are unrelated to this app.
    }
  }
}

$previousSetupPath = Resolve-SetupFile $PreviousSetup
$candidateSetupPath = Resolve-SetupFile $CandidateSetup
$candidateVersionValue = $CandidateVersion.TrimStart('v')
if ($candidateVersionValue -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
  throw "Candidate version is invalid: $CandidateVersion"
}

if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw 'RUNNER_TEMP is required for the isolated upgrade profile.'
}
$runnerTempRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$profilePath = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'm365-upgrade-profile'))
if (-not $profilePath.StartsWith($runnerTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use a profile outside RUNNER_TEMP: $profilePath"
}
if (Test-Path -LiteralPath $profilePath) {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
}
New-Item -ItemType Directory -Path $profilePath | Out-Null

$installRoot = Join-Path $env:LOCALAPPDATA 'M365MultiTenantManagement'
$stableExecutable = Join-Path $installRoot 'M365 Multi Tenant Management.exe'
$tenantId = 'upgrade-fixture-tenant'
$portalId = 'upgrade-fixture-portal'
$legacyConfiguration = [ordered]@{
  tenants = @(
    [ordered]@{
      id = $tenantId
      name = 'Upgrade Fixture'
      domain = 'upgradefixture.onmicrosoft.com'
    }
  )
  customPortals = @(
    [ordered]@{
      id = $portalId
      tenantId = $tenantId
      label = 'Fixture Portal'
      url = 'https://admin.microsoft.com/'
    }
  )
  tenantLastTabs = [ordered]@{
    $tenantId = 'admin'
  }
  tools = @(
    [ordered]@{
      id = 'pax8'
      label = 'Pax8'
      url = 'https://app.pax8.com/'
    }
  )
  windowState = [ordered]@{
    width = 1200
    height = 800
    isMaximized = $false
  }
}

try {
  Invoke-SquirrelSetup $previousSetupPath
  if (-not (Test-Path -LiteralPath $stableExecutable -PathType Leaf)) {
    throw "The previous installer did not create the stable executable: $stableExecutable"
  }

  $configurationPath = Join-Path $profilePath 'tenants.json'
  $legacyConfiguration | ConvertTo-Json -Depth 10 | Set-Content `
    -LiteralPath $configurationPath `
    -Encoding utf8NoBOM

  $cookiePath = Join-Path $profilePath "Partitions\tenant-$tenantId\Network\Cookies"
  New-Item -ItemType Directory -Path (Split-Path -Parent $cookiePath) -Force | Out-Null
  [IO.File]::WriteAllBytes(
    $cookiePath,
    [Text.Encoding]::UTF8.GetBytes('upgrade-cookie-database-sentinel-v1')
  )
  $cookieHashBefore = (Get-FileHash -LiteralPath $cookiePath -Algorithm SHA256).Hash

  Invoke-SquirrelSetup $candidateSetupPath
  $candidateDirectory = Join-Path $installRoot "app-$candidateVersionValue"
  if (-not (Test-Path -LiteralPath $candidateDirectory -PathType Container)) {
    throw "The candidate version was not installed: $candidateDirectory"
  }

  $appProcess = Start-Process `
    -FilePath $stableExecutable `
    -ArgumentList "`"--user-data-dir=$profilePath`"", '--disable-gpu' `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(90)
  $migratedConfiguration = $null
  while ((Get-Date) -lt $deadline) {
    if ($appProcess.HasExited) {
      throw "The candidate app exited before completing migration with code $($appProcess.ExitCode)."
    }
    try {
      $candidateConfiguration = Get-Content -Raw -LiteralPath $configurationPath | ConvertFrom-Json
      if ($candidateConfiguration.schemaVersion -eq 2) {
        $migratedConfiguration = $candidateConfiguration
        break
      }
    } catch {
      # electron-store may be replacing the file atomically; retry until the deadline.
    }
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $migratedConfiguration) {
    throw 'The candidate app did not migrate the fixture configuration within 90 seconds.'
  }

  Stop-AppProcesses $installRoot

  if ($migratedConfiguration.tenants.Count -ne 1) {
    throw 'Tenant count changed during the upgrade.'
  }
  if ($migratedConfiguration.tenants[0].id -ne $tenantId) {
    throw 'The tenant partition ID changed during the upgrade.'
  }
  if ($migratedConfiguration.tenants[0].domain -ne 'upgradefixture.onmicrosoft.com') {
    throw 'The tenant domain changed during the upgrade.'
  }
  if ($migratedConfiguration.customPortals[0].id -ne $portalId) {
    throw 'The custom portal session ID changed during the upgrade.'
  }
  if ($migratedConfiguration.customPortals[0].tenantId -ne $tenantId) {
    throw 'The custom portal was rebound to a different tenant during the upgrade.'
  }
  if ($null -eq $migratedConfiguration.preferences) {
    throw 'The application preferences migration did not run.'
  }
  if (-not (Test-Path -LiteralPath $cookiePath -PathType Leaf)) {
    throw 'The tenant cookie database was removed during the upgrade.'
  }
  $cookieHashAfter = (Get-FileHash -LiteralPath $cookiePath -Algorithm SHA256).Hash
  if ($cookieHashBefore -ne $cookieHashAfter) {
    throw 'The tenant cookie database changed during the upgrade.'
  }

  Write-Host "Upgrade verification passed for version $candidateVersionValue."
  Write-Host 'Tenant IDs, portal bindings, and the partition cookie sentinel were preserved.'
} finally {
  Stop-AppProcesses $installRoot
}
