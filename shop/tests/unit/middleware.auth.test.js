const { requireCompanyRole } = require('../../src/middleware/auth');

// Helper: costruisce una res minimale che cattura status/json/render
function mkRes() {
  const res = {
    statusCode: null,
    body: null,
    rendered: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    render(view, locals) { this.rendered = { view, locals }; return this; },
    redirect(url) { this.redirected = url; return this; },
  };
  return res;
}

// req minimale: accepts() ritorna false → ramo JSON
function mkReq(user) {
  return { user, accepts: () => false };
}

describe('requireCompanyRole middleware', () => {
  it('blocca utente senza companyId con 403', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = mkReq({ id: 1, role: 'CUSTOMER', companyId: null, companyRole: 'COMPANY_ADMIN' });
    const res = mkRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Accesso negato' });
  });

  it('blocca BUYER su route riservata a COMPANY_ADMIN', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = mkReq({ id: 2, role: 'CUSTOMER', companyId: 10, companyRole: 'BUYER' });
    const res = mkRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('consente accesso a COMPANY_ADMIN', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = mkReq({ id: 3, role: 'CUSTOMER', companyId: 10, companyRole: 'COMPANY_ADMIN' });
    const res = mkRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(null);
  });

  it('ADMIN globale bypassa il check di companyRole', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    // ADMIN senza companyId né companyRole: deve comunque passare
    const req = mkReq({ id: 4, role: 'ADMIN', companyId: null, companyRole: null });
    const res = mkRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(null);
  });
});
