/**
 * Fila global (in-process) para trechos blindagem → delay → envio HTTP.
 * Garante que não haja corrida entre disparos paralelos no mesmo processo Node
 * e que o próximo `applyBlindage` só rode depois do anterior terminar (incluindo sleep).
 *
 * Limitação: com múltiplas réplicas do backend, cada processo tem sua própria fila;
 * para lock distribuído use Postgres advisory lock ou Redis.
 *
 * Desativar: GLOBAL_OUTBOUND_GATE=false
 */

let gateTail: Promise<void> = Promise.resolve();

export function withGlobalOutboundGate<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.GLOBAL_OUTBOUND_GATE === 'false') {
    return fn();
  }

  const run: Promise<T> = gateTail.then(() => fn());
  gateTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
