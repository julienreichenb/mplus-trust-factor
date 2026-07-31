/**
 * Mask an email for Account UI. Keep first two and last two characters of the
 * local part when possible; replace the hidden middle with exactly six asterisks;
 * keep the domain visible. Safe for short/malformed addresses.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (email == null) return null;
  const trimmed = email.trim();
  if (!trimmed) return null;

  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return "******";
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain || domain.includes("@")) {
    return "******";
  }

  if (local.length <= 4) {
    return `${"*".repeat(6)}@${domain}`;
  }

  const head = local.slice(0, 2);
  const tail = local.slice(-2);
  return `${head}${"*".repeat(6)}${tail}@${domain}`;
}
