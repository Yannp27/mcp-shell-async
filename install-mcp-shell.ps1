<#
.SYNOPSIS
    Installs MCP Shell for Antigravity
.DESCRIPTION
    Sets up async terminal execution with polling support.
    Prevents agent freezes on long-running commands.
.EXAMPLE
    .\install-mcp-shell.ps1
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir = "$env:USERPROFILE\.gemini\antigravity"
$mcpShellFile = Join-Path $scriptDir "mcp-shell-cmd.js"

Write-Host "Installing MCP Shell for Antigravity..." -ForegroundColor Cyan

# 1. Ensure destination directory exists
if (-not (Test-Path $destDir)) {
    New-Item -Path $destDir -ItemType Directory -Force | Out-Null
    Write-Host "  Created: $destDir" -ForegroundColor Green
}

# 2. Copy MCP shell script
if (Test-Path $mcpShellFile) {
    Copy-Item $mcpShellFile -Destination "$destDir\mcp-shell-cmd.js" -Force
    Write-Host "  Copied: mcp-shell-cmd.js" -ForegroundColor Green
} else {
    Write-Host "  ERROR: mcp-shell-cmd.js not found in script directory" -ForegroundColor Red
    exit 1
}

# 3. Create/update MCP config
$configPath = "$env:USERPROFILE\.gemini\mcp_config.json"
$escapedPath = "$destDir\mcp-shell-cmd.js" -replace '\\', '\\\\'

$config = @"
{
  "mcpServers": {
    "shell": {
      "command": "node",
      "args": ["$escapedPath"],
      "env": {}
    }
  }
}
"@

# Check if config exists and has other servers
if (Test-Path $configPath) {
    try {
        $existing = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($existing.mcpServers -and $existing.mcpServers.PSObject.Properties.Count -gt 0) {
            # Merge: add shell server to existing
            $existing.mcpServers | Add-Member -NotePropertyName "shell" -NotePropertyValue @{
                command = "node"
                args = @("$destDir\mcp-shell-cmd.js")
                env = @{}
            } -Force
            $existing | ConvertTo-Json -Depth 10 | Out-File $configPath -Encoding utf8
            Write-Host "  Merged shell server into existing mcp_config.json" -ForegroundColor Green
        } else {
            # Empty or invalid, overwrite
            $config | Out-File $configPath -Encoding utf8
            Write-Host "  Created: mcp_config.json" -ForegroundColor Green
        }
    } catch {
        # Parse error, overwrite
        $config | Out-File $configPath -Encoding utf8
        Write-Host "  Created: mcp_config.json (replaced invalid)" -ForegroundColor Yellow
    }
} else {
    $config | Out-File $configPath -Encoding utf8
    Write-Host "  Created: mcp_config.json" -ForegroundColor Green
}

# 4. Test the server
Write-Host "`nTesting MCP shell server..." -ForegroundColor Cyan
try {
    $testResult = node "$destDir\mcp-shell-cmd.js" --version 2>&1
    Write-Host "  Server test: OK" -ForegroundColor Green
} catch {
    Write-Host "  Server test: FAILED (Node.js may not be installed)" -ForegroundColor Yellow
}

Write-Host "`n✅ Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart Antigravity IDE"
Write-Host "  2. Check agent panel → Manage MCP Servers → verify 'shell' appears"
Write-Host ""
Write-Host "MCP Shell Tools:" -ForegroundColor Cyan
Write-Host "  start_command  - Start command async, returns job_id"
Write-Host "  poll_command   - Get status, output, isStalled flag"
Write-Host "  kill_command   - Terminate running command"
Write-Host "  list_jobs      - List all active jobs"
Write-Host "  run_command    - Sync execution (60s timeout)"
