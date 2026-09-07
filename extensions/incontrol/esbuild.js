const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'out', 'extension.js'),
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

if (watch) {
  esbuild.context(opts).then(ctx => {
    ctx.watch();
    console.log('watching...');
  });
} else {
  esbuild.build(opts).catch(() => process.exit(1));
}
