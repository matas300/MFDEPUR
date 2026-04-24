// src/utils/format.js
// Formatter Intl 'it-IT' usati lato server (EJS) e re-implementati lato client.
// Valuta: € 1.234,56 (formato italiano, spazio unbreakable, separatori IT).

const euroFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Prisma.Decimal o stringhe
  if (typeof v.toNumber === 'function') return v.toNumber();
  return parseFloat(v) || 0;
}

function formatEuro(v) {
  return euroFormatter.format(toNumber(v));
}

function formatNumber(v) {
  return numberFormatter.format(toNumber(v));
}

function formatDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return dateFormatter.format(d);
}

function formatDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return dateTimeFormatter.format(d);
}

module.exports = { formatEuro, formatNumber, formatDate, formatDateTime };
