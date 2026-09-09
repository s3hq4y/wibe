# Wibe

**Wibe** is a personal, rebranded build of [Visual Studio Code — Open Source](https://github.com/microsoft/vscode)
(`Code - OSS` **1.136.1**). The editor itself stays upstream; two things are layered on top:

1. **An agent/chat bridge** to a local sidecar (internal name *uwa* / *InControl*), so the workbench chat can drive a
   browser-backed model runtime: per-session binding slots, history-conversation resume, goal compaction → summary →
   new conversation, and a manual *refresh available models* action.
   See [`docs/uwa-incontrol-bridge.md`](docs/uwa-incontrol-bridge.md) and [`docs/uwa-vs-vanilla-vscode.md`](docs/uwa-vs-vanilla-vscode.md).
2. **Its own identity**: the product is called **Wibe** and every product icon is a custom single-colour "arch" mark.

English · [简体中文](README.zh-CN.md)

---

## Rebrand — product name

Only the **display layer** of `product.json` is renamed, so an existing installation keeps its settings, extensions,
CLI and deep links:

| `product.json` key | before | after | shown in |
| --- | --- | --- | --- |
| `nameShort` | `Code - OSS` | `Wibe` | menus, About dialog, window title |
| `nameLong` | `Code - OSS` | `Wibe` | window title suffix |
| `win32NameVersion` | `Microsoft Code OSS` | `Wibe` | `Wibe.exe` file properties, taskbar tooltip |
| `win32DirName` | `Microsoft Code OSS` | `Wibe` | Start Menu folder |
| `win32ShellNameShort` | `C&ode - OSS` | `W&ibe` | Start Menu shortcut label |
| `win32RegValueName` | `CodeOSS` | `Wibe` | `HKCU\Software\Classes` shell entries |
| `win32AppUserModelId` | `Microsoft.CodeOSS` | `Wibe.Desktop` | taskbar group / notifications |
| `win32MutexName` | `vscodeoss` | `wibe` | single-instance mutex (also lets Wibe and a stock Code - OSS run side by side) |
| `reportIssueUrl` | microsoft/vscode | this repo `/issues/new` | Help → Report Issue |

**Deliberately unchanged** (renaming these would orphan your profile, extensions and command line):

`applicationName` (`code-oss`) · `dataFolderName` (`.vscode-oss`) · `sharedDataFolderName` · `urlProtocol` (`code-oss`)
· `serverApplicationName` / `serverDataFolderName` / `tunnelApplicationName` · `linuxIconName` · `darwinBundleIdentifier`
· `package.json` `name` (`code-oss-dev`, referenced by `build/`, `.vscode/launch.json` and the agent skills) ·
the MIT `license*` fields and `LICENSE.txt`.

## Rebrand — icon set

19 tracked assets carry one artwork: a flat, single-colour arch derived from the upstream silhouette, rendered natively
at every size (no resampling), with the theme semantics preserved (light = 10 % opacity, dark = 30 %, HC = flat
`#D9D9D9` / `#3C3C3C`, Sessions = flat grey):

| Asset | Used by |
| --- | --- |
| `src/vs/workbench/browser/media/code-icon.svg` | workbench product icon (dialogs, empty workbench) |
| `src/vs/workbench/browser/parts/editor/media/letterpress-{light,dark,hcLight,hcDark}.svg` | editor tab letterpress / ghost backdrop |
| `src/vs/sessions/browser/media/vscode-icon.svg` | Sessions splash and header |
| `src/vs/sessions/contrib/chat/browser/media/letterpress-sessions-{light,dark}.svg` | chat letterpress backdrop |
| `resources/win32/code.ico` | `Wibe.exe` resource icon, shortcuts |
| `resources/win32/code_70x70.png`, `code_150x150.png` | Start Menu / notification tiles |
| `resources/linux/code.png` | Linux window icon |
| `resources/darwin/code.icns` | macOS bundle icon (11 sizes, 16 → 1024 px) |
| `resources/server/code-192.png`, `code-512.png`, `favicon.ico` | `code-server` / tunnel web UI |
| `extensions/github-authentication/media/code-icon.svg`, `favicon.ico` | sign-in page favicon + icon |
| `extensions/microsoft-authentication/media/favicon.ico` | sign-in page favicon |

The master artwork is [`docs/reference_shape_vscode.svg`](docs/reference_shape_vscode.svg) (3105 B).

## Building

```bash
npm install                    # once
npm run build-fast             # fast dev build (node build/next/index.ts build-fast)
npm run build-fast-extensions  # codicons + extension media, when extensions change
npm run compile                # full client + copilot compile
```

A full product bundle is not required to see the rebrand: `resources/app/product.json` of an already-built tree can be
patched in place, and `rcedit` can swap the icon resource of an existing executable. The scripts used for that
(`.build/iconwork/`, git-ignored) stage the new `product.json`, the packaged `package.json`, the
`VisualElementsManifest.xml` and both `bin` launchers, then rename `Code - OSS.exe` → `Wibe.exe`.

## Layout of a patched build

```
vscode-1.136.1/            this repository (source of truth)
  product.json             display-layer rename lives here
  .build/iconwork/         staging + generator scripts, logs (git-ignored)
  .build/icon-backup-*/    pristine originals + the pre-rcedit exe (git-ignored)
../VSCode-win32-x64/       the runnable tree
  Wibe.exe                 renamed + re-icoed executable (file version "Wibe")
  Wibe.VisualElementsManifest.xml   ShortDisplayName="Wibe"
  bin/code-oss[.cmd]       CLI launcher, unchanged name, now starts Wibe.exe
  bin/wibe[.cmd]           the same launcher, Wibe-branded alias
  resources/app/product.json   patched copy (build provenance commit/version kept as-is)
```

## Reverting

* Source: `git checkout -- product.json README.md extensions resources src && git clean -f README.zh-CN.md`
* Packaged tree: restore from `.build\icon-backup-<stamp>-nameswap\` (product.json, package.json, manifest, `bin\*`)
  and rename `Wibe.exe` back; the pre-`rcedit` executable is kept as `Code - OSS.exe.pre-icon` in
  `.build\icon-backup-<stamp>-tree\`.
* Windows may still show a cached icon: the scripts call `SHChangeNotify(0x08000000, …)`; a pinned shortcut keeps the
  old bitmap until it is unpinned and pinned again.

## Upstream & license

Upstream: <https://github.com/microsoft/vscode> at `1.136.1`. Source code remains under the
[MIT license](LICENSE.txt) with the original copyright notice; the icon artwork is a derivative of the upstream
VS Code mark. Wibe is not affiliated with, sponsored or endorsed by Microsoft.
