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

## 更新安装包基线的 Python / 依赖（维护者）

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


## Universal API 在线更新与依赖隔离（2026-09-16）

### 本次故障

2.9.9 新增 `regex>=2024.5.15,<2027.0.0`，早期安装包没有 regex；原更新器只覆盖 sidecar 源码，不更新相邻的 Python。ZIP 下载/SHA256 校验成功后重启，才被依赖检查拒绝。

安装包基线的 requirements 与 Windows 锁文件现已加入 regex==2026.9.10，其余已锁定依赖不变。官方 CPython 3.13 x64 wheel SHA256：`20e8bfb07ad79a282f8b95b56fe67f9750b1b7f775724e4ba1f23cb296115ce4`。原生导入已纳入构建验证。

### 自动同步未来依赖

**普通启动不联网安装；用户点击 UWA 更新/切换版本时，允许在独立候选环境中从官方 PyPI 获取依赖。** 这替代了第一阶段“缺依赖就阻止更新”的临时保护，不再为每个新包维护手写白名单。

组件位于 `resources/uwa-runtime/{manager,dependencies}.py`，在上游会覆盖的 `uwa-sidecar` 目录之外。Wibe 扩展直接启动该管理器，再由它加载 main.py，并重新接入 Wibe 插件 boot。上游替换 main.py/updater.py 不会直接覆盖管理器。正常应用打包和 postbuild 复制入口均包含此目录。

更新步骤：

1. 用进程/线程互斥锁保护更新和恢复；获取用户指定的 Release asset，保留原下载 SHA256 校验并再次核对完整 ZIP 哈希。
2. 在独立暂存目录解压，拒绝越界路径、链接、重复/大小写冲突路径、异常大小/压缩比；检查目标 Python 源码语法与完整依赖清单。
3. 当前环境满足目标版本、extras、传递依赖、导入和 `pip check` 时直接复用。否则从随 Wibe 携带的可信解释器复制一个只带 bootstrap pip 的干净环境；不原地改当前 Python、不调用系统 Python/pip。
4. 解析 PEP 508 依赖和平台条件，先尝试保留旧版本偏好；约束不满足时重新按目标清单解析。仅使用官方 PyPI 的 wheel，不执行 sdist 编译，不接受直接 URL、递归 -r、pip 索引指令或替换 bootstrap pip。解析结果记录精确版本、URL、SHA256，并校验下载文件；安装使用 `--no-index --require-hashes --no-deps --only-binary=:all:`。
5. 在候选 Python 中检查所有目标依赖/版本/extras、原生导入和 `pip check`。目标自带 check_deps.py 在候选解释器中执行，但不启动 UWA/Chrome。隔离环境不是安全沙盒，仍需信任所选择的 UWA 发行来源及 PyPI 包。
6. 准备受影响文件的前后哈希和恢复副本，持久写入 `applying` 日志后逐文件原子替换。代码、VERSION 与候选 Python 通过同一事务关联，写入成功进入 `pending`，不能单独保留旧代码或旧 requirements 来拼接新环境。
7. 重启时选择候选环境，标记 `starting`。依赖探测或服务健康检查失败，先停止候选进程，再恢复上一组代码和 Python、重试一次。确认健康后才转为 `stable`。若进程中断在 applying/starting，下一次启动先执行恢复。

### 状态与数据保留

状态存放在扩展 `globalStorageUri/uwa-runtime/<安装路径哈希>/`，每个安装位置隔离：

```text
state.json                         # phase、activePython、事务标识
update.lock                        # OS 文件锁；进程退出自动释放，不靠删除锁文件解锁
wheel-cache/                       # 每次使用重新校验哈希
transactions/<id>/
  python/                          # 若需新环境才创建
  dependency-lock.json             # 解析出的精确制品
  requirements.lock
  plan.json                        # 每个受影响文件的前/后哈希
  before/                          # 恢复副本
  after/                           # 准备好的目标文件
  source/                          # 校验后的发行源码
  failure.json                     # 失败原因（失败时）
```

代码仍位于安装的 sidecar 目录，因此需要该目录可写；不会自动提权。环境和恢复副本不进入安装包，也不会改系统环境变量。当前实现保留事务目录/缓存用于排障，尚无自动空间回收；不得在更新/恢复时手工删除。需要清理时先退出 Wibe，并保留 state.json 引用的 activePython 和未完成事务。

始终保留 .env、Chrome 登录目录、日志、图片输出、临时运行数据以及 Wibe 插件。现有普通 config 文件保留；sites/commands 沿用上游合并逻辑。恢复时配置若在更新后再次被用户修改，则保留该修改；非配置代码发生外部修改时停止自动恢复并保留日志，不静默覆盖他人的代码。全量 Wibe 安装的基线变化会使旧 UWA 事务失效，避免旧恢复副本覆盖新安装包。

### 适用范围与限制

- 适用于 Windows x64 内置/受管 Python 模式；显式配置并成功使用外部 Python 时保留原流程，不自动维护那个环境。
- 没有兼容 wheel、依赖冲突、网络/磁盘/权限问题、未知清单语法或更高 Python 要求时，会失败并保留旧版。需要升级 Python 主/次版本或增加系统组件时仍需新版 Wibe，不擅自安装编译工具链。
- 能处理“未来新增多个依赖、依赖升降级/传递依赖变化”，不保证任意未来 UWA API、浏览器协议或数据迁移均兼容。代码目录不是单次整体 rename，而是带持久恢复日志的逐文件发布。
- 更新会重启 sidecar，请在没有进行中对话/任务时更新。健康检查只确认启动服务可用，不等同全功能验收，不能自动逆转任意上游数据迁移。
- 新增依赖运行时会联网下载，因此不再要求用户为每个新包重装 Wibe；首次部署这套更新管理器仍需重新构建并安装 Wibe。仅给旧安装补 regex 不会更新旧版已编译扩展。

### 验证命令

```powershell
# 离线事务/策略回归
resources/python/python.exe -I -B -X utf8 -m unittest discover -s resources/uwa-runtime/tests -p test_manager.py -v
# 启动器回归
node extensions/incontrol/node_modules/esbuild/bin/esbuild extensions/incontrol/bridge/sidecarManager.test.mjs --bundle --platform=node --format=cjs --outfile=.build/wibe-python/sidecar-tests.cjs
node --test .build/wibe-python/sidecar-tests.cjs
# 迁移/原生依赖冒烟（无真实服务）
node build/python/smoke-runtime.mjs
# 显式联网冒烟：仅在临时目录安装多个新增包，结束自动删除
resources/python/python.exe -I -B -X utf8 -u resources/uwa-runtime/tests/smoke_dependencies.py --online
```

本轮真实联网冒烟使用 humanize==4.13.0、boltons==25.0.0 两个新增包以及 regex 原生扩展，验证中文/空格路径、解析/哈希安装、候选环境验证、事务切换/回滚/确认与基线 Python 未被修改。不启动真实 UWA 或浏览器。发布前仍需新安装包的实际 UI/更新验收。
