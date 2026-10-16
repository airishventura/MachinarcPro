const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const dedicatedWorker = process.argv.includes('--worker');
const separateWorker = dedicatedWorker || process.argv.includes('--separate-worker');
const config = path.join(root, '.env.chatgpt.local');
if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw Error('This launcher is for local development only.');
if (!fs.existsSync(config)) throw Error('Create .env.chatgpt.local with DATABASE_URL for a separate local database. See CHATGPT_LOCAL.md.');
const env = dotenv.parse(fs.readFileSync(config));
let database;
try { database = new URL(env.DATABASE_URL || ''); }
catch { throw Error('Set a valid DATABASE_URL in .env.chatgpt.local. Its value is not logged.'); }
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname !== '/machinarc_local') throw Error('Use a local PostgreSQL server or a separate machinarc_local database. Production and staging configuration are not accepted.');
const localData = path.join(root, '.validation', 'postgres-local', 'data');
const localControl = path.join(root, '.validation', 'postgres-local', 'pgsql', 'bin', 'pg_ctl.exe');
if (process.platform === 'win32' && database.hostname === '127.0.0.1' && database.port === '55432' && database.pathname === '/machinarc_local' && fs.existsSync(path.join(localData, 'PG_VERSION')) && fs.existsSync(localControl)) {
  try { execFileSync(localControl, ['-D', localData, 'status'], { windowsHide: true, stdio: 'pipe' }); }
  catch { execFileSync(localControl, ['-D', localData, '-l', path.join(root, '.validation', 'postgres-local', 'postgres.log'), '-w', 'start'], { windowsHide: true, stdio: 'ignore' }); }
}
if (!env.MARC_ENCRYPTION_KEY || env.MARC_ENCRYPTION_KEY.length < 32) {
  env.MARC_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  fs.appendFileSync(config, `\nMARC_ENCRYPTION_KEY=${env.MARC_ENCRYPTION_KEY}\n`, { mode: 0o600 });
}
// Explicit environment values take precedence over Next's automatic .env loading.
// Keep production API keys and worker credentials out of the local process.
const childEnv = { ...process.env, ...env, NODE_ENV: 'development', TZ: 'UTC', MARC_CHATGPT_LOCAL: '1', MARC_WORKER: separateWorker ? 'off' : 'in-process', MARC_REQUIRE_ENCRYPTION_KEY: '1',
  OPENAI_API_KEY: env.OPENAI_API_KEY || '', ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '', CRON_SECRET: env.CRON_SECRET || randomBytes(32).toString('hex'), DATABASE_SSL_CA: env.DATABASE_SSL_CA || '', TEST_DATABASE_URL: '', VERCEL_OIDC_TOKEN: '' };
if (dedicatedWorker) { childEnv.HOST = '127.0.0.1'; childEnv.SERVER_PORT = '3101'; }
const args = dedicatedWorker
  ? ['--import', 'tsx', '--conditions=react-server', path.join(root, 'scripts', 'worker.ts')]
  : [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3016'];
const server = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit' });
server.on('error', () => { console.error('Could not start the local application.'); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code || 0; });
