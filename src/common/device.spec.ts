import { deviceKey, hashKey } from './device.js';

describe('device keys', () => {
  it('hashKey is deterministic, salted and hides the input', () => {
    expect(hashKey('abc', 's1')).toBe(hashKey('abc', 's1'));
    expect(hashKey('abc', 's1')).not.toBe(hashKey('abc', 's2'));
    expect(hashKey('abc', 's1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deviceKey hashes X-Device-Id and returns null when it is missing or blank', () => {
    expect(deviceKey({ headers: { 'x-device-id': ' dev-1 ' } }, 's')).toBe(hashKey('dev-1', 's'));
    expect(deviceKey({ headers: {} }, 's')).toBeNull();
    expect(deviceKey({ headers: { 'x-device-id': '  ' } }, 's')).toBeNull();
  });
});
