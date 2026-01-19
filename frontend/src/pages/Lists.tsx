import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import Toast from '@/components/ui/Toast';
import Switch from '@/components/ui/Switch';
import {
  List,
  Plus,
  Edit,
  Trash2,
  Users,
  Filter,
  RefreshCw,
  Eye,
} from 'lucide-react';

interface ContactList {
  id: number;
  name: string;
  description?: string;
  list_type: 'static' | 'dynamic' | 'hybrid';
  filter_config: any;
  total_contacts: number;
  static_contacts_count: number;
  created_by?: number;
  created_at: string;
}

interface Tag {
  id: number;
  name: string;
  color: string;
}

export default function Lists() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContacts, setPreviewContacts] = useState<any[]>([]);
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    list_type: 'static' as 'static' | 'dynamic' | 'hybrid',
    filter_config: {
      tags: [] as number[],
      exclude_tags: [] as number[],
      opt_in: undefined as boolean | undefined,
      opt_out: undefined as boolean | undefined,
      whatsapp_validated: undefined as boolean | undefined,
    },
  });

  useEffect(() => {
    loadLists();
    loadTags();
  }, []);

  const loadLists = async () => {
    try {
      setLoading(true);
      const response = await api.get('/lists');
      setLists(response.data.lists);
    } catch (error: any) {
      console.error('Erro ao carregar listas:', error);
      setToast({
        message: 'Erro ao carregar listas',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTags = async () => {
    try {
      const response = await api.get('/tags');
      setTags(response.data.tags);
    } catch (error) {
      console.error('Erro ao carregar tags:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      // Validar se lista dinâmica tem pelo menos uma tag selecionada
      if ((formData.list_type === 'dynamic' || formData.list_type === 'hybrid') && 
          (!formData.filter_config.tags || formData.filter_config.tags.length === 0)) {
        setToast({
          message: 'Listas dinâmicas precisam ter pelo menos uma tag selecionada',
          type: 'error'
        });
        setLoading(false);
        return;
      }

      if (editingList) {
        await api.put(`/lists/${editingList.id}`, formData);
        setToast({ message: 'Lista atualizada com sucesso!', type: 'success' });
      } else {
        const response = await api.post('/lists', formData);
        const createdList = response.data.list;
        setToast({ 
          message: `Lista criada com sucesso! ${createdList.total_contacts || 0} contatos encontrados.`, 
          type: 'success' 
        });
      }
      setShowModal(false);
      setEditingList(null);
      setFormData({
        name: '',
        description: '',
        list_type: 'static',
        filter_config: {
          tags: [],
          exclude_tags: [],
          opt_in: undefined,
          opt_out: undefined,
          whatsapp_validated: undefined,
        },
      });
      await loadLists();
    } catch (error: any) {
      console.error('Erro ao salvar lista:', error);
      setToast({
        message: error.response?.data?.error || error.response?.data?.message || 'Erro ao salvar lista',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta lista?')) return;
    try {
      await api.delete(`/lists/${id}`);
      setToast({ message: 'Lista deletada com sucesso!', type: 'success' });
      loadLists();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao deletar lista',
        type: 'error'
      });
    }
  };

  const handleEdit = (list: ContactList) => {
    setEditingList(list);
    setFormData({
      name: list.name,
      description: list.description || '',
      list_type: list.list_type,
      filter_config: list.filter_config || {
        tags: [],
        exclude_tags: [],
        opt_in: undefined,
        opt_out: undefined,
        whatsapp_validated: undefined,
      },
    });
    setShowModal(true);
  };

  const handlePreview = async (id: number) => {
    try {
      const response = await api.get(`/lists/${id}/preview?limit=10`);
      setPreviewContacts(response.data.contacts);
      setShowPreview(true);
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao fazer preview',
        type: 'error'
      });
    }
  };

  const handleRefresh = async (id: number) => {
    try {
      await api.post(`/lists/${id}/refresh`);
      setToast({ message: 'Lista atualizada com sucesso!', type: 'success' });
      loadLists();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao atualizar lista',
        type: 'error'
      });
    }
  };

  const getListTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      static: 'Estática',
      dynamic: 'Dinâmica',
      hybrid: 'Híbrida'
    };
    return labels[type] || type;
  };

  const getListTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      static: 'from-blue-500 to-cyan-500',
      dynamic: 'from-purple-500 to-pink-500',
      hybrid: 'from-green-500 to-emerald-500'
    };
    return colors[type] || 'from-gray-500 to-gray-600';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                <List className="h-6 w-6 text-white" />
              </div>
              Listas de Contatos
            </h1>
            <p className="text-gray-600 text-sm ml-13">
              Crie listas estáticas, dinâmicas ou híbridas para seus disparos
            </p>
          </div>
          
          <Button
            onClick={() => {
              setEditingList(null);
              setFormData({
                name: '',
                description: '',
                list_type: 'static',
                filter_config: {
                  tags: [],
                  exclude_tags: [],
                  opt_in: undefined,
                  opt_out: undefined,
                  whatsapp_validated: undefined,
                },
              });
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg"
          >
            <Plus className="h-5 w-5" />
            Nova Lista
          </Button>
        </div>
      </div>

      {/* Lista de Listas */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando listas...</p>
          </div>
        </div>
      ) : lists.length === 0 ? (
        <Card className="border-2 border-gray-200 rounded-2xl shadow-md">
          <CardContent className="p-12 text-center">
            <List className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Nenhuma lista encontrada</h3>
            <p className="text-gray-600 mb-6">Crie sua primeira lista de contatos</p>
            <Button
              onClick={() => {
                setEditingList(null);
                setFormData({
                  name: '',
                  description: '',
                  list_type: 'static',
                  filter_config: {
                    tags: [],
                    exclude_tags: [],
                    opt_in: undefined,
                    opt_out: undefined,
                    whatsapp_validated: undefined,
                  },
                });
                setShowModal(true);
              }}
              className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Criar Lista
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lists.map(list => (
            <Card key={list.id} className="border-2 border-gray-200 hover:border-green-300 hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden bg-white shadow-md">
              <CardHeader className={`bg-gradient-to-br ${getListTypeColor(list.list_type)} bg-opacity-10 border-b-2 border-gray-100 px-6 py-4`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg font-bold text-gray-900 mb-1">
                      {list.name}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-medium bg-gradient-to-r ${getListTypeColor(list.list_type)} text-white`}>
                        {getListTypeLabel(list.list_type)}
                      </span>
                    </div>
                  </div>
                </div>
                {list.description && (
                  <CardDescription className="text-sm text-gray-600 mt-2">
                    {list.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Total de contatos:
                    </span>
                    <span className="font-bold text-gray-900">{list.total_contacts || 0}</span>
                  </div>

                  {list.list_type === 'hybrid' && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Contatos estáticos:</span>
                      <span className="font-medium text-gray-900">{list.static_contacts_count || 0}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreview(list.id)}
                      className="flex-1"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Preview
                    </Button>
                    {(list.list_type === 'dynamic' || list.list_type === 'hybrid') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefresh(list.id)}
                        className="text-blue-600 hover:text-blue-700 hover:border-blue-300"
                        title="Atualizar lista"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(list)}
                      className="text-gray-600 hover:text-gray-700 hover:border-gray-300"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(list.id)}
                      className="text-red-600 hover:text-red-700 hover:border-red-300"
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

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <Card className="w-full max-w-2xl border-2 border-gray-200 rounded-2xl shadow-xl my-8">
            <CardHeader className="bg-gradient-to-br from-green-50 to-emerald-50 border-b-2 border-gray-100 px-6 py-4">
              <CardTitle className="text-xl font-bold text-gray-900">
                {editingList ? 'Editar Lista' : 'Nova Lista'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome *
                  </label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome da lista"
                    required
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-green-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descrição
                  </label>
                  <Input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Descrição opcional"
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tipo de Lista *
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['static', 'dynamic', 'hybrid'] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormData({ ...formData, list_type: type })}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          formData.list_type === type
                            ? `border-green-500 bg-gradient-to-br ${getListTypeColor(type)} bg-opacity-10`
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-gray-900 mb-1">
                          {getListTypeLabel(type)}
                        </div>
                        <div className="text-xs text-gray-600">
                          {type === 'static' && 'Contatos fixos'}
                          {type === 'dynamic' && 'Baseada em filtros'}
                          {type === 'hybrid' && 'Estática + Dinâmica'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filtros para listas dinâmicas/híbridas */}
                {(formData.list_type === 'dynamic' || formData.list_type === 'hybrid') && (
                  <div className="space-y-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <Filter className="h-5 w-5 text-gray-600" />
                      <h3 className="text-sm font-semibold text-gray-900">Filtros</h3>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tags (incluir contatos com estas tags)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Selecione as tags para filtrar contatos. A lista incluirá apenas contatos que possuem pelo menos uma das tags selecionadas.
                      </p>
                      <div className="flex flex-wrap gap-2 p-3 border-2 border-gray-200 rounded-xl min-h-[60px] bg-gray-50">
                        {tags.length === 0 ? (
                          <span className="text-sm text-gray-400">Nenhuma tag disponível. Crie tags na página de Tags.</span>
                        ) : (
                          tags.map(tag => {
                            const isSelected = formData.filter_config.tags?.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const current = formData.filter_config.tags || [];
                                  if (isSelected) {
                                    setFormData({
                                      ...formData,
                                      filter_config: {
                                        ...formData.filter_config,
                                        tags: current.filter(id => id !== tag.id)
                                      }
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      filter_config: {
                                        ...formData.filter_config,
                                        tags: [...current, tag.id]
                                      }
                                    });
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                  isSelected
                                    ? 'text-white shadow-md'
                                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                                }`}
                                style={isSelected ? { backgroundColor: tag.color } : {}}
                              >
                                {isSelected ? '✓ ' : ''}{tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tags (excluir contatos com estas tags)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Selecione as tags para excluir contatos. A lista não incluirá contatos que possuem qualquer uma das tags selecionadas.
                      </p>
                      <div className="flex flex-wrap gap-2 p-3 border-2 border-gray-200 rounded-xl min-h-[60px] bg-gray-50">
                        {tags.length === 0 ? (
                          <span className="text-sm text-gray-400">Nenhuma tag disponível.</span>
                        ) : (
                          tags.map(tag => {
                            const isSelected = formData.filter_config.exclude_tags?.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const current = formData.filter_config.exclude_tags || [];
                                  if (isSelected) {
                                    setFormData({
                                      ...formData,
                                      filter_config: {
                                        ...formData.filter_config,
                                        exclude_tags: current.filter(id => id !== tag.id)
                                      }
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      filter_config: {
                                        ...formData.filter_config,
                                        exclude_tags: [...current, tag.id]
                                      }
                                    });
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border-2 ${
                                  isSelected
                                    ? 'border-red-500 bg-red-50 text-red-700'
                                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                                }`}
                              >
                                {isSelected ? '✕ ' : ''}{tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-4">
                        <p className="text-sm text-blue-900 font-medium mb-2">ℹ️ Como funciona a validação</p>
                        <div className="text-xs text-blue-700 space-y-1">
                          <p><strong>Opt-in:</strong> Por padrão, contatos importados já têm opt-in = TRUE. Use o filtro apenas se quiser garantir.</p>
                          <p><strong>WhatsApp Validado:</strong> Contatos importados começam com whatsapp_validated = FALSE. Você precisa validá-los manualmente na página de Contatos (selecionar e clicar em "Validar WhatsApp") ou eles serão validados automaticamente quando receberem mensagens via webhook.</p>
                          <p className="mt-2 font-semibold">💡 Dica: Selecione contatos na página de Contatos e use "Validar WhatsApp" em massa para criar listas válidas rapidamente!</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          Apenas opt-in
                        </label>
                        <Switch
                          checked={formData.filter_config.opt_in === true}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            filter_config: {
                              ...formData.filter_config,
                              opt_in: checked ? true : undefined
                            }
                          })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          Apenas WhatsApp validado
                        </label>
                        <Switch
                          checked={formData.filter_config.whatsapp_validated === true}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            filter_config: {
                              ...formData.filter_config,
                              whatsapp_validated: checked ? true : undefined
                            }
                          })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          Excluir opt-out
                        </label>
                        <Switch
                          checked={formData.filter_config.opt_out === false}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            filter_config: {
                              ...formData.filter_config,
                              opt_out: checked ? false : undefined
                            }
                          })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          Excluir opt-out
                        </label>
                        <Switch
                          checked={formData.filter_config.opt_out === false}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            filter_config: {
                              ...formData.filter_config,
                              opt_out: checked ? false : undefined
                            }
                          })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                          Apenas WhatsApp validado
                        </label>
                        <Switch
                          checked={formData.filter_config.whatsapp_validated === true}
                          onCheckedChange={(checked) => setFormData({
                            ...formData,
                            filter_config: {
                              ...formData.filter_config,
                              whatsapp_validated: checked ? true : undefined
                            }
                          })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowModal(false);
                      setEditingList(null);
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
                  >
                    {editingList ? 'Atualizar' : 'Criar'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal Preview */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl border-2 border-gray-200 rounded-2xl shadow-xl">
            <CardHeader className="bg-gradient-to-br from-green-50 to-emerald-50 border-b-2 border-gray-100 px-6 py-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-bold text-gray-900">
                  Preview de Contatos
                </CardTitle>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-6 max-h-96 overflow-y-auto">
              {previewContacts.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Nenhum contato encontrado</p>
              ) : (
                <div className="space-y-2">
                  {previewContacts.map((contact: any) => (
                    <div key={contact.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium text-gray-900">{contact.name || 'Sem nome'}</div>
                      <div className="text-sm text-gray-600">{contact.phone_number}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
