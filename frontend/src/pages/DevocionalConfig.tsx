import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import {
  BookOpen,
  Save,
  Clock,
  List,
  Bell,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface DevocionalConfig {
  id?: number;
  list_id?: number;
  dispatch_hour: number;
  dispatch_minute: number;
  timezone: string;
  notification_phone?: string;
  enabled: boolean;
}

interface ContactList {
  id: number;
  name: string;
  total_contacts: number;
  list_type: string;
}

interface Devocional {
  id: number;
  title: string;
  date: string;
  text: string;
  versiculo_principal?: {
    texto: string;
    referencia: string;
  };
  versiculo_apoio?: {
    texto: string;
    referencia: string;
  };
  metadata?: any;
}

export default function DevocionalConfig() {
  const [config, setConfig] = useState<DevocionalConfig>({
    dispatch_hour: 6,
    dispatch_minute: 0,
    timezone: 'America/Sao_Paulo',
    enabled: true,
  });
  const [lists, setLists] = useState<ContactList[]>([]);
  const [todayDevocional, setTodayDevocional] = useState<Devocional | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadConfig();
    loadLists();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get('/devocional/config');
      if (response.data.config) {
        setConfig(response.data.config);
      }
      if (response.data.today_devocional) {
        setTodayDevocional(response.data.today_devocional);
      }
    } catch (error: any) {
      console.error('Erro ao carregar configuração:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao carregar configuração',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadLists = async () => {
    try {
      const response = await api.get('/lists');
      setLists(response.data.lists || []);
    } catch (error) {
      console.error('Erro ao carregar listas:', error);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/devocional/config', config);
      setToast({
        message: 'Configuração salva com sucesso!',
        type: 'success'
      });
    } catch (error: any) {
      console.error('Erro ao salvar configuração:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao salvar configuração',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p>Carregando configuração...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          Configuração do Devocional
        </h1>
        <p className="text-gray-600 text-sm ml-13">
          Configure o disparo automático diário de devocionais
        </p>
      </div>

      {/* Configurações */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        {/* Lista de Contatos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <List className="h-4 w-4" />
            Lista de Contatos *
          </label>
          <select
            value={config.list_id || ''}
            onChange={(e) => setConfig({ ...config, list_id: e.target.value ? parseInt(e.target.value) : undefined })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="">Selecione uma lista</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.total_contacts || 0} contatos) - {list.list_type}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            A lista deve ter contatos com tag "devocional" e WhatsApp validado
          </p>
        </div>

        {/* Horário de Disparo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Horário de Disparo (America/São_Paulo)
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Hora</label>
              <input
                type="number"
                min="0"
                max="23"
                value={config.dispatch_hour}
                onChange={(e) => setConfig({ ...config, dispatch_hour: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Minuto</label>
              <input
                type="number"
                min="0"
                max="59"
                value={config.dispatch_minute}
                onChange={(e) => setConfig({ ...config, dispatch_minute: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            O disparo será executado automaticamente todos os dias às {String(config.dispatch_hour).padStart(2, '0')}:{String(config.dispatch_minute).padStart(2, '0')} (horário de Brasília)
          </p>
        </div>

        {/* Telefone para Notificações */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Telefone para Notificações (opcional)
          </label>
          <input
            type="text"
            value={config.notification_phone || ''}
            onChange={(e) => setConfig({ ...config, notification_phone: e.target.value })}
            placeholder="5516999999999"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">
            Receberá notificações quando o disparo iniciar, concluir ou houver erros
          </p>
        </div>

        {/* Habilitado/Desabilitado */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Disparo Automático Habilitado
            </label>
            <p className="text-xs text-gray-600">
              Quando habilitado, o sistema dispara automaticamente todos os dias no horário configurado
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
          </label>
        </div>

        {/* Devocional do Dia */}
        {todayDevocional ? (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="h-6 w-6 text-green-600" />
              <div>
                <h3 className="text-lg font-bold text-gray-900">Devocional de Hoje</h3>
                <p className="text-sm text-gray-600">
                  {new Date(todayDevocional.date).toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <h4 className="font-semibold text-gray-900 mb-2">{todayDevocional.title}</h4>
              {todayDevocional.versiculo_principal && (
                <div className="mb-2 text-sm text-gray-700">
                  <span className="font-medium">Versículo Principal:</span>{' '}
                  {todayDevocional.versiculo_principal.referencia}
                </div>
              )}
              <div className="text-sm text-gray-600 line-clamp-3">
                {todayDevocional.text.substring(0, 200)}...
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-900">
                <p className="font-semibold">⚠️ Nenhum devocional encontrado para hoje</p>
                <p className="text-yellow-800 mt-1">
                  O N8N deve criar o devocional às 3:30 da manhã. Verifique se o workflow está funcionando.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Informações Importantes */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-2">ℹ️ Como funciona:</p>
              <ul className="space-y-1 text-blue-800">
                <li>• O N8N cria o devocional às 3:30 da manhã</li>
                <li>• O sistema dispara automaticamente às {String(config.dispatch_hour).padStart(2, '0')}:{String(config.dispatch_minute).padStart(2, '0')}</li>
                <li>• A mensagem é personalizada com saudação (Bom dia/Tarde/Noite) + primeiro nome</li>
                <li>• Contatos são validados automaticamente (WhatsApp + opt-in)</li>
                <li>• Sistema de pontuação: após 3 falhas consecutivas, contato é tagado como "bloqueado"</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Botão Salvar */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <Button
            onClick={handleSave}
            disabled={saving || !config.list_id}
            className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Salvar Configuração
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
            toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          } text-white z-50 flex items-center gap-2`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}
