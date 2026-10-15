// Builds release/yash-pos-cpanel.zip: an upload-ready app for cPanel "Setup Node.js App" (shared hosting).
// Usage: npm run package:cpanel
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release', 'yash-pos-cpanel');
const zip = path.join(root, 'release', 'yash-pos-cpanel.zip');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (!process.argv.includes('--no-build')) run('npm run build');
for (const p of [path.join(root, 'server/dist/index.js'), path.join(root, 'client/dist/index.html')]) {
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}: run npm run build first`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, filter: (s) => !s.endsWith('.map') });
copy('server/dist');
copy('server/prisma/schema.prisma');
copy('server/prisma/migrations');
copy('server/openapi.yaml');
copy('client/dist');

const server = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
const deps = { ...server.dependencies, prisma: server.devDependencies.prisma };
fs.writeFileSync(path.join(out, 'server/package.json'), JSON.stringify({ name: 'server', private: true, type: 'module' }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'yash-mobile-pos',
  version: server.version,
  private: true,
  main: 'app.js',
  engines: { node: '>=20' },
  scripts: { start: 'node app.js', postinstall: 'prisma generate --schema server/prisma/schema.prisma' },
  dependencies: deps,
}, null, 2) + '\n');

// cPanel's startup file: loads the ES-module server (Passenger expects a plain script here)
fs.writeFileSync(path.join(out, 'app.js'), `// Startup file for cPanel "Setup Node.js App". Settings come from the app's environment variables.
import('./server/dist/index.js').catch((e) => { console.error(e); process.exit(1); });
`);
fs.mkdirSync(path.join(out, 'uploads'), { recursive: true });
fs.writeFileSync(path.join(out, 'uploads', '.keep'), '');
fs.writeFileSync(path.join(out, 'README.txt'), `YASH MOBILE POS for cPanel shared hosting.
Follow docs/CPANEL_HOSTING.md in the GitHub repository:
https://github.com/WarunaJayasundara/YashPos-Sys/blob/main/docs/CPANEL_HOSTING.md
`);

// pin exact dependency versions so the host installs what was tested
execSync('npm install --package-lock-only --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: out, stdio: 'inherit' });

if (process.platform === 'win32') {
  // Windows 10+ ships bsdtar, which writes zip files with -a
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execSync(`"${tar}" -a -c -f ../yash-pos-cpanel.zip *`, { cwd: out, stdio: 'inherit' });
} else {
  execSync('zip -qr ../yash-pos-cpanel.zip .', { cwd: out, stdio: 'inherit' });
}

console.log(`
Ready: release/yash-pos-cpanel.zip (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB). Upload it with docs/CPANEL_HOSTING.md`);
