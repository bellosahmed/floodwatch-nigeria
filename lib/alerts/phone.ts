// Nigerian mobile numbers, normalised to digits only with the country code: 2348012345678.
// Accepts how people really type them: 08012345678, 8012345678, +234 801 234 5678, 0801-234-5678.

// 234 + 10 digits. Nigerian mobile prefixes are 70x, 71x, 80x, 81x, 90x, 91x (MTN, Airtel, Glo, 9mobile and others).
const MOBILE = /^234[789][01]\d{8}$/;

export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;

  let full: string;
  if (digits.startsWith("234")) full = digits;
  else if (digits.startsWith("0")) full = `234${digits.slice(1)}`;
  else full = `234${digits}`;

  return MOBILE.test(full) ? full : null;
}

/** "+2348012345678" for providers that want E.164. */
export const toE164 = (digits: string) => `+${digits}`;

/** "+234 80•• ••• 5678": enough to recognise your own number, not enough to reuse it. */
export const maskPhone = (digits: string) => `+${digits.slice(0, 3)} ${digits.slice(3, 5)}•• ••• ${digits.slice(-4)}`;
