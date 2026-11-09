# Cấu hình: read-only readiness checks. Social Autopilot needs Node.js (its scripts and this server) and Codex CLI
# signed in (it makes the brand's scene images). Facebook research runs in scripts/crawl-fb.mjs (playwright-core, npm install) against Chrome, not here.
param([switch]$AsJson)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$node = Get-Command node -ErrorAction SilentlyContinue
$engine = Get-Command codex -ErrorAction SilentlyContinue
$loggedIn = $false
if ($engine) {
    try {
        $status = & {
            # The CLI writes its status to stderr on Windows PowerShell 5.1.
            $ErrorActionPreference = 'Continue'
            $text = & codex login status 2>&1 | Out-String
            [pscustomobject]@{ ExitCode = $LASTEXITCODE; Text = $text.Trim() }
        }
        $loggedIn = $status.ExitCode -eq 0 -and $status.Text -match '(?i)logged in'
    } catch { $loggedIn = $false }
}
$steps = @(
    [pscustomobject]@{ Id = 'login'; Title = 'Codex (ChatGPT)'; State = $(if (-not $engine) { 'wait' } elseif ($loggedIn) { 'ok' } else { 'fail' }); Uses = 'Tạo ảnh cảnh của thương hiệu'
        Detail = $(if (-not $engine) { 'Cài Codex trước.' } elseif ($loggedIn) { 'Đã đăng nhập.' } else { 'Chưa đăng nhập hoặc phiên đã hết hạn.' })
        Action = $(if ($engine) { 'login' } else { '' }) }
    [pscustomobject]@{ Id = 'node'; Title = 'Node.js'; State = $(if ($node) { 'ok' } else { 'fail' }); Detail = $(if ($node) { 'Đã cài.' } else { 'Chưa cài.' }); Action = $(if ($node) { '' } else { 'install' }) }
    [pscustomobject]@{ Id = 'codex'; Title = 'Codex CLI'; State = $(if ($engine) { 'ok' } else { 'fail' }); Detail = $(if ($engine) { 'Đã cài.' } else { 'Chưa cài.' }); Action = $(if ($engine) { '' } else { 'install' }) }
)
$ready = [bool]$node -and [bool]$engine -and $loggedIn
$report = [pscustomobject]@{ Ready = $ready; Steps = $steps; Summary = $(if ($ready) { 'Sẵn sàng.' } else { 'Vui lòng xử lý các mục trên trước khi bắt đầu.' }) }
if ($AsJson) { $report | ConvertTo-Json -Depth 5 }
else { foreach ($step in $steps) { Write-Output "$($step.Title): $($step.Detail)" } }
if (-not $ready) { exit 1 }
