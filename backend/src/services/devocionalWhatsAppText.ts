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
