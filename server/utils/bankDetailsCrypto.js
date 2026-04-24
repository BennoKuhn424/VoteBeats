const paymentCrypto = require('./paymentCrypto');

const BANK_DETAIL_SECRET_FIELDS = ['accountHolder', 'accountNumber', 'branchCode'];

function encryptBankDetails(details) {
  const out = { ...details };
  if (!paymentCrypto.ENABLED) return out;
  for (const field of BANK_DETAIL_SECRET_FIELDS) {
    if (out[field]) out[field] = paymentCrypto.encrypt(String(out[field])) || String(out[field]);
  }
  out._encrypted = true;
  return out;
}

function decryptBankDetails(details) {
  if (!details) return null;
  const out = { ...details };
  for (const field of BANK_DETAIL_SECRET_FIELDS) {
    if (!out[field]) continue;
    const decrypted = paymentCrypto.decrypt(String(out[field]));
    out[field] = decrypted !== null ? decrypted : out[field];
  }
  delete out._encrypted;
  return out;
}

module.exports = { encryptBankDetails, decryptBankDetails, BANK_DETAIL_SECRET_FIELDS };
