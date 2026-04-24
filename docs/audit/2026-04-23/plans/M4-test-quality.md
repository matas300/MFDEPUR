# M4 — Test & Code Quality (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Un task → un commit.

**Goal:** Bootstrare l'infrastruttura test+lint+CI su `shop/` e fornire test-esemplari (unit + integration) che servano da base per crescita coverage. Blocker go-live.

**Scope in questa milestone (pragmatico, 1 sessione):**
- ESLint + Prettier config + autofix esistente + `npm run lint`
- Vitest + Supertest setup + `npm test` + config coverage
- Unit test per pure functions (`asyncHandler`, `constants`, `env validator`, `emailLogger` shape)
- Integration test su auth happy path (register → login) + RBAC IDOR (checkout addressId cross-company)
- GitHub Actions CI workflow (lint + test su PR verso master)
- README con sezione "Come eseguire test/lint"

**Fuori scope M4 (deferred a M4-bis / M3):**
- Test E2E Playwright (richiede dev server + browser)
- Test Stripe webhook con stubbing completo
- Coverage 70%+ (target raggiungibile solo con molteplici sessioni successive)
- Test race-condition su `_finalizeOrder` (richiede SQLite multi-connection coordinato, non triviale con Vitest)

**Tech stack:** ESLint 9 (flat config) + Prettier 3 + Vitest 2 + Supertest 7 + @vitest/coverage-v8.

---

## File structure (M4)

| File | Azione | Responsabilità |
|---|---|---|
| `shop/eslint.config.js` | **create** | ESLint 9 flat config con regole Node + security base |
| `shop/.prettierrc.json` | **create** | Prettier config (2-space, single-quote, trailing-comma es5, line 120) |
| `shop/.prettierignore` | **create** | Ignore node_modules, uploads, dev.db, migrations |
| `shop/vitest.config.js` | **create** | Vitest config: globals, reporters, coverage v8, singleThread (SQLite) |
| `shop/tests/setup.js` | **create** | Prisma reset helper per integration (globalSetup Vitest) |
| `shop/tests/helpers/db.js` | **create** | `resetData()`, `seedCompany()`, `seedUser()`, `seedAddress()` |
| `shop/tests/helpers/app.js` | **create** | Factory per app Supertest con cookie jar |
| `shop/tests/unit/asyncHandler.test.js` | **create** | Test wrapper cattura rejection |
| `shop/tests/unit/constants.test.js` | **create** | Test frozen enum + transizioni |
| `shop/tests/unit/env.test.js` | **create** | Test env validator fail-fast / success |
| `shop/tests/integration/auth.test.js` | **create** | Test register + login happy path |
| `shop/tests/integration/rbac.test.js` | **create** | Test IDOR addressId cross-company (403) |
| `shop/package.json` | modify | Scripts `test`, `test:cov`, `lint`, `lint:fix`, `format`; devDeps |
| `shop/.env.test` | **create** | Env per test (DATABASE_URL test, secret fittizi 32 char) |
| `.github/workflows/ci.yml` | **create** (root) | CI: install + lint + test su PR/push |
| `README.md` | **create** (root) | Quick start dev + testing + link `docs/audit/` |

**Pre-flight (orchestrator):** branch `feat/M4-test-quality` da `master`.

**Nota sicurezza:** tutti i test e gli helper usano `spawnSync` (no shell) per lanciare processi esterni (`npx prisma`, `node`), evitando qualsiasi command-injection risk.

---

## Wave 1 — Foundation (1 subagent sequenziale)

### Task F-1: ESLint 9 + Prettier config

**Files:** Create `shop/eslint.config.js`, `shop/.prettierrc.json`, `shop/.prettierignore`; modify `shop/package.json`.

- [ ] **Step 1:** installazione devDeps:
```bash
cd shop && npm install --save-dev eslint@^9 @eslint/js@^9 globals@^15 eslint-config-prettier@^9 prettier@^3
```

- [ ] **Step 2:** creare `shop/eslint.config.js`:
```js
// ESLint 9 flat config — Node.js backend MFDEPUR
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-process-exit': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'prisma/migrations/**',
      'prisma/dev.db',
      'prisma/test.db',
      'uploads/**',
      'coverage/**',
      'public/**',
    ],
  },
];
```

- [ ] **Step 3:** creare `shop/.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always"
}
```

- [ ] **Step 4:** creare `shop/.prettierignore`:
```
node_modules/
prisma/migrations/
prisma/*.db
prisma/*.db-*
uploads/
coverage/
public/
views/
*.md
```

- [ ] **Step 5:** aggiungere in `shop/package.json` scripts (merge con i già esistenti):
```json
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write ."
```

- [ ] **Step 6 — Verifica:**
```bash
cd shop && npx eslint --version && npx prettier --version
```

- [ ] **Step 7 — Commit:**
```bash
git add shop/eslint.config.js shop/.prettierrc.json shop/.prettierignore shop/package.json shop/package-lock.json
git commit -m "chore(lint): ESLint 9 flat config + Prettier + npm scripts"
```

---

### Task F-2: lint autofix sulla codebase

- [ ] **Step 1:** run autofix (dentro `shop/`):
```bash
npm run lint:fix 2>&1 | tail -30
```

- [ ] **Step 2:** run lint per conferma:
```bash
npm run lint 2>&1 | tail -50
```
**Atteso:** zero errori (warning consentiti). Se restano errori, rinomina variabili non usate in `_varName`, oppure aggiungere `// eslint-disable-next-line` con commento motivato.

- [ ] **Step 3 — Commit:**
```bash
git add -A shop/
git commit -m "style: eslint --fix su codebase shop/ (M4 baseline)"
```
Se nessun file è cambiato:
```bash
git commit --allow-empty -m "style: eslint baseline pulita (0 fix necessari)"
```

---

### Task F-3: Vitest + Supertest setup

**Files:** Create `shop/vitest.config.js`; modify `shop/package.json`.

- [ ] **Step 1:** installazione devDeps:
```bash
cd shop && npm install --save-dev vitest@^2 @vitest/coverage-v8@^2 supertest@^7
```

- [ ] **Step 2:** creare `shop/vitest.config.js`:
```js
// Vitest config MFDEPUR
// singleThread: SQLite non supporta multi-writer concorrente, i test integration
// devono essere serializzati. Unit test sono comunque veloci.
// globalSetup: azzera il DB test una volta per run.
module.exports = {
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    globalSetup: './tests/setup.js',
    setupFiles: [],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/config/database.js', 'src/config/env.js'],
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
      },
    },
  },
};
```

- [ ] **Step 3:** aggiungere in `shop/package.json` scripts:
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage"
```

- [ ] **Step 4 — Verifica:**
```bash
cd shop && npx vitest --version
```

- [ ] **Step 5 — Commit:**
```bash
git add shop/vitest.config.js shop/package.json shop/package-lock.json
git commit -m "chore(test): Vitest 2 + Supertest + coverage-v8 setup"
```

---

### Task F-4: tests helpers + `.env.test` + globalSetup

**Files:** Create `shop/.env.test`, `shop/tests/setup.js`, `shop/tests/helpers/db.js`, `shop/tests/helpers/app.js`.

- [ ] **Step 1:** creare `shop/.env.test`:
```env
NODE_ENV=test
PORT=0
BASE_URL=http://localhost
DATABASE_URL="file:./test.db"
JWT_SECRET=test_secret_32_chars_xxxxxxxxxxxx
JWT_REFRESH_SECRET=test_refresh_secret_32_chars_xxx
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CSRF_SECRET=test_csrf_secret_32_chars_xxxxxxx
STRIPE_SECRET_KEY=sk_test_fake
STRIPE_PUBLISHABLE_KEY=pk_test_fake
STRIPE_WEBHOOK_SECRET=whsec_test_fake
EMAIL_HOST=smtp.example.test
EMAIL_PORT=587
EMAIL_USER=test@example.test
EMAIL_PASS=testpass
EMAIL_FROM=test@example.test
ADMIN_EMAIL=admin@example.test
ADMIN_PASSWORD=TestAdmin1234!
UPLOAD_MAX_SIZE_MB=5
```
**Nota:** `.env.test` NON va in gitignore. Verifica `shop/.gitignore` — se esclude `.env*` aggiungere `!.env.test`.

- [ ] **Step 2:** creare `shop/tests/setup.js` (globalSetup Vitest) — **usa `spawnSync` (no shell, no injection)**:
```js
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
```

- [ ] **Step 3:** creare `shop/tests/helpers/db.js`:
```js
const prisma = require('../../src/config/database');
const bcrypt = require('bcryptjs');

async function resetData() {
  await prisma.auditLog.deleteMany();
  await prisma.emailFailureLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.address.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
}

async function seedCompany(overrides = {}) {
  return prisma.company.create({
    data: {
      name: overrides.name || 'Acme Test SRL',
      vatNumber: overrides.vatNumber || `IT${Math.floor(Math.random() * 1e11)}`.padEnd(13, '0').slice(0, 13),
      status: overrides.status || 'APPROVED',
      ...overrides,
    },
  });
}

async function seedUser({ company, email, password, role = 'CUSTOMER', isEmailVerified = true } = {}) {
  const pw = password || 'TestPassword123';
  return prisma.user.create({
    data: {
      email: email || `user${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`,
      password: await bcrypt.hash(pw, 4),
      firstName: 'Mario',
      lastName: 'Rossi',
      role,
      isEmailVerified,
      companyId: company?.id || null,
    },
  });
}

async function seedAddress(companyId, overrides = {}) {
  return prisma.address.create({
    data: {
      companyId,
      label: overrides.label || 'Sede legale',
      street: overrides.street || 'Via Roma 1',
      city: overrides.city || 'Bologna',
      province: overrides.province || 'BO',
      postalCode: overrides.postalCode || '40100',
      country: overrides.country || 'IT',
      isDefault: overrides.isDefault ?? true,
    },
  });
}

module.exports = { prisma, resetData, seedCompany, seedUser, seedAddress };
```

- [ ] **Step 4:** creare `shop/tests/helpers/app.js`:
```js
const request = require('supertest');

function makeApp() {
  delete require.cache[require.resolve('../../src/app')];
  return require('../../src/app');
}

function agent() {
  return request.agent(makeApp());
}

module.exports = { makeApp, agent, request };
```

- [ ] **Step 5 — Verifica:**
```bash
cd shop && node -c tests/setup.js && node -c tests/helpers/db.js && node -c tests/helpers/app.js
```

- [ ] **Step 6 — Commit:**
```bash
git add shop/.env.test shop/tests/setup.js shop/tests/helpers/db.js shop/tests/helpers/app.js
git commit -m "chore(test): env.test + globalSetup + db/app helpers"
```

---

## Wave 2 — Parallel batches (3 subagent)

### Batch α — Unit tests (1 subagent)

#### Task α-1: `asyncHandler.test.js`

- [ ] **Step 1:** creare `shop/tests/unit/asyncHandler.test.js`:
```js
const { describe, it, expect, vi } = require('vitest');
const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  it('invoca il handler e passa req/res/next', async () => {
    const handler = vi.fn(async (req, res) => { res.sent = true; });
    const wrapped = asyncHandler(handler);
    const req = {};
    const res = {};
    const next = vi.fn();
    await wrapped(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(res.sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('cattura rejection e la passa a next', async () => {
    const err = new Error('boom');
    const wrapped = asyncHandler(async () => { throw err; });
    const next = vi.fn();
    await wrapped({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('funziona anche con handler sincroni', async () => {
    const wrapped = asyncHandler((req, res) => { res.ok = true; });
    const res = {};
    const next = vi.fn();
    await wrapped({}, res, next);
    expect(res.ok).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:**
```bash
cd shop && npx vitest run tests/unit/asyncHandler.test.js --reporter=verbose
```

- [ ] **Step 3:**
```bash
git add shop/tests/unit/asyncHandler.test.js
git commit -m "test(utils): asyncHandler cattura rejection e invoca handler"
```

---

#### Task α-2: `constants.test.js`

- [ ] **Step 1:** creare `shop/tests/unit/constants.test.js`:
```js
const { describe, it, expect } = require('vitest');
const {
  TAX_RATE,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  MAX_LEN,
} = require('../../src/config/constants');

describe('constants', () => {
  it('TAX_RATE è 0.22 (IVA ordinaria IT)', () => {
    expect(TAX_RATE).toBe(0.22);
  });

  it('ORDER_STATUSES contiene i 8 stati business', () => {
    expect(ORDER_STATUSES).toEqual([
      'PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING',
      'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
    ]);
  });

  it('ORDER_STATUSES è frozen (immutable)', () => {
    expect(Object.isFrozen(ORDER_STATUSES)).toBe(true);
    expect(() => ORDER_STATUSES.push('HACK')).toThrow();
  });

  it('DELIVERED può solo tornare REFUNDED', () => {
    expect(ORDER_STATUS_TRANSITIONS.DELIVERED).toEqual(['REFUNDED']);
  });

  it('CANCELLED e REFUNDED sono stati terminali', () => {
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.REFUNDED).toEqual([]);
  });

  it('PENDING può andare a CONFIRMED/PAYMENT_FAILED/CANCELLED', () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING).toEqual(
      expect.arrayContaining(['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'])
    );
  });

  it('COMPANY_STATUSES contiene i 4 stati', () => {
    expect(COMPANY_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
  });

  it('MAX_LEN ha chiavi per clamp', () => {
    expect(MAX_LEN.orderNotes).toBeGreaterThan(0);
    expect(MAX_LEN.trackingNumber).toBeGreaterThan(0);
    expect(MAX_LEN.firstName).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2:**
```bash
cd shop && npx vitest run tests/unit/constants.test.js --reporter=verbose
```

- [ ] **Step 3:**
```bash
git add shop/tests/unit/constants.test.js
git commit -m "test(config): constants TAX_RATE + stati + transizioni + MAX_LEN"
```

---

#### Task α-3: `env.test.js`

- [ ] **Step 1:** creare `shop/tests/unit/env.test.js` — **usa `spawnSync` di node diretto (no shell)**:
```js
const { describe, it, expect } = require('vitest');
const path = require('path');
const { spawnSync } = require('child_process');

// env.js fa validazione + process.exit(1) al require iniziale. Testarlo direttamente
// nel processo Vitest sporcerebbe lo stato. Usiamo spawnSync di node (no shell) con env controllata.
const envJs = path.join(__dirname, '..', '..', 'src', 'config', 'env.js');

function runEnv(envOverride) {
  return spawnSync('node', ['-e', `require(${JSON.stringify(envJs)})`], {
    env: { PATH: process.env.PATH, ...envOverride },
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
```

- [ ] **Step 2:**
```bash
cd shop && npx vitest run tests/unit/env.test.js --reporter=verbose
```

- [ ] **Step 3:**
```bash
git add shop/tests/unit/env.test.js
git commit -m "test(config): env validator fail-fast e success cases"
```

---

### Batch β — Integration tests (1 subagent)

**Files:** Create `shop/tests/integration/auth.test.js`, `shop/tests/integration/rbac.test.js`.

#### Task β-1: `auth.test.js` — register + login happy path

- [ ] **Step 1:** creare `shop/tests/integration/auth.test.js`:
```js
const { describe, it, expect, beforeEach, afterAll } = require('vitest');
const { agent } = require('../helpers/app');
const { prisma, resetData } = require('../helpers/db');

describe('POST /auth/register + /auth/login (happy path)', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registra una company e crea user non-verified', async () => {
    const a = agent();
    const reg = await a.get('/auth/register');
    expect(reg.status).toBe(200);
    const csrfMatch = reg.text.match(/name="_csrf"\s+value="([^"]+)"/);
    expect(csrfMatch).toBeTruthy();
    const csrf = csrfMatch[1];

    const vat = `IT${Date.now().toString().slice(-11).padStart(11, '0')}`;
    const email = `e2e_${Date.now()}@test.local`;

    const res = await a.post('/auth/register')
      .type('form')
      .send({
        _csrf: csrf,
        email,
        password: 'TestPassword123',
        firstName: 'Mario',
        lastName: 'Rossi',
        companyName: 'Acme E2E SRL',
        vatNumber: vat,
      });
    expect([302, 200]).toContain(res.status);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    expect(user.email).toBe(email);
    expect(user.isEmailVerified).toBe(false);

    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    expect(company).toBeTruthy();
    expect(company.status).toBe('PENDING');
    expect(company.vatNumber).toBe(vat);
  });

  it('login con credenziali invalide non concede sessione', async () => {
    const a = agent();
    const reg = await a.get('/auth/login');
    const csrf = reg.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const res = await a.post('/auth/login')
      .type('form')
      .send({ _csrf: csrf, email: 'nonexistent@test.local', password: 'wrong' });

    const ok = (res.status >= 300 && res.status < 500) ||
               (res.status === 200 && /invalid|non valid|errat|non trovat/i.test(res.text));
    expect(ok).toBe(true);
  });
});
```

**Nota di adattamento:** se il test fallisce perché il nome del campo CSRF o i field di registrazione non combaciano, il subagent deve:
1. Leggere `shop/src/routes/auth.js` (validator `POST /auth/register`)
2. Leggere `shop/views/auth/register.ejs` (form + csrf field name)
3. Adattare e rieseguire. Motivazione nel report.

- [ ] **Step 2:**
```bash
cd shop && npx vitest run tests/integration/auth.test.js --reporter=verbose
```

- [ ] **Step 3:**
```bash
git add shop/tests/integration/auth.test.js
git commit -m "test(auth): register+login happy path via Supertest"
```

---

#### Task β-2: `rbac.test.js` — IDOR addressId cross-company

- [ ] **Step 1:** creare `shop/tests/integration/rbac.test.js`:
```js
const { describe, it, expect, beforeEach, afterAll } = require('vitest');
const { agent } = require('../helpers/app');
const { prisma, resetData, seedCompany, seedUser, seedAddress } = require('../helpers/db');

describe('RBAC / IDOR su addressId al checkout', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('utente di company A riceve 403 se usa addressId di company B (M0-B-4 fix)', async () => {
    const companyA = await seedCompany({ name: 'Alpha SRL' });
    const companyB = await seedCompany({ name: 'Beta SRL' });
    const userA = await seedUser({ company: companyA, email: 'user_a@test.local', password: 'TestPassword123' });
    await seedAddress(companyA.id, { street: 'Via Alpha' });
    const addressB = await seedAddress(companyB.id, { street: 'Via Beta' });

    const a = agent();
    const loginPage = await a.get('/auth/login');
    const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    await a.post('/auth/login')
      .type('form')
      .send({ _csrf: loginCsrf, email: userA.email, password: 'TestPassword123' });

    // Seed cart minimo per raggiungere checkout POST
    const cat = await prisma.category.create({ data: { name: 'T', slug: 't' } });
    const prod = await prisma.product.create({
      data: { name: 'Test', slug: 'test', price: 10, stock: 5, isActive: true, categoryId: cat.id, unit: 'kg' },
    });
    await prisma.cart.create({
      data: { userId: userA.id, items: { create: [{ productId: prod.id, quantity: 1 }] } },
    });

    const co = await a.get('/shop/checkout');
    const csrf = co.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        addressId: addressB.id,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: 'rbac-test-key',
      });

    expect(postRes.status).toBe(403);
    expect(postRes.text).toMatch(/non valid|non autorizz|indirizz/i);

    const orders = await prisma.order.count({ where: { userId: userA.id } });
    expect(orders).toBe(0);
  });
});
```

**Nota di adattamento:** se il form richiede field addizionali o nomi diversi, il subagent adatta leggendo `views/shop/checkout.ejs` e `controllers/orderController.js::postCheckout`. Motivazione nel report.

- [ ] **Step 2:**
```bash
cd shop && npx vitest run tests/integration/rbac.test.js --reporter=verbose
```

- [ ] **Step 3:**
```bash
git add shop/tests/integration/rbac.test.js
git commit -m "test(rbac): IDOR addressId cross-company → 403 (M0-B-4 regression guard)"
```

---

### Batch γ — CI + README (1 subagent)

#### Task γ-1: GitHub Actions CI workflow

**Files:** Create `.github/workflows/ci.yml` (root del repo).

- [ ] **Step 1:** creare `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]

jobs:
  lint-and-test:
    name: Lint + Test
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: shop
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: shop/package-lock.json

      - name: Install
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Prisma generate
        run: npx prisma generate
        env:
          DATABASE_URL: file:./test.db

      - name: Test
        run: npm test
        env:
          NODE_ENV: test
          JWT_SECRET: ci_jwt_secret_32chars_xxxxxxxxxxxxx
          JWT_REFRESH_SECRET: ci_jwt_refresh_secret_32chars_xxx
          JWT_EXPIRES_IN: 15m
          JWT_REFRESH_EXPIRES_IN: 7d
          CSRF_SECRET: ci_csrf_secret_32chars_xxxxxxxxxx
          STRIPE_SECRET_KEY: sk_test_ci
          STRIPE_PUBLISHABLE_KEY: pk_test_ci
          STRIPE_WEBHOOK_SECRET: whsec_test_ci
          DATABASE_URL: file:./test.db
          BASE_URL: http://localhost
```

- [ ] **Step 2:** verifica base:
```bash
grep -E "^(name|on|jobs):" .github/workflows/ci.yml
# Expected: 3 righe
```

- [ ] **Step 3:**
```bash
git add .github/workflows/ci.yml
git commit -m "ci(github-actions): lint + test pipeline su PR/push master"
```

---

#### Task γ-2: README.md root

**Files:** Create `README.md` (root repo).

- [ ] **Step 1:** creare `README.md`:

````markdown
# MFDEPUR

E-commerce B2B per prodotti chimici di depurazione (MF Depur S.r.l.).

## Struttura repo

- `shop/` — applicazione Node.js/Express (codice principale)
- `docs/` — documentazione e audit
- `index.html`, `assets/` — sito statico legacy (servito da Hostinger)
- `New Sites/` — staging del sito statico legacy (non in uso)

## Quick start (sviluppo)

```bash
cd shop
cp .env.example .env    # e compilare i valori reali
npm install
npx prisma db push      # inizializza SQLite dev
npm run db:seed         # crea admin + company demo (richiede ADMIN_PASSWORD env)
npm run dev             # avvia su http://localhost:3000
```

## Test & quality

```bash
cd shop
npm test            # Vitest (unit + integration)
npm run test:cov    # Vitest + coverage
npm run lint        # ESLint
npm run lint:fix    # ESLint auto-fix
npm run format      # Prettier
```

I test integration usano `shop/prisma/test.db` (ricreato prima di ogni run).

## Audit & roadmap

La roadmap post-audit è in `docs/audit/2026-04-23/99-MASTER.md`.
Per dettagli per area:

- `docs/audit/2026-04-23/10-security.md`
- `docs/audit/2026-04-23/11-eshop-fiscal.md`
- `docs/audit/2026-04-23/12-code-quality.md`
- `docs/audit/2026-04-23/13-ui-ux-perf.md`
- `docs/audit/2026-04-23/14-production-ready.md`

## CI

GitHub Actions (`.github/workflows/ci.yml`) esegue lint + test su ogni PR verso `master`.

## Convenzioni

- Branch-only per le feature (`feat/<milestone>-<task>`).
- Testi UI in italiano.
- Niente inline JS nelle view (CSP con nonce).
- Niente segreti in repo.
- File sorgenti sotto 500 righe.
````

- [ ] **Step 2:**
```bash
git add README.md
git commit -m "docs: README root con quick start + test + link audit"
```

---

## Wrap-up (orchestrator)

- [ ] **Step 1:** run completa test suite:
```bash
cd shop && npm test 2>&1 | tail -30
```

- [ ] **Step 2:** run lint:
```bash
cd shop && npm run lint 2>&1 | tail -10
```

- [ ] **Step 3:** conteggio commit:
```bash
git log --oneline master..HEAD | wc -l
```

- [ ] **Step 4:** merge:
```bash
git checkout master
git merge --no-ff feat/M4-test-quality -m "Merge branch 'feat/M4-test-quality' — M4 audit 2026-04-23"
```

- [ ] **Step 5:** update memoria + activeContext.

---

## Riepilogo coverage

| Task plan | Ref audit | Note |
|---|---|---|
| F-1 | M4-T1 | ESLint 9 flat config + Prettier |
| F-2 | M4-T1 | autofix esistente |
| F-3 | M4-T2 | Vitest 2 + Supertest + coverage |
| F-4 | M4-T2 | helpers test infrastructure |
| α-1 | M4-T3 | unit asyncHandler |
| α-2 | M4-T3 | unit constants |
| α-3 | M4-T3 | unit env validator |
| β-1 | M4-T4 (partial) | integration auth happy path |
| β-2 | M4-T6 | integration RBAC/IDOR addressId |
| γ-1 | M4-T8 | CI GitHub Actions |
| γ-2 | — | README onboarding |

**Fuori scope (deferred):** coverage 70%+, Playwright E2E (M4-T7), Stripe webhook test (M4-T5 completo), test integration di tutti i flussi.

## Decomposizione esecutiva

| Wave | Chi | Cosa | Durata stimata |
|---|---|---|---|
| 0 | orchestrator | branch + plan commit | instant |
| 1 | 1 subagent sequenziale | F-1..F-4 | ~15-20 min |
| 2 | 3 subagent paralleli | α (unit), β (integration), γ (CI+README) | ~15-20 min |
| 3 | orchestrator | run completa, merge | ~5 min |

Totale: ~35-45 min.

## Rischi noti

- **Test integration β potrebbe fallire al primo colpo** se CSRF field name o form body non combaciano col codice reale. Il subagent β ha istruzioni per leggere + adattare.
- **`prisma db push --force-reset`** in globalSetup azzera il test.db ad ogni `npm test`.
- **Coverage soglie minime 15%**: baseline M4, non obiettivo finale.
