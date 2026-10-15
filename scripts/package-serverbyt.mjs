// Builds release/yash-pos-serverbyt.zip: the Laravel app + built React app + vendor, ready to upload to
// cPanel shared hosting (Serverbyt Ignite or similar). Usage: npm run package
// Needs PHP 8.2+ and Composer. Set PHP_BIN / COMPOSER_PHAR if they are not on PATH.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'laravel');
const out = path.join(root, 'release', 'yash-pos');
const zip = path.join(root, 'release', 'yash-pos-serverbyt.zip');
const php = process.env.PHP_BIN || 'php';
const composer = process.env.COMPOSER_PHAR;

if (!process.argv.includes('--no-build')) execFileSync(process.execPath, [path.join(root, 'scripts', 'build-laravel.mjs')], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
const skip = [/^vendor/, /^node_modules/, /^tests/, /^\.env$/, /^phpunit\.xml$/, /^storage[\\/]logs[\\/].+\.log$/, /^storage[\\/]framework[\\/](cache[\\/]data|sessions|views)[\\/](?!\.gitignore)/,
  /^bootstrap[\\/]cache[\\/].+\.php$/, /^public[\\/]uploads[\\/](?!\.htaccess)/, /^\.phpunit/, /^\.editorconfig$/];
fs.cpSync(app, out, { recursive: true, filter: (src) => !skip.some((re) => re.test(path.relative(app, src))) });

// production dependencies only, autoloader optimised; scripts run on the server when needed
const composerArgs = ['install', '--no-dev', '--optimize-autoloader', '--no-interaction', '--no-scripts', '--no-progress'];
if (composer) execFileSync(php, [composer, ...composerArgs], { cwd: out, stdio: 'inherit' });
else execFileSync('composer', composerArgs, { cwd: out, stdio: 'inherit', shell: true });

// settings file with fresh secrets; the shop fills in the database lines
const key = (n) => crypto.randomBytes(n).toString('base64');
let env = fs.readFileSync(path.join(app, '.env.example'), 'utf8')
  .replace(/^APP_KEY=.*$/m, `APP_KEY=base64:${key(32)}`)
  .replace(/^INSTALL_KEY=.*$/m, `INSTALL_KEY=${crypto.randomBytes(12).toString('hex')}`)
  .replace(/^APP_URL=.*$/m, 'APP_URL=https://pos.yourdomain.com');
fs.writeFileSync(path.join(out, '.env.example'), env);
fs.copyFileSync(path.join(root, 'docs', 'SERVERBYT_HOSTING.md'), path.join(out, 'README-HOSTING.md'));
for (const d of ['storage/logs', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'bootstrap/cache', 'public/uploads']) {
  fs.mkdirSync(path.join(out, d), { recursive: true });
}

if (process.platform === 'win32') {
  // Windows 10+ ships bsdtar, which writes zip files with -a
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', out, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out, stdio: 'inherit' });
}
console.log(`\nReady: release/yash-pos-serverbyt.zip (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
console.log('It contains secrets (APP_KEY, INSTALL_KEY): never share it or commit it.');
