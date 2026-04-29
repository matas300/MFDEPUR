// Helper per costruire URL tracking dei vettori principali.
// Se l'admin imposta un trackingUrl esplicito sull'ordine, quello vince
// sempre — questo helper è il fallback automatico.

const { CARRIERS } = require('../config/constants');

const TEMPLATES = Object.freeze({
  DHL:   n => `https://www.dhl.com/it-it/home/tracciamento.html?tracking-id=${encodeURIComponent(n)}`,
  GLS:   n => `https://www.gls-italy.com/it/per-il-destinatario/segui-la-tua-spedizione?match=${encodeURIComponent(n)}`,
  SDA:   n => `https://www.sda.it/wps/portal/Servizi_online/dettaglio-spedizione?locale=it&tracingNumber=${encodeURIComponent(n)}`,
  BRT:   n => `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspediz=${encodeURIComponent(n)}`,
  UPS:   n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  FEDEX: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  POSTE: n => `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(n)}`,
});

function buildTrackingUrl(carrier, number) {
  if (!carrier || !number) return null;
  const tpl = TEMPLATES[String(carrier).toUpperCase()];
  if (!tpl) return null;
  return tpl(String(number).trim());
}

module.exports = { buildTrackingUrl, CARRIERS };
