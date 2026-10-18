/**
 * Sıfır Windows bilgisayara tek dosyayla kurulum: Dunyatek-Salon-Kurulum-<sürüm>.exe üretir.
 * Paket kendi Node.js'ini (node.exe) içerir; hedef bilgisayarda Node, Git veya internet gerekmez.
 *
 * Kullanım: npm run kurulum [-- --out <klasör>] [-- --no-build]
 * Gereksinim: NSIS (makensis). Linux: apt install nsis · Windows: https://nsis.sourceforge.io
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = 'v24.22.0';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, 'release'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const isWin = process.platform === 'win32';
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', shell: isWin, ...opts });

if (!args.includes('--no-build')) run('npm', ['run', 'build'], { cwd: root });

// 1) Taşınabilir node.exe (önbellekte yoksa indirilir)
const cache = join(root, '.cache', 'node');
const nodeExe = join(cache, `node-${NODE_VERSION}-win-x64.exe`);
if (!existsSync(nodeExe)) {
  mkdirSync(cache, { recursive: true });
  const name = `node-${NODE_VERSION}-win-x64`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${name}.zip`;
  console.log(`Node.js indiriliyor: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`İndirilemedi: ${res.status} ${url}`);
  const zip = join(cache, `${name}.zip`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const tmp = join(cache, 'tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  // Windows 10+ tar.exe zip açabilir; Linux'ta unzip kullanılır
  if (isWin) run('tar', ['-xf', zip, '-C', tmp, `${name}/node.exe`, `${name}/LICENSE`]);
  else run('unzip', ['-q', zip, `${name}/node.exe`, `${name}/LICENSE`, '-d', tmp]);
  cpSync(join(tmp, name, 'node.exe'), nodeExe);
  cpSync(join(tmp, name, 'LICENSE'), join(cache, 'LICENSE'));
  rmSync(tmp, { recursive: true, force: true });
  rmSync(zip);
}

// 2) Paket klasörü: kurulunca C:\DUNYATEK\WeddingERP\app altına açılır
const stage = join(outDir, 'paket');
rmSync(stage, { recursive: true, force: true });
const copy = (from, to) => cpSync(join(root, from), join(stage, to ?? from), { recursive: true });
for (const f of ['index.mjs', 'seed.mjs', 'backup.mjs', 'reset-password.mjs']) {
  const p = `apps/local-server/dist/${f}`;
  if (!existsSync(join(root, p))) throw new Error(`${p} yok: önce npm run build`);
  copy(p);
}
copy('apps/web/dist');
copy('migrations/local');
cpSync(nodeExe, join(stage, 'node', 'node.exe'));
cpSync(join(cache, 'LICENSE'), join(stage, 'node', 'LICENSE'));

// PowerShell 5.1 BOM'suz .ps1 dosyalarını ANSI okur; Türkçe karakterler bozulmasın diye BOM eklenir
const ps1 = [
  ...['configure-windows.ps1', 'backup.ps1', 'restore.ps1', 'health-check.ps1'].map((f) => join(root, 'scripts', f)),
  join(root, 'installer', 'sifre.ps1'),
  join(root, 'installer', 'durdur.ps1'),
];
mkdirSync(join(stage, 'scripts'), { recursive: true });
for (const f of ps1) {
  const text = readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n/g, '\r\n');
  writeFileSync(join(stage, 'scripts', f.split(/[\\/]/).pop()), '\uFEFF' + text);
}
writeFileSync(join(stage, 'VERSION'), `${version}\r\n`);

// 3) NSIS ile tek .exe
const makensis = ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].find((c) => {
  try {
    execFileSync(c, ['-VERSION'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!makensis) throw new Error('NSIS (makensis) bulunamadı. Linux: apt install nsis · Windows: https://nsis.sourceforge.io');
const outFile = join(outDir, `Dunyatek-Salon-Kurulum-${version}.exe`);
const define = isWin ? '/D' : '-D';
execFileSync(
  makensis,
  [isWin ? '/V2' : '-V2', `${define}VERSION=${version}`, `${define}STAGE=${stage}`, `${define}OUTFILE=${outFile}`, join(root, 'installer', 'kurulum.nsi')],
  { stdio: 'inherit' },
);
rmSync(stage, { recursive: true, force: true });
console.log(`Hazır: ${outFile}`);
for (const f of readdirSync(outDir)) if (f.endsWith('.exe')) console.log(`  ${f}`);
