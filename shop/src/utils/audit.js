const prisma = require('../config/database');

// Registra un evento di audit. Non-blocking: se fallisce, logga su console e continua.
async function logAudit(req, { action, entityType, entityId = null, metadata = null }) {
  try {
    const user = req?.user || req?.res?.locals?.user || null;
    const ipRaw = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || null;
    const ua = req?.headers?.['user-agent']?.slice(0, 500) || null;
    await prisma.auditLog.create({
      data: {
        userId: user?.id || null,
        userEmail: user?.email || null,
        action,
        entityType,
        entityId,
        metadata: metadata ? JSON.stringify(metadata).slice(0, 4000) : null,
        ipAddress: ipRaw?.slice(0, 64) || null,
        userAgent: ua,
      },
    });
  } catch (e) {
    console.error('[audit] log failed:', e.message);
  }
}

module.exports = { logAudit };
