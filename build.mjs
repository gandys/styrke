// Builds everything into self-contained HTML:
//   dist/styrke.html          one file, no network needed (Android asset + Claude artifact)
//   dist/web/                 the same app as an installable web app (GitHub Pages)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname;
const r = p => readFileSync(root + p, 'utf8');
const version = (process.env.STYRKE_VERSION || JSON.parse(r('package.json')).version) + ' (' + new Date().toISOString().slice(0, 10) + ')';
const out = await build({ entryPoints: [root + 'src/main.js'], bundle: true, minify: true, define: { __VERSION__: JSON.stringify(version) }, format: 'iife', target: ['chrome90', 'safari14'], write: false, legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const fonts = [
  ['Barlow', 400, '@fontsource/barlow/files/barlow-latin-400-normal.woff2'],
  ['Barlow', 500, '@fontsource/barlow/files/barlow-latin-500-normal.woff2'],
  ['Barlow', 600, '@fontsource/barlow/files/barlow-latin-600-normal.woff2'],
  ['Barlow Condensed', 600, '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'],
  ['Barlow Condensed', 700, '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2'],
].map(([fam, w, f]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(root + 'node_modules/' + f).toString('base64')}) format('woff2')}`).join('');

const css = r('src/styles.css');
const tpl = r('src/index.html');
const page = head => tpl.replace('<!--HEAD-->', head).replace('/*FONTS*/', () => fonts).replace('/*CSS*/', () => css).replace('/*JS*/', () => js);

mkdirSync(root + 'dist/web', { recursive: true });
writeFileSync(root + 'dist/styrke.html', page(''));
const assets = root + 'android/app/src/main/assets';
if (existsSync(root + 'android/app/src/main')) { mkdirSync(assets, { recursive: true }); writeFileSync(assets + '/index.html', page('')); }
writeFileSync(root + 'dist/web/index.html', page('<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">'));
writeFileSync(root + 'dist/web/sw.js', r('src/sw.js').replace('__BUILD__', Date.now().toString(36)));
copyFileSync(root + 'src/manifest.webmanifest', root + 'dist/web/manifest.webmanifest');
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) if (existsSync(root + 'assets/' + f)) copyFileSync(root + 'assets/' + f, root + 'dist/web/' + f);
console.log('built', (page('').length / 1024).toFixed(0) + ' KB');
