import { decrypt, encrypt } from "@/lib/crypto/encryption";

const ENCRYPTED_PREFIX = "enc:v1:";
const SECRET_KEYS = new Set(["privateKey", "token"]);

function isEncrypted(value: string) {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptPaymentConfig(config: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (!SECRET_KEYS.has(key) || !value || isEncrypted(value)) return [key, value];
      return [key, `${ENCRYPTED_PREFIX}${encrypt(value)}`];
    })
  );
}
export function decryptPaymentConfig(config: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (!SECRET_KEYS.has(key) || !isEncrypted(value)) return [key, value];
      return [key, decrypt(value.slice(ENCRYPTED_PREFIX.length))];
    })
  );
}

export function paymentConfigNeedsEncryption(config: Record<string, string>) {
  return Object.entries(config).some(
    ([key, value]) => SECRET_KEYS.has(key) && Boolean(value) && !isEncrypted(value)
  );
}
