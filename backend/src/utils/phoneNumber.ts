/**
 * Normalização de telefone para cache, Evolution API e blindagem.
 * Evita duplicar DDI (ex.: 5517997295191 + 55 → 555517997295191).
 */
export function normalizePhoneDigits(
  phone: string,
  defaultCountryCode = '55'
): string {
  const cc = String(defaultCountryCode || '55').replace(/\D/g, '') || '55';
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return digits;

  // Corrige bases já gravadas com DDI duplicado
  while (cc.length > 0 && digits.startsWith(cc + cc)) {
    digits = digits.slice(cc.length);
  }

  if (cc && digits.startsWith(cc)) {
    return digits;
  }

  // BR: celular/fixo local sem DDI (10–11 dígitos)
  if (cc === '55' && digits.length >= 10 && digits.length <= 11) {
    return `${cc}${digits}`;
  }

  if (cc) {
    return `${cc}${digits}`;
  }

  return digits;
}

export function normalizePhoneE164(
  phone: string,
  defaultCountryCode = '55'
): string {
  const digits = normalizePhoneDigits(phone, defaultCountryCode);
  return digits ? `+${digits}` : '';
}

/**
 * Formato canônico para gravar em contacts.phone_number (BR: 55 + DDD + número).
 * Usar em modal interno, importação CSV e qualquer API autenticada.
 */
export function normalizeContactPhoneForStorage(
  input: string
): { ok: true; phone: string } | { ok: false; error: string } {
  const phone = normalizePhoneDigits(input, '55');
  if (!phone) {
    return { ok: false, error: 'Informe o telefone.' };
  }
  if (phone.length < 12 || phone.length > 13) {
    return {
      ok: false,
      error:
        'Telefone inválido. Use só DDD + número (ex.: 17991234567) ou com DDI 55 (ex.: 5517991234567).',
    };
  }
  return { ok: true, phone };
}
