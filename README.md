# MCP Shell Installation for Antigravity

Async terminal execution with polling support. Prevents agent freezes.

## Quick Install

```powershell
# 1. Copy the MCP shell script
$dest = "$env:USERPROFILE\.gemini\antigravity"
New-Item -Path $dest -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/your-org/mcp-shell-cmd/main/mcp-shell-cmd.js" -OutFile "$dest\mcp-shell-cmd.js"

# 2. Create MCP config (or merge with existing)
$config = @'
{
  "mcpServers": {
    "shell": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\.gemini\\antigravity\\mcp-shell-cmd.js"],
      "env": {}
    }
  }
}
'@ -replace 'YOUR_USERNAME', $env:USERNAME
$config | Out-File -FilePath "$dest\mcp_config.json" -Encoding utf8

# 3. Restart Antigravity
```

## Manual Install

1. Copy `mcp-shell-cmd.js` to `%USERPROFILE%\.gemini\antigravity\`

2. Create/update `%USERPROFILE%\.gemini\antigravity\mcp_config.json`:
```json
{
  "mcpServers": {
    "shell": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\.gemini\\antigravity\\mcp-shell-cmd.js"],
      "env": {}
    }
  }
}
```

3. Restart Antigravity IDE

## Available Tools

| Tool | Description |
|------|-------------|
| `start_command` | Start command async, returns job_id |
| `poll_command` | Get status, output, check `isStalled` |
| `kill_command` | Terminate running command |
| `list_jobs` | List all active/recent jobs |
| `run_command` | Sync execution (60s timeout) |

## Usage Pattern

```
1. start_command("npm run build") → job_id
2. poll_command(job_id) → status, output, isStalled
3. If isStalled → kill_command(job_id)
4. If done → use output
```

## Features

- **cmd.exe by default** (no PowerShell issues)
- **Stall detection** (30s no output = isStalled)
- **Command blacklist** (rm, del, format, shutdown blocked)
- **Auto-cleanup** (old jobs purged after 5 min)
