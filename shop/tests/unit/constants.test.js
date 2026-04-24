import { describe, it, expect } from 'vitest';
const {
  TAX_RATE,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  MAX_LEN,
} = require('../../src/config/constants');

describe('constants', () => {
  it('TAX_RATE è 0.22 (IVA ordinaria IT)', () => {
    expect(TAX_RATE).toBe(0.22);
  });

  it('ORDER_STATUSES contiene i 8 stati business', () => {
    expect(ORDER_STATUSES).toEqual([
      'PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING',
      'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
    ]);
  });

  it('ORDER_STATUSES è frozen (immutable)', () => {
    expect(Object.isFrozen(ORDER_STATUSES)).toBe(true);
    expect(() => ORDER_STATUSES.push('HACK')).toThrow();
  });

  it('DELIVERED può solo tornare REFUNDED', () => {
    expect(ORDER_STATUS_TRANSITIONS.DELIVERED).toEqual(['REFUNDED']);
  });

  it('CANCELLED e REFUNDED sono stati terminali', () => {
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.REFUNDED).toEqual([]);
  });

  it('PENDING può andare a CONFIRMED/PAYMENT_FAILED/CANCELLED', () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING).toEqual(
      expect.arrayContaining(['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'])
    );
  });

  it('COMPANY_STATUSES contiene i 4 stati', () => {
    expect(COMPANY_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
  });

  it('MAX_LEN ha chiavi per clamp', () => {
    expect(MAX_LEN.orderNotes).toBeGreaterThan(0);
    expect(MAX_LEN.trackingNumber).toBeGreaterThan(0);
    expect(MAX_LEN.firstName).toBeGreaterThan(0);
  });
});
