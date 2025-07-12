// scripts/build-ui.js
require('esbuild').build({
  entryPoints: ['src/webview/ui/main.tsx'],
  bundle: true,
  outfile: 'media/main.js',
  platform: 'browser',
  jsx: 'automatic',
  loader: {
    '.png': 'file',
    '.css': 'css'
  }
}).catch(() => process.exit(1));