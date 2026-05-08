const cron = require('node-cron');
const logger = require('../utils/logger');
const { runWeeklyAccountantExport } = require('./weeklyAccountantExport');

function startScheduler() {
  if (process.env.NODE_ENV === 'test') {
    logger.info('scheduler: skip in test env');
    return;
  }

  // Lunedì 08:00 UTC = 09:00 Europe/Rome (ora solare) o 10:00 (ora legale)
  cron.schedule('0 8 * * 1', async () => {
    try {
      logger.info('cron: starting weekly accountant export');
      await runWeeklyAccountantExport();
    } catch (err) {
      logger.error({ err }, 'cron: weekly accountant export failed');
    }
  }, { timezone: 'UTC' });

  logger.info('scheduler: started — weekly accountant export Mon 08:00 UTC');
}

module.exports = { startScheduler };
