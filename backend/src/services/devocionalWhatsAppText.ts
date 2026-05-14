/**
 * Normaliza texto de devocional para envio no WhatsApp (evita "\n" literal, ** indesejado, etc.).
 */
export function sanitizeDevocionalWhatsappText(raw: string): string {
  if (raw == null || typeof raw !== 'string') return '';
  let s = raw
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');

  // Markdown comum do modelo: **negrito** → *itálico* (alinhado às regras do prompt)
  s = s.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Espaços em branco excessivos entre blocos
  s = s.replace(/\n{4,}/g, '\n\n\n');

  return s.trim();
}

/** Limites na ingestão HTTP (webhook legado / integração externa). */
export const MAX_INGEST_TEXT_LENGTH = 100_000;
export const MAX_INGEST_TITLE_LENGTH = 400;

export function sanitizeIngestedDevocionalText(raw: unknown): string {
  const s = sanitizeDevocionalWhatsappText(typeof raw === 'string' ? raw : '');
  return s.slice(0, MAX_INGEST_TEXT_LENGTH);
}

export function sanitizeIngestedTitle(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.slice(0, MAX_INGEST_TITLE_LENGTH);
}

export function isValidDevocionalDateYmd(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}
