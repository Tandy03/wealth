$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$paths = @('.env', 'backend/config/google-credentials.json', 'backend/config/google-token.json', 'backend/config/google-drive-state.json')
foreach ($relativePath in $paths) {
    $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
    if (!$filePath.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected secrets path' }
    if (!(Test-Path -LiteralPath $filePath)) { continue }
    $previousAcl = Get-Acl -LiteralPath $filePath
    $ownerSid = (New-Object Security.Principal.NTAccount($previousAcl.Owner)).Translate([Security.Principal.SecurityIdentifier])
    $privateAcl = New-Object Security.AccessControl.FileSecurity
    $privateAcl.SetOwner($ownerSid)
    $privateAcl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($ownerSid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        $principal = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'Allow')
        $privateAcl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $filePath -AclObject $privateAcl
    Write-Output "$relativePath : owner, SYSTEM and Administrators only."
}
