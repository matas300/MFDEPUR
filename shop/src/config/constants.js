// src/config/constants.js
// Costanti condivise. Single source of truth — se cambia qualcosa qui,
// cambia in tutto il sistema.

// IVA ordinaria italiana. M2 introdurrà aliquote per-product.
const TAX_RATE = 0.22;

// Stati Order (schema.prisma:166 + business rules)
const ORDER_STATUSES = Object.freeze([
  'PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING',
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
]);

// Transizioni permesse. Un admin non può forzare DELIVERED→PENDING.
// (Stripe webhook può portare PENDING→CONFIRMED o PENDING→PAYMENT_FAILED.)
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  PENDING:        ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING', 'CANCELLED'],
  CONFIRMED:      ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING:     ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED:        ['DELIVERED', 'REFUNDED'],
  DELIVERED:      ['REFUNDED'],
  CANCELLED:      [],
  REFUNDED:       [],
});

// Stati Company (schema.prisma:21 + business rules)
const COMPANY_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);

// Max length campi free-text (usati da controller per slice/validation)
const MAX_LEN = Object.freeze({
  orderNotes:      1000,
  companyNotes:    2000,
  trackingNumber:  100,
  addressStreet:   200,
  addressCity:     100,
  firstName:       100,
  lastName:        100,
  phone:           30,
});

module.exports = {
  TAX_RATE,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  MAX_LEN,
};
