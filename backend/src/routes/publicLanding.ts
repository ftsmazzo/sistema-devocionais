import express from 'express';
import { z } from 'zod';
import { pool } from '../database';
import { checkWhatsAppNumber } from '../services/whatsappValidation';

const router = express.Router();

const bodySchema = z.object({
  /** DDD (2 dígitos), sem 55 */
  ddd: z.string().min(1).max(4),
  /** Apenas o número após o DDD (8 ou 9 dígitos) */
  telefone: z.string().min(1).max(12),
  name: z.string().min(2).max(200),
  email: z.string().max(255).optional(),
  /** Honeypot: deve ficar vazio */
  website: z.string().max(500).optional(),
});

/**
 * Monta E.164 Brasil (55 + DDD + número) a partir de DDD e telefone nacionais.
 */
function buildBrazilWhatsapp55(dddRaw: string, telefoneRaw: string): { ok: true; e164: string } | { ok: false; error: string } {
  const ddd = dddRaw.replace(/\D/g, '');
  const tel = telefoneRaw.replace(/\D/g, '');

  if (ddd.length !== 2) {
    return { ok: false, error: 'Informe o DDD com 2 dígitos (ex.: 11).' };
  }
  if (ddd.startsWith('0')) {
    return { ok: false, error: 'DDD inválido: não use zero à esquerda.' };
  }

  if (tel.length < 8 || tel.length > 9) {
    return {
      ok: false,
      error: 'Informe o telefone com 8 dígitos (fixo) ou 9 (celular), sem o DDD.',
    };
  }

  const national = ddd + tel;
  if (national.length !== 10 && national.length !== 11) {
    return { ok: false, error: 'Combinação DDD + telefone inválida.' };
  }

  return { ok: true, e164: `55${national}` };
}

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 20;
const rateByIp = new Map<string, { n: number; t: number }>();

function clientIp(req: express.Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateOk(ip: string): boolean {
  const now = Date.now();
  const e = rateByIp.get(ip);
  if (!e || now - e.t > RATE_WINDOW_MS) {
    rateByIp.set(ip, { n: 1, t: now });
    return true;
  }
  if (e.n >= RATE_MAX) return false;
  e.n++;
  return true;
}

/**
 * Inscrição pública para receber o Devocional (opt-in + tag devocional).
 * POST /api/public/inscricao-devocional
 */
router.post('/inscricao-devocional', async (req, res) => {
  try {
    if (process.env.LANDING_INSCRICAO_ENABLED === 'false') {
      return res.status(503).json({ error: 'Inscrições temporariamente indisponíveis.' });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const { ddd, telefone, name, email, website } = parsed.data;
    if (website && String(website).trim().length > 0) {
      return res.json({ success: true, message: 'Obrigado!' });
    }

    const ip = clientIp(req);
    if (!rateOk(ip)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }

    const built = buildBrazilWhatsapp55(ddd, telefone);
    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }
    const normalizedPhone = built.e164;
    const nameTrim = name.trim();
    let emailTrim = email?.trim() || null;
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      emailTrim = null;
    }

    const metadata = {
      landing_inscricao: true,
      landing_at: new Date().toISOString(),
    };

    const client = await pool.connect();
    let contactId: number;
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO contacts (phone_number, name, email, source, metadata, opt_in, opt_in_at, opt_out, opt_out_at)
         VALUES ($1, $2, $3, 'landing_devocional', $4, TRUE, CURRENT_TIMESTAMP, FALSE, NULL)
         ON CONFLICT (phone_number)
         DO UPDATE SET
           name = COALESCE(EXCLUDED.name, contacts.name),
           email = COALESCE(EXCLUDED.email, contacts.email),
           metadata = contacts.metadata || EXCLUDED.metadata,
           opt_in = TRUE,
           opt_in_at = CURRENT_TIMESTAMP,
           opt_out = FALSE,
           opt_out_at = NULL,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [normalizedPhone, nameTrim, emailTrim, JSON.stringify(metadata)]
      );

      contactId = ins.rows[0].id as number;

      let tagResult = await client.query(
        `SELECT id FROM contact_tags WHERE LOWER(name) = 'devocional' LIMIT 1`
      );
      let tagId = tagResult.rows[0]?.id as number | undefined;
      if (!tagId) {
        await client.query(
          `INSERT INTO contact_tags (name, color, category, description)
           VALUES ('devocional', '#10b981', 'devocional', 'Contatos que recebem o Devocional Diário')
           ON CONFLICT (name) DO NOTHING`
        );
        tagResult = await client.query(
          `SELECT id FROM contact_tags WHERE LOWER(name) = 'devocional' LIMIT 1`
        );
        tagId = tagResult.rows[0]?.id;
      }

      if (!tagId) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Não foi possível preparar a etiqueta do devocional.' });
      }

      await client.query(
        `INSERT INTO contact_tag_relations (contact_id, tag_id)
         VALUES ($1, $2)
         ON CONFLICT (contact_id, tag_id) DO NOTHING`,
        [contactId, tagId]
      );

      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }

    setImmediate(async () => {
      try {
        const { isValid } = await checkWhatsAppNumber(normalizedPhone);
        const blockedTagResult = await pool.query(
          `SELECT id FROM contact_tags WHERE LOWER(name) = 'bloqueado' LIMIT 1`
        );
        const blockedTagId = blockedTagResult.rows[0]?.id;

        await pool.query(
          `UPDATE contacts
           SET whatsapp_validated = $1,
               whatsapp_validated_at = ${isValid ? 'CURRENT_TIMESTAMP' : 'NULL'},
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [isValid, contactId]
        );

        if (!isValid && blockedTagId) {
          await pool.query(
            `INSERT INTO contact_tag_relations (contact_id, tag_id)
             VALUES ($1, $2)
             ON CONFLICT (contact_id, tag_id) DO NOTHING`,
            [contactId, blockedTagId]
          );
        } else if (isValid && blockedTagId) {
          await pool.query(
            `DELETE FROM contact_tag_relations WHERE contact_id = $1 AND tag_id = $2`,
            [contactId, blockedTagId]
          );
        }
      } catch (err) {
        console.error(`[landing] Erro ao validar WhatsApp do contato ${contactId}:`, err);
      }
    });

    return res.json({
      success: true,
      message: 'Tudo certo por aqui. Obrigado por se inscrever!',
    });
  } catch (error: any) {
    console.error('❌ Erro na inscrição pública (devocional):', error);
    return res.status(500).json({
      error: 'Não foi possível concluir a inscrição. Tente novamente mais tarde.',
    });
  }
});

export default router;
