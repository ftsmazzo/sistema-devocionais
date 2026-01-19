import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import {
  Send,
  Plus,
  Play,
  Square,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  BookOpen,
  Megaphone,
  RefreshCw,
  X,
  AlertCircle,
} from 'lucide-react';

interface Dispatch {
  id: number;
  name: string;
  dispatch_type: 'devocional' | 'marketing' | 'individual';
  status: 'pending' | 'running' | 'completed' | 'stopped' | 'failed';
  total_contacts: number;
  contacts_processed: number;
  contacts_success: number;
  contacts_failed: number;
  list_name?: string;
  list_type?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

interface FormData {
  name: string;
  list_id: string;
  message_template: string;
  instance_ids: number[];
  media_url?: string;
  media_type?: 'image' | 'pdf' | 'document';
}

export default function Dispatches() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dispatchType, setDispatchType] = useState<'devocional' | 'marketing'>('marketing');
  const [formData, setFormData] = useState<FormData>({
    name: '',
    list_id: '',
    message_template: '',
    instance_ids: [],
    media_url: '',
    media_type: undefined,
  });
  const [lists, setLists] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [startingDispatch, setStartingDispatch] = useState<number | null>(null);
  const [creatingDispatch, setCreatingDispatch] = useState(false);

  useEffect(() => {
    loadDispatches();
    loadLists();
    loadInstances();
  }, []);

  const loadDispatches = async () => {
    try {
      setLoading(true);
      const response = await api.get('/dispatches');
      setDispatches(response.data.dispatches || []);
    } catch (error: any) {
      console.error('Erro ao carregar disparos:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao carregar disparos',
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

  const loadInstances = async () => {
    try {
      const response = await api.get('/instances');
      setInstances(response.data.instances?.filter((i: any) => i.status === 'connected') || []);
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error);
    }
  };

  const handleCreate = async () => {
    // Prevenir duplo clique
    if (creatingDispatch) {
      return;
    }

    try {
      if (!formData.name) {
        setToast({ message: 'Nome é obrigatório', type: 'error' });
        return;
      }

      if (dispatchType === 'devocional' && !formData.list_id) {
        setToast({ message: 'Lista é obrigatória para devocional', type: 'error' });
        return;
      }

      if (dispatchType === 'marketing' && !formData.message_template) {
        setToast({ message: 'Mensagem é obrigatória para marketing', type: 'error' });
        return;
      }

      setCreatingDispatch(true);

      const payload: any = {
        name: formData.name,
        list_id: parseInt(formData.list_id),
        instance_ids: formData.instance_ids,
      };

      if (dispatchType === 'marketing') {
        payload.message_template = formData.message_template;
        if (formData.media_url) {
          payload.media_url = formData.media_url;
          payload.media_type = formData.media_type || 'image';
        }
      }

      await api.post(`/dispatches/${dispatchType}`, payload);

      setToast({ message: 'Disparo criado com sucesso!', type: 'success' });
      setShowCreateModal(false);
      setFormData({ name: '', list_id: '', message_template: '', instance_ids: [], media_url: '', media_type: undefined });
      await loadDispatches();
    } catch (error: any) {
      console.error('Erro ao criar disparo:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao criar disparo',
        type: 'error'
      });
    } finally {
      setCreatingDispatch(false);
    }
  };

  const handleStart = async (id: number) => {
    // Prevenir duplo clique
    if (startingDispatch === id) {
      return;
    }

    try {
      setStartingDispatch(id);
      await api.post(`/dispatches/${id}/start`);
      setToast({ message: 'Disparo iniciado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao iniciar disparo',
        type: 'error'
      });
    } finally {
      setStartingDispatch(null);
    }
  };

  const handleStop = async (id: number) => {
    try {
      await api.post(`/dispatches/${id}/stop`);
      setToast({ message: 'Disparo parado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao parar disparo',
        type: 'error'
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar este disparo?')) return;

    try {
      await api.delete(`/dispatches/${id}`);
      setToast({ message: 'Disparo deletado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao deletar disparo',
        type: 'error'
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'stopped':
        return <Square className="h-4 w-4 text-gray-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'Pendente',
      running: 'Em execução',
      completed: 'Concluído',
      stopped: 'Parado',
      failed: 'Falhou',
    };
    return statusMap[status] || status;
  };

  const getTypeIcon = (type: string) => {
    return type === 'devocional' ? (
      <BookOpen className="h-5 w-5" />
    ) : (
      <Megaphone className="h-5 w-5" />
    );
  };

  const getTypeColor = (type: string) => {
    return type === 'devocional'
      ? 'from-green-500 to-emerald-500'
      : 'from-blue-500 to-cyan-500';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p>Carregando disparos...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
                <Send className="h-6 w-6 text-white" />
              </div>
              Disparos
            </h1>
            <p className="text-gray-600 text-sm ml-13">
              Gerencie seus disparos de marketing e testes de devocional
            </p>
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mt-4 rounded-r-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-900">
                  <p className="font-semibold mb-1">ℹ️ Sobre Disparos de Devocional:</p>
                  <p className="text-blue-800">
                    O disparo de devocional é <strong>automático</strong> e configurado na página <strong>"Config. Devocional"</strong>.
                    Ele dispara automaticamente todos os dias no horário configurado. Você não precisa criar disparos manuais de devocional aqui.
                    Esta página é apenas para <strong>disparos de marketing</strong> ou <strong>testes manuais</strong> de devocional.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Button
            onClick={() => {
              setShowCreateModal(true);
              setFormData({ name: '', list_id: '', message_template: '', instance_ids: [] });
            }}
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo Disparo
          </Button>
        </div>
      </div>

      {/* Lista de Disparos */}
      {dispatches.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Send className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Nenhum disparo criado
          </h3>
          <p className="text-gray-600 mb-6">
            Crie seu primeiro disparo para começar
          </p>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-500"
          >
            <Plus className="h-4 w-4 mr-2" />
            Criar Disparo
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {dispatches.map((dispatch) => (
            <div
              key={dispatch.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`w-10 h-10 bg-gradient-to-br ${getTypeColor(
                        dispatch.dispatch_type
                      )} rounded-xl flex items-center justify-center text-white shadow-md`}
                    >
                      {getTypeIcon(dispatch.dispatch_type)}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {dispatch.name}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span className="capitalize">{dispatch.dispatch_type}</span>
                        {dispatch.list_name && (
                          <>
                            <span>•</span>
                            <span>{dispatch.list_name}</span>
                          </>
                        )}
                        {dispatch.created_at && (
                          <>
                            <span>•</span>
                            <span>
                              {new Date(dispatch.created_at).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 mt-4">
                    {dispatch.dispatch_type === 'devocional' && dispatch.status === 'pending' && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                        ⚠️ Este é um disparo manual. O disparo automático está em "Config. Devocional"
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {getStatusIcon(dispatch.status)}
                      <span className="text-sm font-medium text-gray-700">
                        {getStatusText(dispatch.status)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">{dispatch.contacts_processed || 0}</span> /{' '}
                      <span>{dispatch.total_contacts || 0}</span> contatos
                    </div>
                    {dispatch.contacts_success > 0 && (
                      <div className="text-sm text-green-600">
                        ✓ {dispatch.contacts_success} enviados
                      </div>
                    )}
                    {dispatch.contacts_failed > 0 && (
                      <div className="text-sm text-red-600">
                        ✗ {dispatch.contacts_failed} falhas
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {dispatch.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStart(dispatch.id)}
                      disabled={startingDispatch === dispatch.id}
                      className="text-green-600 hover:text-green-700 disabled:opacity-50"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      {startingDispatch === dispatch.id ? 'Iniciando...' : 'Iniciar'}
                    </Button>
                  )}
                  {dispatch.status === 'running' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStop(dispatch.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Square className="h-4 w-4 mr-1" />
                      Parar
                    </Button>
                  )}
                  {dispatch.status !== 'running' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(dispatch.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criar Disparo */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Criar Novo Disparo</h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Tipo de Disparo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de Disparo
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setDispatchType('devocional')}
                    className={`p-4 rounded-xl border-2 transition-all relative ${
                      dispatchType === 'devocional'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="absolute top-2 right-2">
                      <span className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
                        TESTE
                      </span>
                    </div>
                    <BookOpen className="h-6 w-6 mx-auto mb-2 text-green-600" />
                    <div className="font-medium">Devocional (Teste)</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Apenas para testes manuais
                    </div>
                    <div className="text-xs text-yellow-700 mt-2 font-medium">
                      ⚠️ Disparo automático configurado em "Config. Devocional"
                    </div>
                  </button>
                  <button
                    onClick={() => setDispatchType('marketing')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      dispatchType === 'marketing'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Megaphone className="h-6 w-6 mx-auto mb-2 text-blue-600" />
                    <div className="font-medium">Marketing</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Campanhas promocionais
                    </div>
                  </button>
                </div>
              </div>

              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome do Disparo *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Ex: Devocional Diário - Janeiro 2026"
                />
              </div>

              {/* Lista */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lista de Contatos *
                </label>
                <select
                  value={formData.list_id}
                  onChange={(e) => setFormData({ ...formData, list_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Selecione uma lista</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name} ({list.total_contacts || 0} contatos)
                    </option>
                  ))}
                </select>
              </div>

              {/* Mensagem (apenas marketing) */}
              {dispatchType === 'marketing' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Mensagem *
                    </label>
                    <textarea
                      value={formData.message_template}
                      onChange={(e) =>
                        setFormData({ ...formData, message_template: e.target.value })
                      }
                      rows={6}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Digite a mensagem que será enviada..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de Mídia (Opcional)
                    </label>
                    <select
                      value={formData.media_type || ''}
                      onChange={(e) => setFormData({ ...formData, media_type: e.target.value as 'image' | 'pdf' | 'document' | undefined })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">Apenas texto</option>
                      <option value="image">Imagem</option>
                      <option value="pdf">PDF</option>
                      <option value="document">Documento</option>
                    </select>
                  </div>

                  {formData.media_type && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        URL da Mídia *
                      </label>
                      <input
                        type="url"
                        value={formData.media_url || ''}
                        onChange={(e) => setFormData({ ...formData, media_url: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder={`Cole a URL da ${formData.media_type === 'image' ? 'imagem' : formData.media_type === 'pdf' ? 'PDF' : 'documento'}...`}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Cole a URL completa da mídia (ex: https://exemplo.com/imagem.jpg)
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Instâncias */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Instâncias (opcional - deixe vazio para usar todas)
                </label>
                <div className="space-y-2">
                  {instances.map((instance) => (
                    <label key={instance.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.instance_ids.includes(instance.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              instance_ids: [...formData.instance_ids, instance.id],
                            });
                          } else {
                            setFormData({
                              ...formData,
                              instance_ids: formData.instance_ids.filter(
                                (id) => id !== instance.id
                              ),
                            });
                          }
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-gray-700">{instance.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowCreateModal(false)}
                disabled={creatingDispatch}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creatingDispatch}
                className="bg-gradient-to-r from-indigo-500 to-purple-500 disabled:opacity-50"
              >
                {creatingDispatch ? 'Criando...' : 'Criar Disparo'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
            toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          } text-white z-50`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
