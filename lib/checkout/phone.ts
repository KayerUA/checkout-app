/**
 * Accept Ukrainian national and international formats, but persist only E.164.
 * A Ukrainian number is country code 380 plus exactly nine national digits.
 */
export function normalizeUaPhone(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `38${digits}`;
  return /^380\d{9}$/.test(digits) ? `+${digits}` : undefined;
}

// Kept as the order-mapper boundary name; checkout only permits Ukrainian numbers.
export const normalizePhoneForShopify = normalizeUaPhone;
