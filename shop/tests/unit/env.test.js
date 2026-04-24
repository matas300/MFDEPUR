const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// env.js fa validazione + process.exit(1) al require iniziale. Testarlo direttamente
// nel processo Vitest sporcerebbe lo stato. Usiamo spawnSync di node (no shell) con env controllata.
// cwd = os.tmpdir() così dotenv.config() non carica il .env reale di shop/.
const envJs = path.join(__dirname, '..', '..', 'src', 'config', 'env.js');

function runEnv(envOverride) {
  return spawnSync('node', ['-e', `require(${JSON.stringify(envJs)})`], {
    env: { PATH: process.env.PATH, ...envOverride },
    cwd: os.tmpdir(),
    encoding: 'utf8',
  });
}

describe('env validator', () => {
  it('fail-fast (exit 1) se JWT_SECRET mancante', () => {
    const r = runEnv({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Configurazione env non valida/);
    expect(r.stderr).toMatch(/JWT_SECRET/);
  });

  it('fail-fast se JWT_SECRET è troppo corta (<32 char)', () => {
    const r = runEnv({
      JWT_SECRET: 'troppo_corta',
      JWT_REFRESH_SECRET: 'x'.repeat(32),
      CSRF_SECRET: 'x'.repeat(32),
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PUBLISHABLE_KEY: 'pk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      DATABASE_URL: 'file:./x.db',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Troppo corte/);
    expect(r.stderr).toMatch(/JWT_SECRET/);
  });

  it('passa con tutte le env var valide', () => {
    const r = runEnv({
      JWT_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'x'.repeat(32),
      CSRF_SECRET: 'x'.repeat(32),
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PUBLISHABLE_KEY: 'pk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      DATABASE_URL: 'file:./x.db',
    });
    expect(r.status).toBe(0);
  });
});
