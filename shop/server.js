require('./src/config/env'); // PRIMA riga: valida env e fail-fast

const observability = require('./src/utils/observability');
observability.init(); // Sentry (opt-in). DEVE stare prima di require('./src/app').

const app = require('./src/app');
const prisma = require('./src/config/database');

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

let server = null;
let shuttingDown = false;

async function start() {
  try {
    await prisma.$connect();
    console.log('✅ Database connesso');

    server = app.listen(PORT, () => {
      console.log(`🚀 MF Depur Shop in esecuzione su http://localhost:${PORT}`);
      console.log(`   Admin panel: http://localhost:${PORT}/admin`);
      console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    server.on('error', (err) => {
      console.error('❌ Errore server HTTP:', err);
      observability.captureException(err, { where: 'server.listen' });
      process.exit(1);
    });

    // ── Scheduler (cron jobs in-process) ──────────────────────────────────────
    const { startScheduler } = require('./src/jobs/scheduler');
    startScheduler();
  } catch (err) {
    console.error('❌ Errore avvio server:', err);
    observability.captureException(err, { where: 'start' });
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n⏸  Shutdown richiesto (${signal}), chiudo connessioni…`);

  // Timeout: se 30s non bastano, force exit (connessioni hung).
  const forceTimer = setTimeout(() => {
    console.error('⛔ Shutdown timeout, force exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.$disconnect();
    console.log('✅ Shutdown completato.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Errore durante shutdown:', err);
    observability.captureException(err, { where: 'shutdown' });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Fatal: lo stato applicativo è potenzialmente corrotto dopo un'eccezione non
// catturata o una rejection non gestita. Log + shutdown, non "proseguiamo".
process.on('unhandledRejection', (reason) => {
  console.error('❗ Unhandled Rejection:', reason);
  observability.captureException(reason instanceof Error ? reason : new Error(String(reason)),
    { where: 'unhandledRejection' });
  shutdown('UNHANDLED_REJECTION');
});

process.on('uncaughtException', (err) => {
  console.error('❗ Uncaught Exception:', err);
  observability.captureException(err, { where: 'uncaughtException' });
  shutdown('UNCAUGHT_EXCEPTION');
});

start();
