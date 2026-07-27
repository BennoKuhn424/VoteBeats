/**
 * @jest-environment node
 *
 * The single biggest money-loss risk is running in production against an
 * ephemeral disk. These tests pin the boot guard that turns that silent
 * total-loss into a loud failure.
 */

const { assertProductionDataSafety } = require('../utils/productionGuards');

const prodBase = {
  NODE_ENV: 'production',
  DATA_DIR: '/var/data',
  PAYMENT_ENCRYPTION_KEY: 'a-strong-secret',
  BACKUP_REMOTE_CMD: 'aws s3 cp {file} s3://bucket/',
};

describe('assertProductionDataSafety', () => {
  test('skips entirely outside production', () => {
    const result = assertProductionDataSafety({ NODE_ENV: 'development' }, () => {});
    expect(result).toEqual({ ok: true, skipped: true });
  });

  test('passes when production is fully configured', () => {
    const result = assertProductionDataSafety({ ...prodBase }, () => {});
    expect(result).toEqual({ ok: true, skipped: false });
  });

  test('throws when DATA_DIR is missing in production', () => {
    const env = { ...prodBase, DATA_DIR: '' };
    expect(() => assertProductionDataSafety(env, () => {})).toThrow(/DATA_DIR/);
  });

  test('throws when PAYMENT_ENCRYPTION_KEY is missing in production', () => {
    const env = { ...prodBase, PAYMENT_ENCRYPTION_KEY: '' };
    expect(() => assertProductionDataSafety(env, () => {})).toThrow(/PAYMENT_ENCRYPTION_KEY/);
  });

  test('collects multiple fatal problems into one error', () => {
    const env = { NODE_ENV: 'production', DATA_DIR: '', PAYMENT_ENCRYPTION_KEY: '' };
    try {
      assertProductionDataSafety(env, () => {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.message).toMatch(/DATA_DIR/);
      expect(e.message).toMatch(/PAYMENT_ENCRYPTION_KEY/);
    }
  });

  test('warns (not fatal) when backups do not leave the disk', () => {
    const warnings = [];
    const env = { ...prodBase, BACKUP_REMOTE_CMD: '' };
    const result = assertProductionDataSafety(env, (m) => warnings.push(m));
    expect(result.ok).toBe(true);
    expect(warnings.some((w) => /BACKUP_REMOTE_CMD/.test(w))).toBe(true);
  });

  test('warns when automated backups are disabled', () => {
    const warnings = [];
    const env = { ...prodBase, BACKUP_INTERVAL_HOURS: '0' };
    assertProductionDataSafety(env, (m) => warnings.push(m));
    expect(warnings.some((w) => /disabled/.test(w))).toBe(true);
  });

  test('whitespace-only DATA_DIR is treated as unset', () => {
    const env = { ...prodBase, DATA_DIR: '   ' };
    expect(() => assertProductionDataSafety(env, () => {})).toThrow(/DATA_DIR/);
  });
});
