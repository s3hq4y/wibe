<#
  构建后置步骤 —— 必须在 `npm run gulp vscode-win32-x64` 之后执行。

  gulp 的产品打包有两个盲区，都会让 incontrol 在成品里静默失效：

  1) resources/ 的拷贝是一份写死的 .ico 白名单（build/gulpfile.vscode.ts），
     resources/uwa-sidecar 不在其中，整个 Python sidecar 不会进产品。

  2) 内置扩展默认不携带 node_modules。incontrol 的 esbuild 把 sqlite3 /
     web-tree-sitter / win-ca 标为 external（原生 .node 和动态 require 无法
     打包），因此它们必须以真实文件存在于扩展的 node_modules 里，否则
     activate() 抛 MODULE_NOT_FOUND，侧边栏永远转圈。
#>
param(
  [string]$Src  = "E:\Tools\IDE-Workspace\bridges\code-oss\vscode-1.136.1",
  [string]$Prod = "E:\Tools\IDE-Workspace\bridges\code-oss\VSCode-win32-x64"
)
$ErrorActionPreference = "Stop"
$extSrc  = Join-Path $Src  "extensions\incontrol"
$extProd = Join-Path $Prod "resources\app\extensions\incontrol"

Write-Host "[1/2] uwa-sidecar -> product"
$sideSrc = Join-Path $Src  "resources\uwa-sidecar"
$sideDst = Join-Path $Prod "resources\app\resources\uwa-sidecar"
robocopy $sideSrc $sideDst /E /NFL /NDL /NJH /NJS /XD __pycache__ .git chrome_profile /XF *.pyc | Out-Null
if(-not (Test-Path (Join-Path $sideDst "start.py"))){ throw "uwa-sidecar copy failed" }
Write-Host ("      files: " + (Get-ChildItem $sideDst -Recurse -File).Count)

Write-Host "[2/2] external node_modules -> product"
$nmDst = Join-Path $extProd "node_modules"
New-Item -ItemType Directory -Force -Path $nmDst | Out-Null
$roots = @((Join-Path $extSrc "core\node_modules"), (Join-Path $extSrc "node_modules"))
$pkgs  = @("sqlite3","web-tree-sitter","tree-sitter-wasms","win-ca",
           "node-forge","fs-extra","jsonfile","graceful-fs","universalify")
foreach($pkg in $pkgs){
  $from = $null
  foreach($r in $roots){ $c = Join-Path $r $pkg; if(Test-Path $c){ $from = $c; break } }
  if(-not $from){ Write-Host "      MISSING $pkg"; continue }
  $to = Join-Path $nmDst $pkg
  robocopy $from $to /E /NFL /NDL /NJH /NJS /XD test tests docs /XF *.md *.map | Out-Null
}
# 预编译二进制不能被过滤掉
$binSrc = Join-Path $extSrc "core\node_modules\sqlite3\build\Release\vscode-sqlite3.node"
$binDst = Join-Path $nmDst  "sqlite3\build\Release\vscode-sqlite3.node"
New-Item -ItemType Directory -Force -Path (Split-Path $binDst) | Out-Null
Copy-Item $binSrc $binDst -Force
if(-not (Test-Path $binDst)){ throw "sqlite3 native binary missing" }

Write-Host "verify:"
Push-Location $extProd
foreach($m in @("sqlite3","web-tree-sitter","win-ca")){
  $r = node -e "try{require.resolve('$m');console.log('OK')}catch(e){console.log('FAIL')}" 2>&1 | Select -First 1
  Write-Host ("      {0,-18} {1}" -f $m, $r)
}
Pop-Location
Write-Host "post-build done."
