# IMMORTAIL™ — Ollama installer for Windows (PowerShell)
# Run: irm https://your-domain/install-ollama.ps1 | iex
# Or: powershell -ExecutionPolicy Bypass -File install-ollama.ps1

param([string]$Model = "llama3")

Write-Host "`nIMMORTAIL(tm) - Local AI Setup" -ForegroundColor Yellow
Write-Host ""

# Check if Ollama installed
$ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaPath) {
    Write-Host "  OK Ollama already installed" -ForegroundColor Green
} else {
    Write-Host "  Downloading Ollama for Windows..." -ForegroundColor Cyan
    $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installer    = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri $installerUrl -OutFile $installer
    Start-Process -FilePath $installer -Wait
    Write-Host "  OK Ollama installed" -ForegroundColor Green
}

# Start server
Write-Host "`n  Starting Ollama server..." -ForegroundColor Cyan
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Host "  OK Ollama server running at http://localhost:11434" -ForegroundColor Green

# Pull model
Write-Host "`n  Pulling model: $Model ..." -ForegroundColor Cyan
& ollama pull $Model
Write-Host "  OK $Model ready" -ForegroundColor Green

Write-Host "`nDone! Open IMMORTAIL and the Ollama tab will auto-connect.`n" -ForegroundColor Yellow
