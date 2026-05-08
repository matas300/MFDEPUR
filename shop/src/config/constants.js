// src/config/constants.js
// Costanti condivise. Single source of truth — se cambia qualcosa qui,
// cambia in tutto il sistema.

// IVA ordinaria italiana. M2 introdurrà aliquote per-product.
const TAX_RATE = 0.22;

const COMPANY_ROLES = Object.freeze(['COMPANY_ADMIN', 'BUYER', 'VIEWER']);

// Carrier supportati per tracking spedizioni
const CARRIERS = Object.freeze(['DHL', 'GLS', 'SDA', 'BRT', 'UPS', 'FEDEX', 'POSTE', 'ALTRO']);

// Stati Order (schema.prisma:166 + business rules)
const ORDER_STATUSES = Object.freeze([
  'AWAITING_APPROVAL', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING',
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
]);

// Transizioni permesse. Un admin non può forzare DELIVERED→PENDING_PAYMENT.
// PENDING_PAYMENT → CONFIRMED quando admin marca pagato il bonifico.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  AWAITING_APPROVAL: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:         ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING:        ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED:           ['DELIVERED', 'REFUNDED'],
  DELIVERED:         ['REFUNDED'],
  CANCELLED:         [],
  REFUNDED:          [],
});

// Stati Company (schema.prisma:21 + business rules)
const COMPANY_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);

// Metodi di pagamento supportati. Solo bonifico per ora.
const PAYMENT_METHODS = Object.freeze(['BANK_TRANSFER']);

// Max length campi free-text (usati da controller per slice/validation)
const MAX_LEN = Object.freeze({
  orderNotes:      1000,
  companyNotes:    2000,
  trackingNumber:  100,
  trackingCarrier: 30,
  trackingUrl:     500,
  addressStreet:   200,
  addressCity:     100,
  firstName:       100,
  lastName:        100,
  phone:           30,
});

module.exports = {
  TAX_RATE,
  COMPANY_ROLES,
  CARRIERS,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  PAYMENT_METHODS,
  MAX_LEN,
};
