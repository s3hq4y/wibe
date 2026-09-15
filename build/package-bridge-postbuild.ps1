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
  [string]$Src,
  [string]$Prod
)
$ErrorActionPreference = "Stop"

# 默认从脚本自身位置推导，避免把构建机的绝对路径写进源码。
# 约定：$Src 为源码仓库根，$Prod 为 gulp 产物目录（仓库的上一级）。
if (-not $Src)  { $Src  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
if (-not $Prod) { $Prod = Join-Path (Split-Path $Src -Parent) "VSCode-win32-x64" }
$extSrc  = Join-Path $Src  "extensions\incontrol"
$extProd = Join-Path $Prod "resources\app\extensions\incontrol"

Write-Host "[1/5] uwa-sidecar -> product"
$sideSrc = Join-Path $Src  "resources\uwa-sidecar"
$sideDst = Join-Path $Prod "resources\app\resources\uwa-sidecar"
robocopy $sideSrc $sideDst /E /R:2 /W:2 /NFL /NDL /NJH /NJS /XD __pycache__ .git chrome_profile venv .venv logs temp tmp scratch download_images node_modules tests /XF *.pyc *.pyo .env .env.* *.local* *.log *.bak *.tmp .agent_bridge.json marketplace_cache.json app_stats.json request_history.json commands.json | Out-Null
if ($LASTEXITCODE -ge 8) { throw "uwa-sidecar copy failed" }
if(-not (Test-Path (Join-Path $sideDst "start.py"))){ throw "uwa-sidecar copy failed" }
# venv/chrome_profile 是本机运行时产物，绝不该进发行包：
# venv 里的 pyvenv.cfg 记录的是构建机的 Python 路径，装到别的机器上引导器
# 会直接退码 103，而扩展又会因为它"存在"而优先选中它。宁可打包失败。
foreach ($leak in @("venv", "chrome_profile")) {
  if (Test-Path (Join-Path $sideDst $leak)) {
    throw "product contains $leak - runtime artifact must not be shipped"
  }
}
Write-Host ("      files: " + (Get-ChildItem $sideDst -Recurse -File).Count)

Write-Host "      bundled Python + locked dependencies -> product"
& node (Join-Path $Src "build\python\prepare-runtime.mjs")
if ($LASTEXITCODE -ne 0) { throw "Bundled Python preparation failed" }
$pythonSrc = Join-Path $Src "resources\python"
$pythonDst = Join-Path $Prod "resources\app\resources\python"
robocopy $pythonSrc $pythonDst /E /R:2 /W:2 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Bundled Python copy failed" }
& (Join-Path $pythonDst "python.exe") -I -B -X utf8 (Join-Path $sideDst "check_deps.py")
if ($LASTEXITCODE -ne 0) { throw "Packaged Python dependency verification failed" }
& (Join-Path $pythonDst "python.exe") -I -B -X utf8 (Join-Path $Src "build\python\verify-runtime.py") $Src
if ($LASTEXITCODE -ne 0) { throw "Packaged Python lock/native module verification failed" }

Write-Host "[2/5] external node_modules -> product"
$nmDst = Join-Path $extProd "node_modules"
New-Item -ItemType Directory -Force -Path $nmDst | Out-Null
$roots = @((Join-Path $extSrc "core\node_modules"), (Join-Path $extSrc "node_modules"))
$pkgs  = @("sqlite3","web-tree-sitter","tree-sitter-wasms","win-ca",
           "node-forge","fs-extra","jsonfile","graceful-fs","universalify")
foreach($pkg in $pkgs){
  $from = $null
  foreach($r in $roots){ $c = Join-Path $r $pkg; if(Test-Path $c){ $from = $c; break } }
  if(-not $from){ throw "Required extension runtime dependency missing: $pkg" }
  $to = Join-Path $nmDst $pkg
  robocopy $from $to /E /R:2 /W:2 /NFL /NDL /NJH /NJS /XD test tests docs /XF *.md *.map | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Runtime dependency copy failed: $pkg" }
}
# 棰勭紪璇戜簩杩涘埗涓嶈兘琚繃婊ゆ帀
# Use the root binary built against Electron, not the extension build-Node ABI.
$binSrc = Join-Path $Src "node_modules\@vscode\sqlite3\build\Release\vscode-sqlite3.node"
if (-not (Test-Path $binSrc)) { throw "Electron-targeted sqlite3 native binary missing" }
$binDst = Join-Path $nmDst  "sqlite3\build\Release\vscode-sqlite3.node"
New-Item -ItemType Directory -Force -Path (Split-Path $binDst) | Out-Null
Copy-Item $binSrc $binDst -Force
if(-not (Test-Path $binDst)){ throw "sqlite3 native binary missing" }

Write-Host "[3/5] incontrol dist -> product"
# VS Code 鎵撳寘浼氭妸 main 閲嶅啓涓?./dist/extension.js锛岄€傞厤灞備篃蹇呴』杈撳嚭 dist/
$distSrc = Join-Path $extSrc  "dist"
$distDst = Join-Path $extProd "dist"
if(Test-Path $distSrc){
  robocopy $distSrc $distDst /E /R:2 /W:2 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Extension dist copy failed" }
}
if(-not (Test-Path (Join-Path $distDst "extension.js"))){ throw "dist/extension.js missing in product" }

# package.json 也要同步，否则新增命令不会注册。但必须 rewrite main：
# 源码树写的是 ./out/extension.js，而 VS Code 打包约定产品内为 ./dist/extension.js，
# 直接整份拷贝会把 main 覆盖回 out/，导致扩展加载旧文件、新命令全部 not found。
$pkgSrc = Join-Path $extSrc  "package.json"
$pkgDst = Join-Path $extProd "package.json"
if (Test-Path $pkgSrc) {
  # 用 .NET 写入而非 Set-Content -Encoding utf8：后者会写出 UTF-8 BOM，
  # 而 Node 对 package.json 的 BOM 零容忍 —— 报 ERR_INVALID_PACKAGE_CONFIG，
  # 导致扩展本身及其 node_modules 依赖全部无法解析。
  $txt = [System.IO.File]::ReadAllText($pkgSrc)
  $txt = $txt -replace '"main"\s*:\s*"\./out/extension\.js"', '"main": "./dist/extension.js"'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($pkgDst, $txt, $utf8NoBom)
  $bytes = [System.IO.File]::ReadAllBytes($pkgDst)
  if ($bytes[0] -eq 239 -and $bytes[1] -eq 187) { throw "package.json written with BOM" }
  if ($txt -notmatch 'dist/extension\.js') { throw "main rewrite failed" }
  Write-Host "      package.json synced (main -> dist, no BOM)"
}

Write-Host "[4/5] node-pty native module -> product"
# node-pty 的 .node 不随 npm install 落地（prebuild 脚本对 electron ABI 无预编译产物），
# 必须用 node-gyp 按 .npmrc 里的 runtime=electron/target 手工编译一次：
#   cd node_modules\node-pty
#   npx node-gyp rebuild --runtime=electron --target=<ver> --dist-url=https://electronjs.org/headers --arch=x64
# 编译产物需同时放到 build/Release 与 prebuilds/win32-x64 —— utils.js 两处都会探。
# 缺失时报错：Failed to load native module: conpty.node，终端完全无法启动。
$ptySrc = Join-Path $Src "node_modules\node-pty"
$ptyDst = Join-Path $Prod "resources\app\node_modules.asar.unpacked\node-pty"
$ptyBin = Join-Path $ptySrc "build\Release"
if (Test-Path (Join-Path $ptyBin "conpty.node")) {
  foreach ($sub in @("build\Release", "prebuilds\win32-x64")) {
    $d = Join-Path $ptyDst $sub
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    foreach ($f in @("conpty.node", "conpty_console_list.node")) {
      Copy-Item (Join-Path $ptyBin $f) $d -Force
    }
    # ConPTY 运行时依赖：conpty.node 按 <native_dir>/conpty/conpty.dll 拼路径，
    # 且该 DLL 需要同目录的 OpenConsole.exe 才能真正启动伪终端。
    $tp = Join-Path $ptySrc "third_party\conpty\1.25.260303002\win10-x64"
    if (Test-Path $tp) {
      $cd = Join-Path $d "conpty"
      New-Item -ItemType Directory -Force -Path $cd | Out-Null
      Copy-Item (Join-Path $tp "conpty.dll") $cd -Force
      Copy-Item (Join-Path $tp "OpenConsole.exe") $cd -Force
    }
  }
  Write-Host "      conpty.node deployed"
  # 文件放到 .unpacked 还不够：Electron 只对 asar 头部登记过的条目做重定向。
  $reg = Join-Path $Src "build\register-asar-unpacked-entries.cjs"
  $asar = Join-Path $Prod "resources\app\node_modules.asar"
  if ((Test-Path $reg) -and (Test-Path $asar)) {
    $env:ASAR = $asar
    $env:PICKLE = Join-Path $Src "node_modules\chromium-pickle-js"
    node $reg
  }
} else {
  throw "conpty.node not built; refusing to package a broken terminal"
}

Write-Host "[5/5] native-keymap / native-is-elevated native modules -> product"
# 这两个模块决定键盘快捷键能否工作，其 .node 同样不随 npm install 落地时必须手工编译：
#   native-keymap 缺 keymapping.node → 主进程 readKeyboardLayoutData() 拿到空布局与空扫描码映射
#     → createKeyboardMapper() 在 Windows 分支（该分支没有兜底）直接构造
#       WindowsKeyboardMapper(undefined, undefined)，无法把默认键位的 KeyCode 映射成扫描码
#     → KeybindingService 里所有默认绑定被跳过
#     → 症状：按键能到达、能正确转换，但每条 chord 都解析成 "No keybinding entries."，快捷键全哑
#   更麻烦的是失败是**静默**的：native-keymap/index.js 把异常吞掉，getKeyMap() 返回 []、
#   getCurrentKeyboardLayout() 返回 null，只 console.error 到主进程 stderr，不进 main.log。
#   所以这里必须硬校验：缺了它宁可打包失败，也不要把一个"快捷键全哑"的包发出去。
#   native-is-elevated 缺 iselevated.node 只影响"以管理员身份重启"的判定（恒为 false），不阻断。
#
# 编译（与 .npmrc 的 runtime=electron/target 对齐；binding.gyp 与源码都在 npm tarball 里）：
#   cd node_modules\native-keymap
#   npx node-gyp rebuild --runtime=electron --target=<ver> --dist-url=https://electronjs.org/headers --arch=x64
$electronTarget = $null
$npmrcPath = Join-Path $Src ".npmrc"
if (Test-Path $npmrcPath) {
  $m = [regex]::Match([System.IO.File]::ReadAllText($npmrcPath), '(?m)^target="(?<v>[^"]+)"')
  if ($m.Success) { $electronTarget = $m.Groups['v'].Value }
}
$asarUnpacked = Join-Path $Prod "resources\app\node_modules.asar.unpacked"
$nativeMods = @(
  @{ Name = "native-keymap";      Rel = "build\Release\keymapping.node"; Critical = $true  },
  @{ Name = "native-is-elevated"; Rel = "build\Release\iselevated.node"; Critical = $false }
)
foreach ($mod in $nativeMods) {
  $srcBin = Join-Path $Src "node_modules\$($mod.Name)\$($mod.Rel)"
  if (-not (Test-Path $srcBin)) {
    $pkgDir = Join-Path $Src "node_modules\$($mod.Name)"
    if ((Test-Path (Join-Path $pkgDir "binding.gyp")) -and $electronTarget) {
      Write-Host "      $($mod.Name): binary missing, compiling with node-gyp (electron $electronTarget)"
      $gyp = Join-Path $Src "build\npm\gyp\node_modules\.bin\node-gyp.cmd"
      if (-not (Test-Path $gyp)) { $gyp = "node-gyp" }
      Push-Location $pkgDir
      try {
        & $gyp rebuild --runtime=electron --target=$electronTarget --dist-url=https://electronjs.org/headers --arch=x64 2>&1 |
          ForEach-Object { Write-Host "        $_" }
      } finally { Pop-Location }
    }
  }
  if (Test-Path $srcBin) {
    $dstBin = Join-Path $asarUnpacked "$($mod.Name)\$($mod.Rel)"
    New-Item -ItemType Directory -Force -Path (Split-Path $dstBin) | Out-Null
    Copy-Item $srcBin $dstBin -Force
    Write-Host "      $($mod.Name): $($mod.Rel) deployed"
  } elseif ($mod.Critical) {
    throw "$($mod.Name) native binary missing ($($mod.Rel)). Without it every keyboard shortcut resolves to 'No keybinding entries.'. Compile it first: cd node_modules\$($mod.Name) && npx node-gyp rebuild --runtime=electron --target=$electronTarget --dist-url=https://electronjs.org/headers --arch=x64"
  } else {
    Write-Host "      WARN: $($mod.Name) native binary missing; 'restart as administrator' will always report false"
  }
}
# 登记到 asar 头部（幂等）。正常构建由 gulpfile 的 createAsar（unpackGlobs 含 '**/*.node'）
# 完成；这里覆盖"打包时二进制还不存在、事后才补进来"的情况 —— 头部缺条目时 Electron 不做重定向。
$regNative = Join-Path $Src "build\register-asar-unpacked-entries.cjs"
$asar = Join-Path $Prod "resources\app\node_modules.asar"
if ((Test-Path $regNative) -and (Test-Path $asar)) {
  $env:ASAR = $asar
  $env:PICKLE = Join-Path $Src "node_modules\chromium-pickle-js"
  node $regNative
}
if (-not (Test-Path (Join-Path $asarUnpacked "native-keymap\build\Release\keymapping.node"))) {
  throw "native-keymap binary not present in product (resources\app\node_modules.asar.unpacked). Keyboard shortcuts will be dead."
}

Write-Host "verify:"
Push-Location $extProd
foreach($m in @("sqlite3","web-tree-sitter","win-ca")){
  $r = node -e "try{require.resolve('$m');console.log('OK')}catch(e){console.log('FAIL')}" 2>&1 | Select -First 1
  Write-Host ("      {0,-18} {1}" -f $m, $r)
}
Pop-Location
# Validate against the shipped Electron ABI, never against the build Node.
$productConfig = [IO.File]::ReadAllText((Join-Path $Src "product.json")) | ConvertFrom-Json
$electronExe = Join-Path $Prod ($productConfig.nameShort + ".exe")
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = "1"
  $checkScript = Join-Path $Src "build\verify-windows-native.cjs"
  $checkArgs = @(('"' + $checkScript + '"'), ('"' + $Prod + '"'))
  $validation = Start-Process -FilePath $electronExe -ArgumentList $checkArgs -WorkingDirectory $Src -NoNewWindow -Wait -PassThru
  if ($validation.ExitCode -ne 0) { throw "Packaged Electron native validation failed (exit $($validation.ExitCode))" }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
}
Write-Host "post-build done."


