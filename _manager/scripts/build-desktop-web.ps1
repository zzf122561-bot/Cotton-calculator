[CmdletBinding()]
param(
    [ValidateSet('test', 'release')]
    [string]$Channel = 'test',
    [string]$Version = '',
    [string]$CandidateId = '',
    [string]$AcceptanceRef = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
$managerRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$webRoot = Join-Path $root 'web'

function Assert-ManagerChild {
    param([string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($managerRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside manager directory: $full"
    }
}

if ($Channel -eq 'release' -and [string]::IsNullOrWhiteSpace($AcceptanceRef)) {
    throw 'A release package requires -AcceptanceRef identifying user acceptance.'
}

$package = Get-Content -Raw -LiteralPath (Join-Path $webRoot 'package.json') | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = [string]$package.version }
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
    throw "Invalid version: $Version"
}

$sourceCommit = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Cannot resolve a committed source revision.'
}
$webTree = (& git -C $root rev-parse 'HEAD:web').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the web source tree.' }
$dirty = @(& git -C $root status --porcelain -- web _manager/templates/web _manager/scripts/build-desktop-web.ps1)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect source status.' }
if ($dirty.Count -gt 0) { throw 'Web source or packaging templates have uncommitted changes.' }

if ([string]::IsNullOrWhiteSpace($CandidateId)) {
    $CandidateId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $sourceCommit.Substring(0, 8)
}
if ($CandidateId -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid CandidateId.' }

$outputDir = Join-Path $managerRoot "releases\web\v$Version\$Channel\$CandidateId"
Assert-ManagerChild $outputDir
if (Test-Path -LiteralPath $outputDir) { throw "Refusing to overwrite existing package: $outputDir" }

$stageRoot = Join-Path $managerRoot ('.staging\' + [Guid]::NewGuid().ToString('N'))
Assert-ManagerChild $stageRoot
New-Item -ItemType Directory -Path $stageRoot -ErrorAction Stop | Out-Null
try {
    foreach ($name in @('index.html', 'styles.css', 'manifest.webmanifest', 'sw.js')) {
        Copy-Item -LiteralPath (Join-Path $webRoot $name) -Destination (Join-Path $stageRoot $name) -ErrorAction Stop
    }
    foreach ($name in @('js', 'assets', 'icons')) {
        Copy-Item -LiteralPath (Join-Path $webRoot $name) -Destination $stageRoot -Recurse -ErrorAction Stop
    }

    $templateRoot = Join-Path $managerRoot 'templates\web'
    $serverTemplate = Get-Content -Raw -LiteralPath (Join-Path $templateRoot 'SERVER_HANDOFF.md')
    $serverText = $serverTemplate.Replace('__VERSION__', $Version).Replace('__SOURCE_COMMIT__', $sourceCommit)
    Set-Content -LiteralPath (Join-Path $stageRoot 'SERVER_HANDOFF.md') -Encoding utf8 -Value $serverText
    foreach ($name in @('DEPLOYMENT_CHECKLIST.md', 'nginx-cottoncal.conf.example')) {
        Copy-Item -LiteralPath (Join-Path $templateRoot $name) -Destination (Join-Path $stageRoot $name) -ErrorAction Stop
    }

    $checksums = foreach ($file in Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
    Set-Content -LiteralPath (Join-Path $stageRoot 'checksums.sha256') -Encoding ascii -Value $checksums

    New-Item -ItemType Directory -Path $outputDir -ErrorAction Stop | Out-Null
    $zipName = "cottoncal-desktop-v$Version-$Channel-$CandidateId.zip"
    $zipPath = Join-Path $outputDir $zipName
    $stageItems = @(Get-ChildItem -LiteralPath $stageRoot | Select-Object -ExpandProperty FullName)
    Compress-Archive -LiteralPath $stageItems -DestinationPath $zipPath -CompressionLevel Optimal -ErrorAction Stop
    $zipItem = Get-Item -LiteralPath $zipPath
    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $manifest = [ordered]@{
        schemaVersion = 1
        product = 'web-desktop'
        channel = $Channel
        version = $Version
        candidateId = $CandidateId
        sourceCommit = $sourceCommit
        webTree = $webTree
        acceptanceRef = $AcceptanceRef
        packageFile = $zipName
        packageBytes = $zipItem.Length
        packageSha256 = $zipHash
        generatedAt = (Get-Date).ToString('o')
        testEvidence = 'Record separately; packaging does not assert tests passed.'
        deploymentEvidence = 'Not deployed by this script.'
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputDir 'MANIFEST.json') -Encoding utf8
    [pscustomobject]@{ Package = $zipPath; SHA256 = $zipHash; Manifest = (Join-Path $outputDir 'MANIFEST.json') }
}
finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Assert-ManagerChild $stageRoot
        Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction Stop
    }
}
