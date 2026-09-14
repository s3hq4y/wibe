# Wibe 内置 Python（Windows x64）

## 解决的问题与范围

Windows x64 发行包携带独立的 CPython 3.13.12 embeddable runtime 和 uwa-sidecar 的全部锁定依赖。最终用户无需安装 Python、pip 或配置 PATH，首次启动不创建 venv，也不联网安装 Python 包。

这解决的是**安装 Wibe 后 sidecar 的 Python 环境/依赖错误**。从源码构建 Electron/native Node 模块仍需要项目原有的 Node、编译工具链等前置条件；这不是通用的开发机 Python 安装器。Windows ARM64、macOS、Linux 暂未内置运行时，保留原系统解释器探测逻辑。

## 布局

```text
resources/app/resources/
├── python/
│   ├── python.exe
│   ├── python313.dll
│   ├── python313.zip
│   ├── python313._pth
│   ├── LICENSE.txt
│   ├── wibe-runtime.json
│   └── Lib/site-packages/       # 包括 wheel 自带的 dist-info 和许可证
└── uwa-sidecar/
    ├── main.py
    ├── requirements.txt
    └── check_deps.py
```

路径均由扩展安装位置相对推导，不记录构建机 Python 安装目录。运行时不放入 ASAR，不复制构建机的 venv。`python313._pth` 只声明标准库、运行时目录、site-packages 和相邻 sidecar 目录，启用 `import site` 以加载 pywin32 的 `.pth`/DLL 引导。pip 生成的带暂存目录绝对路径的 `Scripts/*.exe` 不进入发行包；模块始终通过内置 `python -m` 执行。

## 构建与验证

在 Windows x64 仓库根目录执行（需要项目约定的 Node 版本及 Windows PowerShell）：

```powershell
node build/python/prepare-runtime.mjs
node build/python/smoke-runtime.mjs
npm run gulp vscode-win32-x64
```

正常的 `vscode-win32-x64`、`vscode-win32-x64-min` 及对应 `-ci` 打包任务已在复制资源前自动准备/校验 Python，同时包含 sidecar 源码。随后沿用项目原有安装包生成流程；仅运行准备脚本不会生成 Wibe 安装程序。

原有 `build/package-bridge-postbuild.ps1` 补包入口也会准备、复制和校验 Python。其默认产品目录为源码仓库的同级 `VSCode-win32-x64`；自定义目录请传 `-Src` 和 `-Prod`。

准备脚本：

1. 从 `build/python/runtime.json` 读取固定 Python/pip URL 与 SHA256。
2. 从 `dependencies-win32-x64.lock.json` 读取所有直接/间接依赖的精确版本、Windows wheel URL 与 SHA256。
3. 将下载缓存在 `.build/wibe-python/downloads`；每次使用缓存前验证完整 SHA256。大文件支持有界并行分段下载，拼接后仍校验完整文件哈希。
4. 用**内置解释器本身**安装已校验的 wheel：`--no-index --require-hashes --only-binary=:all:`，不运行 sdist 编译，不调用全局 pip。
5. 运行 `pip check`、版本范围/锁定版本检查、sidecar 依赖导入以及 Windows 原生模块导入检查。
6. 在唯一临时目录内完成验证后才发布 `resources/python`。已有运行时仅在带有 Wibe 管理标记时允许替换；缓存运行时损坏时会从校验后的制品重新构建，失败不发布半成品。

完整缓存存在时，准备与安装依赖可离线完成。发布安装包本身必须携带生成的整个 `resources/python`，不能只携带准备脚本。

`smoke-runtime.mjs` 将运行时复制到包含中文和空格的新目录，以空 PATH、错误 PYTHONHOME/PYTHONPATH/PYTHONUSERBASE 和 ASCII 编码设置运行；验证锁定依赖、DLL、FastAPI/Pydantic 请求处理，再人为移走临时副本中的 pywin32 原生模块，确认依赖检查拒绝坏环境。所有临时副本均在结束后删除，不启动浏览器或真实 sidecar 服务。

## 解释器选择

1. 用户显式设置且通过检测的 `incontrol.sidecar.pythonPath`。
2. 随 Wibe 安装的独立 Python。
3. **仅内置目录不存在时**：系统 PATH/PYTHON、Windows py 启动器、常见安装目录，最后是开发态本地 venv。

内置目录存在但损坏时直接报错并提示重装，不偷偷切换到 Conda、Microsoft Store 占位符或其他不相关的 Python。

内置解释器的版本检测、依赖检测与实际启动共用 `-I -B -X utf8 -u` 参数；同时清除子进程继承的 PYTHON* 环境变量。不修改用户的系统环境变量、注册表、全局 Python 或全局 pip 包。

## 更新 Python / 依赖

- `resources/uwa-sidecar/requirements.txt` 仍是业务依赖范围的事实来源。
- 锁文件记录规范化换行后的 requirements SHA256；不一致会阻止打包，不能静默继续使用旧依赖。
- 更新 Python 时同步审核 `runtime.json` 的版本、官方 URL 和完整 SHA256。
- 更新依赖时先将旧锁文件移到审核用备份，再运行：

```powershell
node build/python/prepare-runtime.mjs --update-lock
node build/python/prepare-runtime.mjs
node build/python/smoke-runtime.mjs
```

`--update-lock` 是维护者明确执行的联网解析操作，仅创建锁文件，不覆盖已有锁、不直接发布运行时。审核所有包/版本/哈希变化后提交新锁；切勿在最终用户启动时运行。

## 回归测试

项目依赖已安装后，使用项目的 esbuild 将轻量 Node 测试打包：

```powershell
node extensions/incontrol/node_modules/esbuild/bin/esbuild extensions/incontrol/bridge/sidecarManager.test.mjs --bundle --platform=node --format=cjs --outfile=.build/wibe-python/sidecar-tests.cjs
node --test .build/wibe-python/sidecar-tests.cjs
```

覆盖内置优先级、显式覆盖、损坏环境拒绝、开发模式回退、环境变量隔离和缺少依赖检查脚本等情况。

## 故障排查

- **下载超时**：确认构建机能访问 `www.python.org`、`pypi.org`、`files.pythonhosted.org`，恢复网络后重新运行；已完整校验的缓存会复用。不要关闭 TLS/哈希验证。
- **SHA256 不匹配**：不要绕过检测。排查损坏缓存、代理返回的 HTML 或上游制品变更。
- **prepare.lock 已存在**：检查其中记录的 PID 是否仍在构建。仅在确认对应构建已经终止后删除 `.build/wibe-python/prepare.lock` 和该次构建留下的 `resources/.python-stage-*`；不要干扰另一个正在运行的构建。
- **内置运行时损坏/依赖不完整**：最终用户重装完整的新安装包；维护者重新准备并执行冒烟测试后再发布。不要通过全局 `pip install` 掩盖漏包。
- **Python 检查通过但 sidecar 仍启动失败**：继续检查浏览器、端口、配置与目录写权限。内置 Python 不等于整个应用在干净虚拟机上已验收；发布前仍需实际安装并测试完整启动流程。
