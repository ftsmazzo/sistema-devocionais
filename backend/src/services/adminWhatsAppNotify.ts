/**
 * Notificações administrativas via WhatsApp (fora do pipeline de campanha).
 * Usa evolutionSafeSender; respeita DISPATCH_REAL_SEND_ENABLED.
 */
import { pool } from '../database';
import { maskPhone, sendEvolutionTextSafely } from './evolutionSafeSender';
import { isDispatchRealSendEnabled } from './dispatchRuntimeConfig';

export async function sendAdminWhatsAppNotification(
  phone: string | null | undefined,
  message: string
): Promise<void> {
  if (!phone) return;
  if (!isDispatchRealSendEnabled()) {
    console.log(`   📲 [notify] omitida (REAL_SEND off) → ${maskPhone(phone)}`);
    return;
  }

  try {
    const instanceResult = await pool.query(
      `SELECT id
       FROM instances
       WHERE status = 'connected'
       ORDER BY last_message_sent_at ASC NULLS FIRST
       LIMIT 1`
    );
    if (instanceResult.rows.length === 0) return;

    await sendEvolutionTextSafely({
      instanceId: instanceResult.rows[0].id,
      number: phone,
      text: message,
      messageType: 'notification',
    });
    console.log(`   📲 Notificação enviada para ${maskPhone(phone)}`);
  } catch (error: any) {
    console.error(`   ⚠️ Erro ao enviar notificação:`, error.message);
  }
}
