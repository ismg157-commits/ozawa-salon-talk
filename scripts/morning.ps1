# 朝の生成は GitHub Actions に移しました（パソコンを切らなくて大丈夫です）。
# 手で動かしたいときだけ、このファイルを実行します。
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = "C:\Users\akari\Desktop\My-First-Project\salon-talk"
}
Set-Location $Root
$env:NODE_OPTIONS = "--use-system-ca"

Write-Host "generate..."
npm run generate
if ($LASTEXITCODE -ne 0) { throw "generate failed" }

Write-Host "deploy..."
npx --yes surge $Root --domain ozawa-salon-talk.surge.sh
if ($LASTEXITCODE -ne 0) { throw "surge failed" }

Write-Host "done https://ozawa-salon-talk.surge.sh/"
