<#
  鏋勫缓鍚庣疆姝ラ 鈥斺€?蹇呴』鍦?`npm run gulp vscode-win32-x64` 涔嬪悗鎵ц銆?
  gulp 鐨勪骇鍝佹墦鍖呮湁涓や釜鐩插尯锛岄兘浼氳 incontrol 鍦ㄦ垚鍝侀噷闈欓粯澶辨晥锛?
  1) resources/ 鐨勬嫹璐濇槸涓€浠藉啓姝荤殑 .ico 鐧藉悕鍗曪紙build/gulpfile.vscode.ts锛夛紝
     resources/uwa-sidecar 涓嶅湪鍏朵腑锛屾暣涓?Python sidecar 涓嶄細杩涗骇鍝併€?
  2) 鍐呯疆鎵╁睍榛樿涓嶆惡甯?node_modules銆俰ncontrol 鐨?esbuild 鎶?sqlite3 /
     web-tree-sitter / win-ca 鏍囦负 external锛堝師鐢?.node 鍜屽姩鎬?require 鏃犳硶
     鎵撳寘锛夛紝鍥犳瀹冧滑蹇呴』浠ョ湡瀹炴枃浠跺瓨鍦ㄤ簬鎵╁睍鐨?node_modules 閲岋紝鍚﹀垯
     activate() 鎶?MODULE_NOT_FOUND锛屼晶杈规爮姘歌繙杞湀銆?#>
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
# 棰勭紪璇戜簩杩涘埗涓嶈兘琚繃婊ゆ帀
$binSrc = Join-Path $extSrc "core\node_modules\sqlite3\build\Release\vscode-sqlite3.node"
$binDst = Join-Path $nmDst  "sqlite3\build\Release\vscode-sqlite3.node"
New-Item -ItemType Directory -Force -Path (Split-Path $binDst) | Out-Null
Copy-Item $binSrc $binDst -Force
if(-not (Test-Path $binDst)){ throw "sqlite3 native binary missing" }

Write-Host "[3/3] incontrol dist -> product"
# VS Code 鎵撳寘浼氭妸 main 閲嶅啓涓?./dist/extension.js锛岄€傞厤灞備篃蹇呴』杈撳嚭 dist/
$distSrc = Join-Path $extSrc  "dist"
$distDst = Join-Path $extProd "dist"
if(Test-Path $distSrc){
  robocopy $distSrc $distDst /E /NFL /NDL /NJH /NJS | Out-Null
}
if(-not (Test-Path (Join-Path $distDst "extension.js"))){ throw "dist/extension.js missing in product" }

Write-Host "verify:"
Push-Location $extProd
foreach($m in @("sqlite3","web-tree-sitter","win-ca")){
  $r = node -e "try{require.resolve('$m');console.log('OK')}catch(e){console.log('FAIL')}" 2>&1 | Select -First 1
  Write-Host ("      {0,-18} {1}" -f $m, $r)
}
Pop-Location
Write-Host "post-build done."

