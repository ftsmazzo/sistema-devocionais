import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Armazenar logs em memória (últimos 1000 logs)
const logs: Array<{ timestamp: string; level: string; message: string }> = [];
const MAX_LOGS = 1000;

// Função para adicionar log (será chamada pelos serviços)
export function addLog(level: string, message: string) {
  const timestamp = new Date().toISOString();
  logs.push({ timestamp, level, message });
  
  // Manter apenas os últimos MAX_LOGS
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  
  // Log também no console
  console.log(`[${timestamp}] [${level}] ${message}`);
}

/**
 * GET /api/logs
 * Retorna os logs em tempo real
 */
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { since, level, limit = 500 } = req.query;
    
    let filteredLogs = [...logs];
    
    // Filtrar por timestamp (se fornecido)
    if (since) {
      const sinceDate = new Date(since as string);
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) > sinceDate);
    }
    
    // Filtrar por nível (se fornecido)
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }
    
    // Limitar quantidade
    const limitNum = parseInt(limit as string, 10);
    filteredLogs = filteredLogs.slice(-limitNum);
    
    res.json({
      logs: filteredLogs,
      total: logs.length,
      filtered: filteredLogs.length
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar logs:', error);
    res.status(500).json({
      error: 'Erro ao buscar logs',
      message: error.message
    });
  }
});

/**
 * DELETE /api/logs
 * Limpar logs
 */
router.delete('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    logs.length = 0;
    res.json({ success: true, message: 'Logs limpos com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao limpar logs:', error);
    res.status(500).json({
      error: 'Erro ao limpar logs',
      message: error.message
    });
  }
});

export default router;
