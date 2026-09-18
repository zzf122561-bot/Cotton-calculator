# One-time, non-destructive relocation of pre-manager release files.
# Refuses partial reruns or unexpected targets; does not touch signing/local config.
[CmdletBinding()]
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
$rootPrefix = $root + '\'

function Resolve-WithinRoot {
    param([string]$Relative)
    $path = [IO.Path]::GetFullPath((Join-Path $root $Relative))
    if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path outside project: $path"
    }
    return $path
}

$moves = @(
    'VERIFICATION.md|_manager/releases/android/VERIFICATION.md'
    'web/VERIFICATION.md|_manager/releases/web/VERIFICATION.md'
    'web/deliverables/README.md|_manager/releases/web/README.md'
    'web/deliverables/archive/VERSIONS.md|_manager/releases/web/LEGACY_VERSIONS.md'
    'web/deliverables/current/VERSION.md|_manager/releases/web/v1.1.0/VERSION.md'
    'web/deliverables/current/CHECKSUMS.sha256|_manager/releases/web/v1.1.0/CHECKSUMS.sha256'
    'web/deliverables/current/cottoncal-mobile-v1.1.0.zip|_manager/releases/web/v1.1.0/cottoncal-mobile-v1.1.0.zip'
    'web/deliverables/current/cottoncal-server-handoff-v1.1.0.zip|_manager/releases/web/v1.1.0/cottoncal-server-handoff-v1.1.0.zip'
    'web/deployment/SERVER_HANDOFF.md|_manager/templates/web/SERVER_HANDOFF.md'
    'web/deployment/DEPLOYMENT_CHECKLIST.md|_manager/templates/web/DEPLOYMENT_CHECKLIST.md'
    'web/deployment/nginx-cottoncal.conf.example|_manager/templates/web/nginx-cottoncal.conf.example'
    'web/deployment/MOBILE_USE.md|_manager/legacy/web/MOBILE_USE.md'
    'web/deployment/mobile-webclip.mobileconfig.template|_manager/legacy/web/mobile-webclip.mobileconfig.template'
    'web/scripts/build-deliverables.ps1|_manager/legacy/web/build-deliverables-v1.1.0.ps1'
    'web/test/deliverables.test.js|_manager/tests/web-packaging.test.mjs'
    'web/screenshots/v1.1.0-mobile-silver.jpg|_manager/releases/web/v1.1.0/screenshots/v1.1.0-mobile-silver.jpg'
    'web/screenshots/v1.1.0-mobile-guide.jpg|_manager/releases/web/v1.1.0/screenshots/v1.1.0-mobile-guide.jpg'
    'web/screenshots/iphone-light.png|_manager/releases/web/v1.1.0/screenshots/iphone-light.png'
    'web/screenshots/iphone-dark.png|_manager/releases/web/v1.1.0/screenshots/iphone-dark.png'
    'web/screenshots/iphone-dark-details.png|_manager/releases/web/v1.1.0/screenshots/iphone-dark-details.png'
    'web/screenshots/iphone-dark-contact.png|_manager/releases/web/v1.1.0/screenshots/iphone-dark-contact.png'
    'web/screenshots/ipad-light.png|_manager/releases/web/v1.1.0/screenshots/ipad-light.png'
    'web/screenshots/ipad-dark.png|_manager/releases/web/v1.1.0/screenshots/ipad-dark.png'
    'web/screenshots/feedback-cotton-dark.png|_manager/releases/web/v1.1.0/screenshots/feedback-cotton-dark.png'
    'artifacts/CottonCal-v1.0.1-release.apk|_manager/releases/android/v1.0.1/CottonCal-v1.0.1-release.apk'
    'dist/皮棉成本换算-v1.0.0.apk|_manager/releases/android/v1.0.0/皮棉成本换算-v1.0.0.apk'
    'dist/皮棉成本换算-v1.0.0-source.zip|_manager/releases/android/v1.0.0/皮棉成本换算-v1.0.0-source.zip'
    'dist/验收记录.md|_manager/releases/android/v1.0.0/验收记录.md'
    'dist/SHA256SUMS.txt|_manager/releases/android/v1.0.0/SHA256SUMS.txt'
)

$prepared = foreach ($entry in $moves) {
    $pair = $entry -split '\|', 2
    $source = Resolve-WithinRoot $pair[0]
    $target = Resolve-WithinRoot $pair[1]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source: $source" }
    if (Test-Path -LiteralPath $target) { throw "Target exists: $target" }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $target) -PathType Container)) {
        throw "Missing target directory: $target"
    }
    [pscustomobject]@{
        Source = $source
        Target = $target
        Hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    }
}

if ($WhatIf) {
    $prepared | Select-Object Source,Target,Hash
    return
}

foreach ($item in $prepared) {
    Move-Item -LiteralPath $item.Source -Destination $item.Target -ErrorAction Stop
    $after = (Get-FileHash -LiteralPath $item.Target -Algorithm SHA256).Hash
    if ($after -ne $item.Hash) { throw "Hash mismatch after move: $($item.Target)" }
    [pscustomobject]@{ Target = $item.Target; SHA256 = $after }
}
