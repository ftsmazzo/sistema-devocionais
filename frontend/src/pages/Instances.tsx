import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
} from 'lucide-react';

interface Instance {
  id: number;
  name: string;
  instance_name: string;
  status: 'connected' | 'disconnected' | 'connecting';
  phone_number?: string;
  qr_code?: string;
  last_connection?: string;
  created_at: string;
}

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrInstanceName, setQrInstanceName] = useState<string>('');
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    instance_name: '',
  });
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadInstances();
  }, [user, navigate]);

  const loadInstances = async () => {
    try {
      const response = await api.get('/instances');
      setInstances(response.data.instances);
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingInstance) {
        await api.put(`/instances/${editingInstance.id}`, formData);
      } else {
        await api.post('/instances', formData);
      }
      setShowModal(false);
      setEditingInstance(null);
      setFormData({ name: '', instance_name: '' });
      loadInstances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao salvar instância');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta instância?')) return;
    try {
      await api.delete(`/instances/${id}`);
      loadInstances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao deletar instância');
    }
  };

  const handleConnect = async (id: number) => {
    setRefreshing(id);
    try {
      const response = await api.post(`/instances/${id}/connect`);
      if (response.data.qr_code) {
        const instance = instances.find((inst) => inst.id === id);
        setQrCode(response.data.qr_code);
        setQrInstanceName(instance?.name || 'Instância');
        setShowQrModal(true);
      }
      loadInstances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao conectar instância');
    } finally {
      setRefreshing(null);
    }
  };

  const handleDisconnect = async (id: number) => {
    setRefreshing(id);
    try {
      await api.post(`/instances/${id}/disconnect`);
      loadInstances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao desconectar instância');
    } finally {
      setRefreshing(null);
    }
  };

  const handleCheckStatus = async (id: number) => {
    setRefreshing(id);
    try {
      const response = await api.get(`/instances/${id}/status`);
      console.log('Status atualizado:', response.data);
      loadInstances();
    } catch (error: any) {
      console.error('Erro ao verificar status:', error);
      alert(error.response?.data?.error || error.response?.data?.message || 'Erro ao verificar status');
    } finally {
      setRefreshing(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'connecting':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected':
        return 'Conectado';
      case 'connecting':
        return 'Conectando';
      default:
        return 'Desconectado';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Main Content */}
      <div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-1">
              Instâncias WhatsApp
            </h2>
            <p className="text-gray-500 text-sm">Gerencie e configure suas instâncias</p>
          </div>
          <Button 
            onClick={() => setShowModal(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md shadow-indigo-500/30 rounded-xl px-6"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova Instância
          </Button>
        </div>

        {/* Instances Grid */}
        {instances.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhuma instância cadastrada</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
            {instances.map((instance) => (
              <Card key={instance.id} className="hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300 border border-gray-200 hover:border-indigo-300 bg-white rounded-lg overflow-hidden group">
                <CardHeader className="pb-2.5 bg-gradient-to-br from-gray-50 to-white border-b border-gray-100">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-bold text-gray-900 mb-0.5 truncate">
                        {instance.name}
                      </CardTitle>
                      <CardDescription className="text-xs font-mono text-gray-400 truncate">
                        {instance.instance_name}
                      </CardDescription>
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {getStatusIcon(instance.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-2.5">
                  <div className="space-y-2">
                    {/* Status Badge */}
                    <div className="flex items-center justify-between p-1.5 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-xs font-medium text-gray-600">Status</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                        instance.status === 'connected' 
                          ? 'bg-green-100 text-green-700' 
                          : instance.status === 'connecting'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {getStatusText(instance.status)}
                      </span>
                    </div>

                    {/* Número de Telefone */}
                    {instance.phone_number ? (
                      <div className="flex items-center gap-1.5 p-2 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg border border-indigo-100">
                        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-blue-600 font-medium">Telefone</p>
                          <p className="text-xs font-semibold text-blue-900 truncate">
                            {instance.phone_number}
                          </p>
                        </div>
                      </div>
                    ) : instance.status === 'connected' ? (
                      <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                        <p className="text-xs text-gray-400">Número não disponível</p>
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-50 rounded-lg border border-amber-100">
                        <p className="text-xs text-amber-600">Conecte para ver o número</p>
                      </div>
                    )}
                    {/* Botões de Ação */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-100">
                      <div className="flex gap-1.5">
                        {instance.status === 'disconnected' ? (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleConnect(instance.id)}
                            disabled={refreshing === instance.id}
                            className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-lg shadow-sm text-xs py-1.5"
                          >
                            {refreshing === instance.id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Power className="h-3 w-3 mr-1" />
                                Conectar
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDisconnect(instance.id)}
                            disabled={refreshing === instance.id}
                            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg text-xs py-1.5"
                          >
                            {refreshing === instance.id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <PowerOff className="h-3 w-3 mr-1" />
                                Desconectar
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCheckStatus(instance.id)}
                          disabled={refreshing === instance.id}
                          title="Atualizar status"
                          className="px-2 rounded-lg"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${refreshing === instance.id ? 'animate-spin' : ''}`}
                          />
                        </Button>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingInstance(instance);
                            setFormData({
                              name: instance.name,
                              instance_name: instance.instance_name,
                            });
                            setShowModal(true);
                          }}
                          className="flex-1 rounded-lg text-xs py-1.5"
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(instance.id)}
                          className="px-2 rounded-lg"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => navigate(`/blindage/${instance.id}`)}
                        className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-lg shadow-sm text-xs py-1.5"
                      >
                        <Shield className="h-3 w-3 mr-1" />
                        Configurar Blindagem
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Formulário */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-2xl">{editingInstance ? 'Editar' : 'Nova'} Instância</CardTitle>
              <CardDescription>
                {editingInstance 
                  ? 'Atualize os dados da instância' 
                  : 'Crie uma nova instância do Evolution API. API Key e URL são configuradas automaticamente.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block text-gray-700">
                    Nome da Instância
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Instância Principal"
                    required
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">Nome amigável para identificar esta instância</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block text-gray-700">
                    Instance Name
                  </label>
                  <Input
                    value={formData.instance_name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFormData({ ...formData, instance_name: e.target.value })
                    }
                    placeholder="Ex: instance-01"
                    required
                    className="w-full font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1">Nome técnico usado na Evolution API (sem espaços)</p>
                </div>
                {!editingInstance && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-800">
                      <strong>ℹ️ Nota:</strong> API Key e API URL serão obtidas automaticamente das variáveis de ambiente.
                    </p>
                  </div>
                )}
                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowModal(false);
                      setEditingInstance(null);
                      setFormData({ name: '', instance_name: '' });
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" className="flex-1">
                    Salvar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal de QR Code */}
      {showQrModal && qrCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Escaneie o QR Code</CardTitle>
              <CardDescription>
                Escaneie este QR code com o WhatsApp para conectar a instância <strong>{qrInstanceName}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-center bg-white p-4 rounded-lg">
                <img src={qrCode} alt="QR Code" className="max-w-full h-auto" />
              </div>
              <div className="text-center text-sm text-muted-foreground">
                <p>1. Abra o WhatsApp no seu celular</p>
                <p>2. Vá em Configurações → Aparelhos conectados</p>
                <p>3. Toque em "Conectar um aparelho"</p>
                <p>4. Escaneie este QR code</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShowQrModal(false);
                  setQrCode(null);
                  setQrInstanceName('');
                }}
              >
                Fechar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
