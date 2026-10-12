#requires -Version 7.3
# Copy to the root of the development installation. Invoke with &, never dot-source.
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'
$PSNativeCommandUseErrorActionPreference = $false
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$arguments = @($args)
foreach ($directory in @('home', 'data', 'config/opencode', 'cache', 'state', 'tmp', 'runtime',
    'workspaces/scratch', 'tools/bun/bin', 'home/AppData/Roaming', 'home/AppData/Local')) {
    [IO.Directory]::CreateDirectory((Join-Path $root $directory)) | Out-Null
}

$bin = $null
if ($arguments.Count -gt 0 -and $arguments[0] -eq '--exec') {
    if ($arguments.Count -lt 2 -or -not [IO.Path]::IsPathFullyQualified($arguments[1])) {
        throw 'Usage: opencode-dev.ps1 --exec C:\absolute\path\program.exe [args...]'
    }
    $executable = $arguments[1]
    $arguments = @($arguments | Select-Object -Skip 2)
} else {
    if ($arguments.Count -gt 0 -and $arguments[0] -in @('upgrade', 'update', 'uninstall')) {
        throw 'Use the source-build installation/rollback procedure in the guide.'
    }
    $pointer = Join-Path $root 'current.txt'
    if (-not (Test-Path -LiteralPath $pointer)) { throw 'No development build installed. Follow the guide.' }
    $version = [IO.File]::ReadAllText($pointer).Trim()
    if ($version -notmatch '^0\.0\.0-local-[0-9]+$') { throw 'Invalid development build in current.txt.' }
    $bin = Join-Path $root "releases/$version/bin"
    $executable = Join-Path $bin 'opencode.exe'
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Missing executable: $executable" }

$saved = @{}
foreach ($item in Get-ChildItem Env:) { $saved[$item.Name] = $item.Value }
$child = @{}
foreach ($name in @('PATH', 'SystemDrive', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'OS',
    'ProgramData', 'ALLUSERSPROFILE', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
    'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE', 'USERNAME', 'USERDOMAIN', 'TERM', 'COLORTERM', 'TERM_PROGRAM',
    'WT_SESSION', 'WT_PROFILE_ID', 'LANG', 'LC_ALL', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY',
    'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS')) {
    if ($saved.ContainsKey($name)) { $child[$name] = $saved[$name] }
}
$child['PATH'] = (@($bin, (Join-Path $root 'tools/bun/bin'), $saved['PATH']) |
    Where-Object { $_ }) -join ';'
$child['HOME'] = Join-Path $root 'home'
$child['USERPROFILE'] = $child['HOME']
$child['HOMEDRIVE'] = [IO.Path]::GetPathRoot($child['HOME']).TrimEnd('\')
$child['HOMEPATH'] = $child['HOME'].Substring($child['HOMEDRIVE'].Length)
$child['APPDATA'] = Join-Path $root 'home/AppData/Roaming'
$child['LOCALAPPDATA'] = Join-Path $root 'home/AppData/Local'
foreach ($pair in @{
    XDG_DATA_HOME = 'data'; XDG_CONFIG_HOME = 'config'; XDG_CACHE_HOME = 'cache'
    XDG_STATE_HOME = 'state'; XDG_RUNTIME_DIR = 'runtime'; TMPDIR = 'tmp'; TMP = 'tmp'; TEMP = 'tmp'
    BUN_INSTALL = 'tools/bun'; BUN_INSTALL_CACHE_DIR = 'cache/bun'
    npm_config_cache = 'cache/npm'; npm_config_prefix = 'tools/npm'; npm_config_userconfig = 'home/.npmrc'
    OPENCODE_CONFIG_DIR = 'config/opencode'; OPENCODE_DB = 'data/opencode/opencode-local.db'
}.GetEnumerator()) { $child[$pair.Key] = Join-Path $root $pair.Value }
$child['OPENCODE_CHANNEL'] = 'local'
$child['OPENCODE_VERSION'] = '0.0.0-local-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$child['OPENCODE_TUI_CHANNEL'] = 'local'
$child['OPENCODE_DISABLE_AUTOUPDATE'] = '1'
$child['OPENCODE_CONFIG_PROJECT_DISABLE'] = '1'
# Adjust this one path if Git for Windows is installed elsewhere.
$gitBash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $gitBash) { $child['OPENCODE_GIT_BASH_PATH'] = $gitBash }

$location = Get-Location
$code = 1
try {
    # Use the actual entries, including differently cased PATH entries. Do not
    # loop on Test-Path: Windows synthesizes some removed system variables.
    foreach ($name in @((Get-ChildItem Env:).Name)) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    foreach ($name in $child.Keys) { Set-Item -LiteralPath "Env:$name" -Value $child[$name] }
    if ($bin -and -not ($location.ProviderPath + '\').StartsWith(
        $root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Set-Location -LiteralPath (Join-Path $root 'workspaces/scratch')
    }
    $env:PWD = (Get-Location).ProviderPath
    & $executable @arguments
    $code = $LASTEXITCODE
} finally {
    Set-Location -LiteralPath $location.ProviderPath
    foreach ($name in @((Get-ChildItem Env:).Name)) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    foreach ($name in $saved.Keys) { Set-Item -LiteralPath "Env:$name" -Value $saved[$name] }
}
exit $code
