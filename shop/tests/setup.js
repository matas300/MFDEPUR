// Global setup: prima di TUTTI i test, carica .env.test e resetta il DB.
// Usa spawnSync (no shell) per chiamare prisma db push.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async function setup() {
  const envPath = path.join(__dirname, '..', '.env.test');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
  process.env.NODE_ENV = 'test';

  const cwd = path.join(__dirname, '..');
  // spawnSync: args come array separati, no shell interpolation.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, ['prisma', 'db', 'push', '--force-reset', '--skip-generate'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`prisma db push --force-reset fallito (exit ${result.status})`);
  }

  return async function teardown() {
    // Nessun teardown globale: le connessioni Prisma si chiudono nei test integration.
  };
};
