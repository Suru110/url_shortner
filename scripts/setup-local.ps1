# setup-local.ps1
# Sets up the complete local development environment (no AWS account needed)
# Run this once before starting local development

$PYTHON = "C:\Users\surab\AppData\Local\Programs\Python\Python310\python.exe"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  URL Shortener — Local Setup" -ForegroundColor Cyan
Write-Host "  (No AWS account required)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: npm install ──────────────────────────────────────────────────────
Write-Host "[1/4] Installing Node dependencies..." -ForegroundColor Yellow
Set-Location $PROJECT_ROOT
npm install --silent
Write-Host "      Done." -ForegroundColor Green

# ── Step 2: Start DynamoDB Local ─────────────────────────────────────────────
Write-Host "[2/4] Starting DynamoDB Local on port 8000..." -ForegroundColor Yellow
$running = docker ps --filter "name=url-shortener-dynamodb" --format "{{.Names}}" 2>&1
if ($running -like "*url-shortener-dynamodb*") {
    Write-Host "      Already running." -ForegroundColor Green
} else {
    docker run -d `
        --name url-shortener-dynamodb `
        -p 8000:8000 `
        amazon/dynamodb-local:latest `
        -jar DynamoDBLocal.jar -sharedDb -inMemory | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "      Started." -ForegroundColor Green
}

# ── Step 3: Create DynamoDB table ────────────────────────────────────────────
Write-Host "[3/4] Creating local DynamoDB table 'urls-local'..." -ForegroundColor Yellow
$tableCheck = & $PYTHON -m awscli dynamodb describe-table `
    --table-name urls-local `
    --endpoint-url http://localhost:8000 `
    --region us-east-1 `
    --output text 2>&1

if ($tableCheck -like "*urls-local*") {
    Write-Host "      Table already exists." -ForegroundColor Green
} else {
    & $PYTHON -m awscli dynamodb create-table `
        --table-name urls-local `
        --attribute-definitions AttributeName=shortCode,AttributeType=S `
        --key-schema AttributeName=shortCode,KeyType=HASH `
        --billing-mode PAY_PER_REQUEST `
        --endpoint-url http://localhost:8000 `
        --region us-east-1 | Out-Null
    Write-Host "      Table created." -ForegroundColor Green
}

# ── Step 4: Run tests ─────────────────────────────────────────────────────────
Write-Host "[4/4] Running tests..." -ForegroundColor Yellow
npm test --silent
if ($LASTEXITCODE -eq 0) {
    Write-Host "      All tests passed." -ForegroundColor Green
} else {
    Write-Host "      Some tests failed — check output above." -ForegroundColor Red
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: start the local API server:" -ForegroundColor White
Write-Host "  sam local start-api --env-vars env.local.json" -ForegroundColor Yellow
Write-Host ""
Write-Host "Then open the frontend:" -ForegroundColor White
Write-Host "  start frontend\index.html" -ForegroundColor Yellow
Write-Host ""
Write-Host "Test the API:" -ForegroundColor White
Write-Host '  curl -X POST http://localhost:3000/shorten -H "Content-Type: application/json" -d "{""url"":""https://example.com""}"' -ForegroundColor Yellow
Write-Host ""
