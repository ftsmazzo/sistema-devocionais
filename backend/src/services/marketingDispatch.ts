/**
 * Enfileira disparos de marketing/personalizada em dispatch_items.
 * Compat: delega ao pipeline oficial de mensagem personalizada.
 */
import { addLog } from '../routes/logs';
import {
  enqueuePersonalizadaDispatch,
  PersonalizadaDispatchError,
} from './personalizadaDispatch';
import { DispatchOperationalError } from './dispatchRuntimeConfig';

interface MarketingDispatchParams {
  dispatchId: number;
  instanceIds?: number[];
}

/**
 * Processar disparo de marketing = apenas enfileirar itens para o worker.
 */
export async function processMarketingDispatch(params: MarketingDispatchParams): Promise<void> {
  const { dispatchId, instanceIds } = params;

  try {
    const logMsg = `📢 Enfileirando disparo marketing/personalizada ID ${dispatchId} (worker)`;
    console.log(logMsg);
    addLog('info', logMsg);

    await enqueuePersonalizadaDispatch({ dispatchId, instanceIds });
  } catch (error: any) {
    console.error(`❌ Erro ao processar disparo de marketing:`, error);
    if (error instanceof PersonalizadaDispatchError) {
      addLog('error', `[Marketing ${dispatchId}] ${error.message}`);
      // 422 pendente WA já marca completed no enqueue; outros erros: failed
      if (error.status !== 422) {
        const { pool } = await import('../database');
        await pool.query(
          `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'running'`,
          [dispatchId]
        );
      }
      return;
    }
    if (error instanceof DispatchOperationalError) {
      addLog('error', `[Marketing ${dispatchId}] ${error.message}`);
    }
    const { pool } = await import('../database');
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
  }
}
