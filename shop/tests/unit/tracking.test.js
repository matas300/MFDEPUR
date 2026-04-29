const { buildTrackingUrl } = require('../../src/utils/tracking');

describe('buildTrackingUrl', () => {
  it('DHL produce URL con tracking number', () => {
    const url = buildTrackingUrl('DHL', '1234567890');
    expect(url).toMatch(/^https:\/\/www\.dhl\.com\//);
    expect(url).toContain('1234567890');
  });

  it('GLS produce URL con tracking number', () => {
    const url = buildTrackingUrl('GLS', 'ABC123');
    expect(url).toMatch(/^https:\/\/www\.gls-italy\.com\//);
    expect(url).toContain('ABC123');
  });

  it('SDA produce URL con tracking number', () => {
    const url = buildTrackingUrl('SDA', 'SDA999');
    expect(url).toMatch(/^https:\/\/www\.sda\.it\//);
    expect(url).toContain('SDA999');
  });

  it('BRT produce URL con tracking number', () => {
    const url = buildTrackingUrl('BRT', '0123456789');
    expect(url).toMatch(/^https:\/\/vas\.brt\.it\//);
    expect(url).toContain('0123456789');
  });

  it('UPS produce URL con tracking number', () => {
    const url = buildTrackingUrl('UPS', '1Z999AA10123456784');
    expect(url).toMatch(/^https:\/\/www\.ups\.com\//);
    expect(url).toContain('1Z999AA10123456784');
  });

  it('FEDEX produce URL con tracking number', () => {
    const url = buildTrackingUrl('FEDEX', '123456789012');
    expect(url).toMatch(/^https:\/\/www\.fedex\.com\//);
    expect(url).toContain('123456789012');
  });

  it('POSTE produce URL con tracking number', () => {
    const url = buildTrackingUrl('POSTE', 'RR123456789IT');
    expect(url).toMatch(/^https:\/\/www\.poste\.it\//);
    expect(url).toContain('RR123456789IT');
  });

  it('carrier ALTRO ritorna null (no template)', () => {
    expect(buildTrackingUrl('ALTRO', '12345')).toBeNull();
  });

  it('carrier sconosciuto ritorna null', () => {
    expect(buildTrackingUrl('PIPPO', '12345')).toBeNull();
  });

  it('number vuoto ritorna null', () => {
    expect(buildTrackingUrl('DHL', '')).toBeNull();
  });

  it('carrier null ritorna null', () => {
    expect(buildTrackingUrl(null, '12345')).toBeNull();
  });

  it('carrier undefined ritorna null', () => {
    expect(buildTrackingUrl(undefined, '12345')).toBeNull();
  });

  it('number undefined ritorna null', () => {
    expect(buildTrackingUrl('DHL', undefined)).toBeNull();
  });

  it('caratteri speciali nel number sono URL-encoded', () => {
    const url = buildTrackingUrl('DHL', 'AB 12/34');
    expect(url).toContain('AB%2012%2F34');
    expect(url).not.toContain('AB 12/34');
  });

  it('carrier in lowercase viene normalizzato', () => {
    const url = buildTrackingUrl('dhl', '12345');
    expect(url).toMatch(/^https:\/\/www\.dhl\.com\//);
    expect(url).toContain('12345');
  });
});
