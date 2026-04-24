// src/routes/health.js
// Due endpoint separati:
// - /healthz: LIVENESS. Ritorna 200 se il processo risponde. Usato da loadbalancer.
// - /health:  READINESS. Verifica dipendenze (DB) + ritorna 200 solo se tutto OK.
//             Usato da orchestratori (K8s) per smistare traffico.

const router = require('express').Router();
const prisma = require('../config/database');
const logger = require('../utils/logger');

router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

router.get('/health', async (req, res) => {
  const checks = { db: 'unknown' };
  let ok = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'error';
    checks.dbError = err.message?.slice(0, 200);
    ok = false;
    logger.error({ err, where: 'health' }, 'DB health check failed');
  }

  const payload = {
    status: ok ? 'ok' : 'degraded',
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    checks,
  };
  res.status(ok ? 200 : 503).json(payload);
});

module.exports = router;
