/*
 * 向 node_modules.asar 头部补登「归档外文件」条目（幂等）。
 *
 * 为什么必须改 asar 头部：Electron 只对「归档头部登记过且标记 unpacked」的路径
 * 做磁盘重定向。哪怕 node_modules.asar.unpacked/ 下真的放着文件，头部没登记就
 * require 不到，而且报错位置往往离原因很远：
 *   - node-pty       → 终端报 Cannot find module './prebuilds/win32-x64/conpty.node'
 *   - native-keymap  → 连报错都没有：布局模块静默退化成空映射，键盘快捷键全部
 *                      解析成 "No keybinding entries."（详见 build/package-bridge-postbuild.ps1）
 *
 * 正常构建不需要跑这里：gulpfile 的 createAsar 会把 unpackGlobs（含 '**\/*.node'）
 * 命中的文件登记好并落到 .unpacked。只有「打包时二进制还不存在、事后才补进来」的
 * 情况头部才会缺条目 —— 也就是本脚本存在的原因。
 *
 * 不要用 asar pack 重打整个归档：原归档有 148 个 unpacked 条目，规则混杂
 * （.node/.wasm/.exe/整目录），通配符重打会打乱布局（实测 82MB -> 174MB）。
 * 也不要手写 pickle 编码 —— 长度字段与 4 字节对齐规则容易算错，会让整个
 * 数据区错位（症状：JS 文件读出来带前一条目的尾巴，报 Unexpected token）。
 * 这里复用 chromium-pickle-js，与 asar/lib/disk.js writeFilesystem 同源。
 *
 * 用法：
 *   ASAR=<path to node_modules.asar> PICKLE=<path to chromium-pickle-js> \
 *     node build/register-asar-unpacked-entries.cjs
 */
const fs = require('fs');
const path = require('path');
const pickle = require(process.env.PICKLE);

const asarPath = process.env.ASAR;
const unpackedDir = asarPath + '.unpacked';

/**
 * 需要在归档外登记的条目。
 * 每一项都对应 node_modules.asar.unpacked/<pkg>/<parts...> 下的真实文件；
 * 文件不存在时跳过（例如 node-pty 的 conpty.dll 只在特定版本里带）。
 */
const TARGETS = [
  {
    pkg: 'node-pty',
    files: [
      ['build', 'Release', 'conpty.node'],
      ['build', 'Release', 'conpty_console_list.node'],
      ['build', 'Release', 'conpty.dll'],
      ['prebuilds', 'win32-x64', 'conpty.node'],
      ['prebuilds', 'win32-x64', 'conpty_console_list.node'],
      ['prebuilds', 'win32-x64', 'conpty.dll'],
      // conpty.node 运行时按 <native_dir>/conpty/conpty.dll 拼路径，
      // 且该 DLL 依赖同目录的 OpenConsole.exe，两者必须一起登记。
      ['build', 'Release', 'conpty', 'conpty.dll'],
      ['build', 'Release', 'conpty', 'OpenConsole.exe'],
      ['prebuilds', 'win32-x64', 'conpty', 'conpty.dll'],
      ['prebuilds', 'win32-x64', 'conpty', 'OpenConsole.exe'],
    ],
  },
  {
    // 键盘布局与扫描码映射：缺了它所有默认键位静默失效（快捷键全哑）。
    pkg: 'native-keymap',
    files: [
      ['build', 'Release', 'keymapping.node'],
    ],
  },
  {
    // 仅影响「以管理员身份重启」的判定。
    pkg: 'native-is-elevated',
    files: [
      ['build', 'Release', 'iselevated.node'],
    ],
  },
];

const raw = fs.readFileSync(asarPath);
const headerSize = pickle.createFromBuffer(raw.slice(0, 8)).createIterator().readUInt32();
const headerStr = pickle.createFromBuffer(raw.slice(8, 8 + headerSize)).createIterator().readString();
const header = JSON.parse(headerStr);
const dataOffset = 8 + headerSize;

let added = 0;
const skipped = [];
for (const target of TARGETS) {
  const pkgNode = header.files && header.files[target.pkg];
  if (!pkgNode) {
    skipped.push(target.pkg + ' (not in asar)');
    continue;
  }
  for (const parts of target.files) {
    const disk = path.join(unpackedDir, target.pkg, ...parts);
    if (!fs.existsSync(disk)) { continue; }
    let node = pkgNode;
    for (const d of parts.slice(0, -1)) {
      if (!node.files[d]) { node.files[d] = { files: {} }; }
      node = node.files[d];
    }
    const leaf = parts[parts.length - 1];
    if (node.files[leaf]) { continue; }          // 幂等
    node.files[leaf] = { size: fs.statSync(disk).size, unpacked: true };
    added++;
  }
}

if (added === 0) {
  console.log('      asar entries already present' + (skipped.length ? ' (skipped: ' + skipped.join(', ') + ')' : ''));
  process.exit(0);
}

const hp = pickle.createEmpty();
hp.writeString(JSON.stringify(header));
const nh = hp.toBuffer();
const sp = pickle.createEmpty();
sp.writeUInt32(nh.length);

fs.writeFileSync(asarPath + '.new', Buffer.concat([sp.toBuffer(), nh, raw.slice(dataOffset)]));
fs.renameSync(asarPath + '.new', asarPath);
console.log('      asar entries added: ' + added);
