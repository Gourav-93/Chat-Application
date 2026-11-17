param([switch]$RunLocalDatabaseChecks)
$ErrorActionPreference = 'Stop'
if (!$RunLocalDatabaseChecks) { throw 'Opt in with -RunLocalDatabaseChecks. Checks add labelled fixtures to localhost/ChatDb and retain them.' }
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskTemp = Join-Path ([IO.Path]::GetTempPath()) ('chat-otp-checks-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskTemp | Out-Null
$taskProject = [Security.SecurityElement]::Escape((Join-Path $taskRoot 'Two-Way-Com.csproj'))
$taskSource = [Security.SecurityElement]::Escape((Join-Path $PSScriptRoot 'OtpIntegrationChecks.cs.txt'))
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup>
  <ItemGroup><ProjectReference Include="$taskProject" /><Compile Include="$taskSource" /></ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $taskTemp 'Checks.csproj')
# Build outside the application tree without changing the web project's compile glob.
dotnet run --project (Join-Path $taskTemp 'Checks.csproj') -- $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'OTP checks failed. See sanitized output.' }
