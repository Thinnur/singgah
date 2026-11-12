import { describe, expect, it } from 'vitest';
import { formatBytes, formatMinutes, formatRemaining } from './time.ts';

describe('formatRemaining', () => {
  it('formats h:mm:ss', () => {
    expect(formatRemaining(7199000)).toBe('1:59:59');
    expect(formatRemaining(59_000)).toBe('0:00:59');
  });
  it('never goes negative', () => {
    expect(formatRemaining(-5)).toBe('0:00:00');
    expect(formatRemaining(0)).toBe('0:00:00');
  });
});

describe('formatBytes', () => {
  it('uses id-ID decimal comma', () => {
    expect(formatBytes(1536000)).toBe('1,5 MB');
  });
  it('handles small and zero values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });
});

describe('formatMinutes', () => {
  it('renders hours and minutes in Indonesian', () => {
    expect(formatMinutes(1)).toBe('1 menit');
    expect(formatMinutes(120)).toBe('2 jam');
    expect(formatMinutes(90)).toBe('1 jam 30 menit');
    expect(formatMinutes(0)).toBe('0 menit');
  });
  it('floors fractional minutes (quota left is not a whole number)', () => {
    expect(formatMinutes(478.505)).toBe('7 jam 58 menit');
    expect(formatMinutes(0.4)).toBe('0 menit');
  });
});
