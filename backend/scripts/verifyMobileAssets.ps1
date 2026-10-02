$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$frontendRoot = Join-Path $projectRoot 'frontend'
$apkPath = Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
$archive = [IO.Compression.ZipFile]::OpenRead($apkPath)
$checked = 0
try {
    foreach ($source in Get-ChildItem -LiteralPath $frontendRoot -File -Recurse) {
        $relative = $source.FullName.Substring($frontendRoot.Length + 1).Replace('\', '/')
        $entry = $archive.GetEntry('assets/public/' + $relative)
        if ($null -eq $entry) { throw "APK is missing $relative" }
        $entryStream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $packagedHash = [BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-', '') }
        finally { $entryStream.Dispose(); $sha.Dispose() }
        $sourceHash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
        if ($packagedHash -ne $sourceHash) { throw "APK contains outdated $relative" }
        $checked++
    }
} finally { $archive.Dispose() }
Write-Output "APK verified: all $checked frontend files match their source hashes."
