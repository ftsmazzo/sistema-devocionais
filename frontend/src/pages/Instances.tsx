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
  LogOut,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

interface Instance {
  id: number;
  name: string;
  api_key: string;
  api_url: string;
  instance_name: string;
  status: 'connected' | 'disconnected' | 'connecting';
  qr_code?: string;
  last_connection?: string;
  created_at: string;
}

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    api_key: '',
    api_url: '',
    instance_name: '',
  });
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

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
      setFormData({ name: '', api_key: '', api_url: '', instance_name: '' });
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
        // Mostrar QR code em modal
        alert('QR Code gerado! Escaneie com o WhatsApp.');
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
      await api.get(`/instances/${id}/status`);
      loadInstances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao verificar status');
    } finally {
      setRefreshing(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'connecting':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <XCircle className="h-5 w-5 text-gray-400" />;
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-bold">Evolution Manager</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{user?.name}</span>
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                Sair
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Instâncias</h2>
            <p className="text-muted-foreground mt-1">Gerencie suas instâncias do Evolution API</p>
          </div>
          <Button onClick={() => setShowModal(true)}>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {instances.map((instance) => (
              <Card key={instance.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">{instance.name}</CardTitle>
                      <CardDescription className="mt-1">{instance.instance_name}</CardDescription>
                    </div>
                    {getStatusIcon(instance.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="font-medium">{getStatusText(instance.status)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">API URL</p>
                      <p className="text-sm truncate">{instance.api_url}</p>
                    </div>
                    {instance.last_connection && (
                      <div>
                        <p className="text-xs text-muted-foreground">Última Conexão</p>
                        <p className="text-sm">
                          {new Date(instance.last_connection).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      {instance.status === 'disconnected' ? (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleConnect(instance.id)}
                          disabled={refreshing === instance.id}
                          className="flex-1"
                        >
                          {refreshing === instance.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Power className="h-4 w-4 mr-2" />
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
                          className="flex-1"
                        >
                          {refreshing === instance.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <PowerOff className="h-4 w-4 mr-2" />
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
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${refreshing === instance.id ? 'animate-spin' : ''}`}
                        />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingInstance(instance);
                          setFormData({
                            name: instance.name,
                            api_key: instance.api_key,
                            api_url: instance.api_url,
                            instance_name: instance.instance_name,
                          });
                          setShowModal(true);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(instance.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{editingInstance ? 'Editar' : 'Nova'} Instância</CardTitle>
              <CardDescription>Preencha os dados da instância do Evolution API</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Nome</label>
                  <Input
                    value={formData.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Minha Instância"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Instance Name</label>
                  <Input
                    value={formData.instance_name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFormData({ ...formData, instance_name: e.target.value })
                    }
                    placeholder="instance-01"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">API URL</label>
                  <Input
                    value={formData.api_url}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, api_url: e.target.value })}
                    placeholder="http://localhost:8080"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">API Key</label>
                  <Input
                    type="password"
                    value={formData.api_key}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder="sua-api-key"
                    required
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowModal(false);
                      setEditingInstance(null);
                      setFormData({ name: '', api_key: '', api_url: '', instance_name: '' });
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
    </div>
  );
}
