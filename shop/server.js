const app = require('./src/app');
const prisma = require('./src/config/database');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await prisma.$connect();
    console.log('✅ Database connesso');

    app.listen(PORT, () => {
      console.log(`🚀 MF Depur Shop in esecuzione su http://localhost:${PORT}`);
      console.log(`   Admin panel: http://localhost:${PORT}/admin`);
      console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Errore avvio server:', err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();
