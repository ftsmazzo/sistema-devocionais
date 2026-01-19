import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import {
  Megaphone,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Link,
  Key,
} from 'lucide-react';

interface MarketingConfig {
  id?: number;
  ai_webhook_url?: string;
  positive_keywords: string[];
  sentiment_analysis_enabled: boolean;
  enabled: boolean;
}

export default function MarketingConfig() {
  const [config, setConfig] = useState<MarketingConfig>({
    positive_keywords: ['interesse', 'quero', 'me chama', 'gostei'],
    sentiment_analysis_enabled: true,
    enabled: true,
  });
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get('/marketing/config');
      if (response.data.config) {
        setConfig(response.data.config);
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

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/marketing/config', config);
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

  const addKeyword = () => {
    if (newKeyword.trim() && !config.positive_keywords.includes(newKeyword.trim().toLowerCase())) {
      setConfig({
        ...config,
        positive_keywords: [...config.positive_keywords, newKeyword.trim().toLowerCase()],
      });
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setConfig({
      ...config,
      positive_keywords: config.positive_keywords.filter((k) => k !== keyword),
    });
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
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
            <Megaphone className="h-6 w-6 text-white" />
          </div>
          Configuração do Marketing
        </h1>
        <p className="text-gray-600 text-sm ml-13">
          Configure a integração com IA para respostas automáticas
        </p>
      </div>

      {/* Configurações */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        {/* Webhook da IA Externa */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Link className="h-4 w-4" />
            URL do Webhook da IA Externa *
          </label>
          <input
            type="url"
            value={config.ai_webhook_url || ''}
            onChange={(e) => setConfig({ ...config, ai_webhook_url: e.target.value })}
            placeholder="https://sua-ia.com/webhook"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">
            Quando detectar intenção positiva, o sistema enviará para este webhook:
            dispatch_id, contact_name, contact_phone, user_message, dispatch_content
          </p>
        </div>

        {/* Palavras-chave Positivas */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Key className="h-4 w-4" />
            Palavras-chave de Resposta Positiva
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
              placeholder="Digite uma palavra-chave"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <Button onClick={addKeyword} variant="outline">
              Adicionar
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {config.positive_keywords.map((keyword) => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
              >
                {keyword}
                <button
                  onClick={() => removeKeyword(keyword)}
                  className="hover:text-blue-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Mensagens contendo essas palavras serão consideradas respostas positivas
          </p>
        </div>

        {/* Análise de Sentimento */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Análise de Sentimento (OpenAI)
            </label>
            <p className="text-xs text-gray-600">
              Usa OpenAI para analisar o sentimento da mensagem além das palavras-chave
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.sentiment_analysis_enabled}
              onChange={(e) => setConfig({ ...config, sentiment_analysis_enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>

        {/* Habilitado/Desabilitado */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sistema de IA Habilitado
            </label>
            <p className="text-xs text-gray-600">
              Quando habilitado, respostas positivas são enviadas para a IA externa
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>

        {/* Informações Importantes */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-2">ℹ️ Como funciona:</p>
              <ul className="space-y-1 text-blue-800">
                <li>• Quando um contato responde a um disparo de marketing</li>
                <li>• Sistema verifica palavras-chave e/ou análise de sentimento</li>
                <li>• Se positivo, envia para IA externa: dispatch_id, nome, telefone e mensagem</li>
                <li>• IA externa recebe e inicia a conversa automaticamente</li>
                <li>• Sistema registra a interação no banco de dados</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Botão Salvar */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <Button
            onClick={handleSave}
            disabled={saving || !config.ai_webhook_url}
            className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
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
