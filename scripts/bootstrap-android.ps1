[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $projectRoot '.tooling'
$downloadRoot = Join-Path $toolRoot 'downloads'
$jdkRoot = Join-Path $toolRoot 'jdk17'
$sdkRoot = Join-Path $toolRoot 'android-sdk'
$gradleRoot = Join-Path $toolRoot 'gradle-8.13'

foreach ($path in @($toolRoot, $downloadRoot)) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

function Download-IfMissing {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [Parameter(Mandatory)] [string] $Destination
    )
    if (-not (Test-Path -LiteralPath $Destination)) {
        Write-Host "Downloading $Uri"
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
    }
}

function Assert-Sha256 {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Expected
    )
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Path. Expected $Expected, got $actual"
    }
}

$jdkZip = Join-Path $downloadRoot 'temurin-jdk17.zip'
$jdkMetadata = Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
$jdkExpected = $jdkMetadata[0].binary.package.checksum
if ([string]::IsNullOrWhiteSpace($jdkExpected)) {
    throw 'Adoptium metadata did not provide the JDK SHA-256 checksum'
}
Download-IfMissing `
    -Uri 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse' `
    -Destination $jdkZip
Assert-Sha256 -Path $jdkZip -Expected $jdkExpected
if (-not (Test-Path -LiteralPath $jdkRoot)) {
    New-Item -ItemType Directory -Path $jdkRoot | Out-Null
    Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkRoot
}
$java = Get-ChildItem -LiteralPath $jdkRoot -Filter 'java.exe' -File -Recurse |
    Where-Object { $_.FullName -match '\\bin\\java\.exe$' } |
    Select-Object -First 1
if ($null -eq $java) { throw 'JDK 17 extraction did not produce bin\java.exe' }
$javaHome = Split-Path -Parent (Split-Path -Parent $java.FullName)
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

$commandLineZip = Join-Path $downloadRoot 'commandlinetools-win-15859902_latest.zip'
Download-IfMissing `
    -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' `
    -Destination $commandLineZip
Assert-Sha256 `
    -Path $commandLineZip `
    -Expected '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'

$commandLineLatest = Join-Path $sdkRoot 'cmdline-tools\latest'
if (-not (Test-Path -LiteralPath $commandLineLatest)) {
    $commandLineParent = Join-Path $sdkRoot 'cmdline-tools'
    if (-not (Test-Path -LiteralPath $commandLineParent)) {
        New-Item -ItemType Directory -Path $commandLineParent | Out-Null
    }
    $extractRoot = Join-Path $toolRoot 'cmdline-extract'
    if (-not (Test-Path -LiteralPath $extractRoot)) {
        New-Item -ItemType Directory -Path $extractRoot | Out-Null
    }
    Expand-Archive -LiteralPath $commandLineZip -DestinationPath $extractRoot
    $extracted = Join-Path $extractRoot 'cmdline-tools'
    if (-not (Test-Path -LiteralPath $extracted)) {
        throw 'Android command-line tools archive has an unexpected layout'
    }
    Move-Item -LiteralPath $extracted -Destination $commandLineLatest
}

$sdkManager = Join-Path $commandLineLatest 'bin\sdkmanager.bat'
$env:ANDROID_SDK_ROOT = $sdkRoot
$licenseInput = ((1..100) | ForEach-Object { 'y' }) -join [Environment]::NewLine
$licenseInput | & $sdkManager --sdk_root=$sdkRoot --licenses | Out-Host
if ($LASTEXITCODE -ne 0) { throw "sdkmanager --licenses failed with exit code $LASTEXITCODE" }

$sdkArgs = @(
    "--sdk_root=$sdkRoot"
    'platforms;android-36'
    'build-tools;36.0.0'
    'platform-tools'
)
& $sdkManager @sdkArgs
if ($LASTEXITCODE -ne 0) { throw "sdkmanager install failed with exit code $LASTEXITCODE" }

$gradleZip = Join-Path $downloadRoot 'gradle-8.13-bin.zip'
$gradleShaFile = Join-Path $downloadRoot 'gradle-8.13-bin.zip.sha256'
Download-IfMissing -Uri 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' -Destination $gradleZip
Download-IfMissing -Uri 'https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256' -Destination $gradleShaFile
$gradleExpected = (Get-Content -Raw -LiteralPath $gradleShaFile).Trim().Split(' ')[0]
Assert-Sha256 -Path $gradleZip -Expected $gradleExpected
if (-not (Test-Path -LiteralPath $gradleRoot)) {
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $toolRoot
}

$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-home'
$gradle = Join-Path $gradleRoot 'bin\gradle.bat'
$wrapperArgs = @('wrapper', '--gradle-version', '8.13', '--distribution-type', 'bin')
& $gradle @wrapperArgs
if ($LASTEXITCODE -ne 0) { throw "Gradle wrapper generation failed with exit code $LASTEXITCODE" }
$wrapperProperties = Join-Path $projectRoot 'gradle\wrapper\gradle-wrapper.properties'
$wrapperLines = Get-Content -LiteralPath $wrapperProperties
if (-not ($wrapperLines -match '^distributionSha256Sum=')) {
    $updatedWrapperLines = foreach ($line in $wrapperLines) {
        $line
        if ($line -match '^distributionUrl=') {
            "distributionSha256Sum=$gradleExpected"
        }
    }
    Set-Content -LiteralPath $wrapperProperties -Value $updatedWrapperLines -Encoding utf8NoBOM
}

Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_SDK_ROOT=$sdkRoot"
Write-Host 'Android build toolchain is ready.'
