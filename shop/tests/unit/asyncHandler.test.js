import { describe, it, expect, vi } from 'vitest';
const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  it('invoca il handler e passa req/res/next', async () => {
    const handler = vi.fn(async (req, res) => { res.sent = true; });
    const wrapped = asyncHandler(handler);
    const req = {};
    const res = {};
    const next = vi.fn();
    await wrapped(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(res.sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('cattura rejection e la passa a next', async () => {
    const err = new Error('boom');
    const wrapped = asyncHandler(async () => { throw err; });
    const next = vi.fn();
    await wrapped({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('funziona anche con handler sincroni', async () => {
    const wrapped = asyncHandler((req, res) => { res.ok = true; });
    const res = {};
    const next = vi.fn();
    await wrapped({}, res, next);
    expect(res.ok).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
