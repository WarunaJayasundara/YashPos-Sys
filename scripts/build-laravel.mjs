// Builds the React app and copies it into laravel/public (Laravel serves it next to the API).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'client', 'dist');
const pub = path.join(root, 'laravel', 'public');

if (!process.argv.includes('--no-build')) execSync('npm run build -w client', { cwd: root, stdio: 'inherit' });
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('client/dist is missing: the client build failed');

// remove the previous build (hashed names change every build); Laravel's own files stay
fs.rmSync(path.join(pub, 'assets'), { recursive: true, force: true });
for (const f of fs.readdirSync(pub)) {
  if (/^workbox-.*\.js$/.test(f) || fs.existsSync(path.join(dist, f)) && !['index.php', '.htaccess', 'robots.txt', 'uploads'].includes(f)) {
    fs.rmSync(path.join(pub, f), { recursive: true, force: true });
  }
}
fs.cpSync(dist, pub, { recursive: true, filter: (s) => !s.endsWith('.map') });
console.log('React app copied to laravel/public');
