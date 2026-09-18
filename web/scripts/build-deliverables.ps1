[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$OutputRoot = '',
    [string]$ReleaseNotes = '使用说明、黑白银/黑白金/自选主题、采购测算摘要、手绘棉花图标与标准化交付归档。'
)

$ErrorActionPreference = 'Stop'

function Assert-ChildPath {
    param([string]$Path, [string]$Parent)
    $parentPrefix = $Parent.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $Path.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作工作目录之外的路径：$Path"
    }
}

$webRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $webRoot 'package.json') | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = [string]$package.version }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw "版本号格式无效：$Version" }

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $deliveryRoot = Join-Path $webRoot 'deliverables'
} else {
    $deliveryRoot = [IO.Path]::GetFullPath((Join-Path $webRoot $OutputRoot))
}
Assert-ChildPath -Path $deliveryRoot -Parent $webRoot

$currentRoot = Join-Path $deliveryRoot 'current'
$archiveRoot = Join-Path $deliveryRoot 'archive'
$archiveIndex = Join-Path $archiveRoot 'VERSIONS.md'
New-Item -ItemType Directory -Force -Path $currentRoot, $archiveRoot | Out-Null
if (-not (Test-Path -LiteralPath $archiveIndex)) {
    Set-Content -LiteralPath $archiveIndex -Encoding utf8 -Value "# 历史交付版本`n"
}

$existingZips = @(Get-ChildItem -LiteralPath $currentRoot -Filter '*.zip' -File -ErrorAction SilentlyContinue)
if ($existingZips.Count -gt 0) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $priorDescriptionPath = Join-Path $currentRoot 'VERSION.md'
    $priorDescription = if (Test-Path -LiteralPath $priorDescriptionPath) {
        (Get-Content -Raw -LiteralPath $priorDescriptionPath).Trim()
    } else {
        '旧版本说明缺失。'
    }
    $archivedNames = [Collections.Generic.List[string]]::new()
    foreach ($zip in $existingZips) {
        $archiveName = '{0}-{1}{2}' -f $zip.BaseName, $timestamp, $zip.Extension
        $destination = Join-Path $archiveRoot $archiveName
        Move-Item -LiteralPath $zip.FullName -Destination $destination -ErrorAction Stop
        $archivedNames.Add($archiveName)
    }
    $archiveEntry = @(
        ''
        "## $timestamp"
        ''
        $priorDescription
        ''
        ('归档文件：' + ($archivedNames -join '、'))
        ''
    ) -join "`n"
    Add-Content -LiteralPath $archiveIndex -Encoding utf8 -Value $archiveEntry
}

$stageRoot = Join-Path $webRoot ('.delivery-staging-' + [Guid]::NewGuid().ToString('N'))
Assert-ChildPath -Path $stageRoot -Parent $webRoot
$mobileStage = Join-Path $stageRoot 'mobile'
$serverStage = Join-Path $stageRoot 'server'

function Copy-Runtime {
    param([string]$Destination)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($name in @('index.html', 'styles.css', 'manifest.webmanifest', 'sw.js')) {
        Copy-Item -LiteralPath (Join-Path $webRoot $name) -Destination (Join-Path $Destination $name)
    }
    foreach ($directory in @('assets', 'icons')) {
        Copy-Item -LiteralPath (Join-Path $webRoot $directory) -Destination (Join-Path $Destination $directory) -Recurse
    }
    $jsDestination = Join-Path $Destination 'js'
    New-Item -ItemType Directory -Force -Path $jsDestination | Out-Null
    foreach ($name in @('app.js', 'calculator.js', 'decimal.js', 'storage.js', 'theme.js', 'inquiry.js')) {
        Copy-Item -LiteralPath (Join-Path $webRoot "js\$name") -Destination (Join-Path $jsDestination $name)
    }
}

try {
    Copy-Runtime -Destination $mobileStage
    Copy-Item -LiteralPath (Join-Path $webRoot 'deployment\MOBILE_USE.md') -Destination (Join-Path $mobileStage 'MOBILE_USE.md')
    Copy-Item -LiteralPath (Join-Path $webRoot 'deployment\mobile-webclip.mobileconfig.template') -Destination (Join-Path $mobileStage 'mobile-webclip.mobileconfig.template')

    Copy-Runtime -Destination $serverStage
    foreach ($name in @('SERVER_HANDOFF.md', 'DEPLOYMENT_CHECKLIST.md', 'nginx-cottoncal.conf.example', 'mobile-webclip.mobileconfig.template')) {
        Copy-Item -LiteralPath (Join-Path $webRoot "deployment\$name") -Destination (Join-Path $serverStage $name)
    }
    $serverHashes = foreach ($file in Get-ChildItem -LiteralPath $serverStage -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring($serverStage.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
    Set-Content -LiteralPath (Join-Path $serverStage 'checksums.sha256') -Encoding ascii -Value $serverHashes

    $mobileZip = Join-Path $currentRoot "cottoncal-mobile-v$Version.zip"
    $serverZip = Join-Path $currentRoot "cottoncal-server-handoff-v$Version.zip"
    foreach ($zip in @($mobileZip, $serverZip)) {
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    }
    $mobileItems = (Get-ChildItem -LiteralPath $mobileStage).FullName
    $serverItems = (Get-ChildItem -LiteralPath $serverStage).FullName
    Compress-Archive -LiteralPath $mobileItems -DestinationPath $mobileZip -CompressionLevel Optimal
    Compress-Archive -LiteralPath $serverItems -DestinationPath $serverZip -CompressionLevel Optimal

    $currentHashes = foreach ($zip in @($mobileZip, $serverZip)) {
        $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $([IO.Path]::GetFileName($zip))"
    }
    Set-Content -LiteralPath (Join-Path $currentRoot 'CHECKSUMS.sha256') -Encoding ascii -Value $currentHashes
    $versionText = @(
        "# 当前交付版本 v$Version"
        ''
        "生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
        ''
        "版本说明：$ReleaseNotes"
        ''
        '包含：手机端更新包、服务器交接包。'
    ) -join "`n"
    Set-Content -LiteralPath (Join-Path $currentRoot 'VERSION.md') -Encoding utf8 -Value $versionText

    [pscustomobject]@{
        Version = $Version
        MobilePackage = $mobileZip
        ServerPackage = $serverZip
        ArchiveIndex = $archiveIndex
    }
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        $resolvedStage = (Resolve-Path -LiteralPath $stageRoot).Path
        Assert-ChildPath -Path $resolvedStage -Parent $webRoot
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
