const {
  TAX_RATE,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  COMPANY_ROLES,
  CARRIERS,
  PAYMENT_METHODS,
  MAX_LEN,
} = require('../../src/config/constants');

describe('constants', () => {
  it('TAX_RATE è 0.22 (IVA ordinaria IT)', () => {
    expect(TAX_RATE).toBe(0.22);
  });

  it('ORDER_STATUSES contiene gli 8 stati business (no PAYMENT_FAILED post-Stripe-removal)', () => {
    expect(ORDER_STATUSES).toEqual([
      'AWAITING_APPROVAL', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING',
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

  it('PENDING_PAYMENT può andare a CONFIRMED/CANCELLED', () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING_PAYMENT).toEqual(
      expect.arrayContaining(['CONFIRMED', 'CANCELLED'])
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

  it('COMPANY_ROLES è frozen e contiene i 3 ruoli', () => {
    expect(Object.isFrozen(COMPANY_ROLES)).toBe(true);
    expect(COMPANY_ROLES).toEqual(['COMPANY_ADMIN', 'BUYER', 'VIEWER']);
  });

  it('CARRIERS è frozen e contiene 8 vettori', () => {
    expect(Object.isFrozen(CARRIERS)).toBe(true);
    expect(CARRIERS).toContain('DHL');
    expect(CARRIERS).toContain('ALTRO');
    expect(CARRIERS.length).toBe(8);
  });

  it('PAYMENT_METHODS è frozen e contiene solo BANK_TRANSFER', () => {
    expect(Object.isFrozen(PAYMENT_METHODS)).toBe(true);
    expect(PAYMENT_METHODS).toEqual(['BANK_TRANSFER']);
  });
});
