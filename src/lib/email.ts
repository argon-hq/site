/**
 * Formato aceito: algo@dominio.tld, sem espaços e com TLD de ao menos 2 letras.
 * Validação de formato apenas — a existência da caixa só é provada pela
 * confirmação por e-mail (REB-74).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Minúsculas e sem espaço nas pontas, conforme requisito de normalização. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}
