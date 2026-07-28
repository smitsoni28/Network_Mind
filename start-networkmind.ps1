$ErrorActionPreference = "Stop"

Write-Host "NetworkMind startup`n"

Write-Host "Checking Docker..."
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker is not running. Start Docker Desktop, wait until it is ready, then rerun this script."
  exit 1
}
Write-Host "Docker is running."

Write-Host "`nStarting Postgres..."
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nPostgres failed to start. Fix the Docker Compose error above. Dev server will not start."
  docker compose ps
  exit 1
}

Write-Host "`nWaiting for database readiness..."
npm run db:wait
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nDatabase did not become ready. Dev server will not start."
  docker compose ps
  exit 1
}

Write-Host "`nStarting NetworkMind dev server..."
Write-Host "Open: http://localhost:3000"
Write-Host "Press Ctrl+C here to stop the dev server.`n"

npm run dev
