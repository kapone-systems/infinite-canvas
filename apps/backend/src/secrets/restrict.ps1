$ErrorActionPreference = 'Stop'
$path = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrEmpty($path)) { exit 2 }
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$id = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
[System.IO.File]::SetAccessControl($path, $acl)
