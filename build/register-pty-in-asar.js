/*
 * 向 node_modules.asar 头部补登 node-pty 原生模块条目（幂等）。
 *
 * 为什么必须改 asar 头部：Electron 只对「归档头部登记过且标记 unpacked」
 * 的路径做磁盘重定向。VS Code 打包时没把 node-pty 的 .node 登记进去，
 * 因此无论 node_modules.asar.unpacked/ 下放什么文件，require 都看不到，
 * 终端启动即报 Cannot find module './prebuilds/win32-x64/conpty.node'。
 *
 * 不要用 asar pack 重打整个归档：原归档有 148 个 unpacked 条目，规则混杂
 * （.node/.wasm/.exe/整目录），通配符重打会打乱布局（实测 82MB -> 174MB）。
 * 也不要手写 pickle 编码 —— 长度字段与 4 字节对齐规则容易算错，会让整个
 * 数据区错位（症状：JS 文件读出来带前一条目的尾巴，报 Unexpected token）。
 * 这里复用 chromium-pickle-js，与 asar/lib/disk.js writeFilesystem 同源。
 */
const fs = require('fs');
const path = require('path');
const pickle = require(process.env.PICKLE);

const asarPath = process.env.ASAR;
const unpackedDir = asarPath + '.unpacked';
const raw = fs.readFileSync(asarPath);

const headerSize = pickle.createFromBuffer(raw.slice(0, 8)).createIterator().readUInt32();
const headerStr = pickle.createFromBuffer(raw.slice(8, 8 + headerSize)).createIterator().readString();
const header = JSON.parse(headerStr);
const dataOffset = 8 + headerSize;

const pty = header.files && header.files['node-pty'];
if (!pty) { console.log('  node-pty not in asar; skip'); process.exit(0); }

const targets = [
  ['build', 'Release', 'conpty.node'],
  ['build', 'Release', 'conpty_console_list.node'],
  ['build', 'Release', 'conpty.dll'],
  ['prebuilds', 'win32-x64', 'conpty.node'],
  ['prebuilds', 'win32-x64', 'conpty_console_list.node'],
  ['prebuilds', 'win32-x64', 'conpty.dll'],
];

let added = 0;
for (const parts of targets) {
  const disk = path.join(unpackedDir, 'node-pty', ...parts);
  if (!fs.existsSync(disk)) continue;
  let node = pty;
  for (const d of parts.slice(0, -1)) {
    if (!node.files[d]) node.files[d] = { files: {} };
    node = node.files[d];
  }
  const leaf = parts[parts.length - 1];
  if (node.files[leaf]) continue;          // 幂等
  node.files[leaf] = { size: fs.statSync(disk).size, unpacked: true };
  added++;
}
if (added === 0) { console.log('      asar entries already present'); process.exit(0); }

const hp = pickle.createEmpty();
hp.writeString(JSON.stringify(header));
const nh = hp.toBuffer();
const sp = pickle.createEmpty();
sp.writeUInt32(nh.length);

fs.writeFileSync(asarPath + '.new', Buffer.concat([sp.toBuffer(), nh, raw.slice(dataOffset)]));
fs.renameSync(asarPath + '.new', asarPath);
console.log('      asar entries added: ' + added);
