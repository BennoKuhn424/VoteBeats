/**
 * @jest-environment node
 */

describe('bankDetailsCrypto', () => {
  const originalKey = process.env.PAYMENT_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.PAYMENT_ENCRYPTION_KEY;
    else process.env.PAYMENT_ENCRYPTION_KEY = originalKey;
    jest.resetModules();
  });

  test('leaves details readable when encryption is not configured', () => {
    delete process.env.PAYMENT_ENCRYPTION_KEY;
    const { encryptBankDetails, decryptBankDetails } = require('../utils/bankDetailsCrypto');
    const details = {
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '1234567890',
      branchCode: '250655',
      accountType: 'cheque',
    };

    expect(encryptBankDetails(details)).toEqual(details);
    expect(decryptBankDetails(details)).toEqual(details);
  });

  test('encrypts sensitive fields and decrypts them for responses', () => {
    process.env.PAYMENT_ENCRYPTION_KEY = 'test-key';
    const { encryptBankDetails, decryptBankDetails } = require('../utils/bankDetailsCrypto');
    const details = {
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '1234567890',
      branchCode: '250655',
      accountType: 'savings',
      updatedAt: 123,
    };

    const encrypted = encryptBankDetails(details);
    expect(encrypted._encrypted).toBe(true);
    expect(encrypted.bankName).toBe('FNB');
    expect(encrypted.accountType).toBe('savings');
    expect(encrypted.accountHolder).not.toBe(details.accountHolder);
    expect(encrypted.accountNumber).not.toBe(details.accountNumber);
    expect(encrypted.branchCode).not.toBe(details.branchCode);

    expect(decryptBankDetails(encrypted)).toEqual(details);
  });

  test('returns plaintext legacy fields when decryption is not possible', () => {
    process.env.PAYMENT_ENCRYPTION_KEY = 'test-key';
    const { decryptBankDetails } = require('../utils/bankDetailsCrypto');
    const legacy = {
      bankName: 'FNB',
      accountHolder: 'Plain Name',
      accountNumber: '1234567890',
      branchCode: '250655',
      _encrypted: true,
    };

    expect(decryptBankDetails(legacy)).toEqual({
      bankName: 'FNB',
      accountHolder: 'Plain Name',
      accountNumber: '1234567890',
      branchCode: '250655',
    });
  });

  test('handles empty details', () => {
    process.env.PAYMENT_ENCRYPTION_KEY = 'test-key';
    const { decryptBankDetails } = require('../utils/bankDetailsCrypto');
    expect(decryptBankDetails(null)).toBeNull();
  });
});
