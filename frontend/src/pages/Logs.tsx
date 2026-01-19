import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { RefreshCw, Trash2, Filter, X } from 'lucide-react';
import Button from '@/components/ui/Button';

interface Log {
  timestamp: string;
  level: string;
  message: string;
}

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadLogs();
    
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        loadLogs();
      }, 2000); // Atualizar a cada 2 segundos
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh]);

  useEffect(() => {
    // Scroll automático para o final
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadLogs = async () => {
    try {
      const params: any = { limit: 500 };
      if (filterLevel) {
        params.level = filterLevel;
      }
      
      const response = await api.get('/logs', { params });
      setLogs(response.data.logs || []);
    } catch (error: any) {
      console.error('Erro ao carregar logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      await api.delete('/logs');
      setLogs([]);
    } catch (error: any) {
      console.error('Erro ao limpar logs:', error);
    }
  };

  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
      case '❌':
        return 'text-red-600 bg-red-50';
      case 'warning':
      case '⚠️':
        return 'text-yellow-600 bg-yellow-50';
      case 'success':
      case '✅':
        return 'text-green-600 bg-green-50';
      case 'info':
      case 'ℹ️':
        return 'text-blue-600 bg-blue-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const filteredLogs = logs.filter(log => {
    if (searchTerm) {
      return log.message.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
            <RefreshCw className="h-6 w-6 text-white" />
          </div>
          Logs do Sistema
        </h1>
        <p className="text-gray-600 text-sm">
          Visualize os logs em tempo real do sistema
        </p>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoRefresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
            />
            <label htmlFor="autoRefresh" className="text-sm font-medium text-gray-700">
              Atualização automática (2s)
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Todos os níveis</option>
              <option value="error">Erro</option>
              <option value="warning">Aviso</option>
              <option value="info">Info</option>
              <option value="success">Sucesso</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Buscar nos logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <Button
            onClick={loadLogs}
            className="bg-indigo-500 hover:bg-indigo-600"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>

          <Button
            onClick={clearLogs}
            className="bg-red-500 hover:bg-red-600"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Limpar
          </Button>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-gray-900 rounded-xl shadow-lg border border-gray-800 p-4 h-[calc(100vh-300px)] overflow-y-auto font-mono text-sm">
        {loading && logs.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p>Carregando logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <p>Nenhum log encontrado</p>
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={index}
              className={`mb-1 px-2 py-1 rounded ${getLevelColor(log.level)}`}
            >
              <span className="text-gray-400 text-xs mr-2">
                {formatTimestamp(log.timestamp)}
              </span>
              <span className="font-semibold mr-2">[{log.level}]</span>
              <span className="whitespace-pre-wrap break-words">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Estatísticas */}
      <div className="mt-4 text-sm text-gray-600">
        <p>
          Total: {logs.length} logs | 
          Exibindo: {filteredLogs.length} logs
          {autoRefresh && <span className="ml-2 text-green-600">● Atualizando...</span>}
        </p>
      </div>
    </div>
  );
}
