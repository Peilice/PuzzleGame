import { describe, expect, it } from 'vitest';
import { msUntilNextUpdateCheck } from '../src/core/update';

const H = 60 * 60 * 1000;
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 17, h, m, s);

describe('msUntilNextUpdateCheck', () => {
  it('上午排到當天 12:00', () => {
    expect(msUntilNextUpdateCheck(at(9, 30))).toBe(2.5 * H);
  });
  it('下午排到隔天 00:00', () => {
    expect(msUntilNextUpdateCheck(at(18))).toBe(6 * H);
  });
  it('剛好整點時排到下一個檢查時刻', () => {
    expect(msUntilNextUpdateCheck(at(0))).toBe(12 * H);
    expect(msUntilNextUpdateCheck(at(12))).toBe(12 * H);
  });
  it('跨月也正確', () => {
    expect(msUntilNextUpdateCheck(new Date(2026, 10, 30, 23, 59, 59))).toBe(1000);
  });
});
