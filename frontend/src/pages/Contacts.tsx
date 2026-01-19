import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Toast from '@/components/ui/Toast';
import {
  Users,
  Plus,
  Search,
  Edit,
  Trash2,
  Tag,
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  Phone,
  Mail,
} from 'lucide-react';

interface Contact {
  id: number;
  phone_number: string;
  name?: string;
  email?: string;
  whatsapp_validated: boolean;
  opt_in: boolean;
  opt_out: boolean;
  source: string;
  tags: Array<{ id: number; name: string; color: string; category: string }>;
  created_at: string;
}

interface Tag {
  id: number;
  name: string;
  color: string;
  category: string;
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    phone_number: '',
    name: '',
    email: '',
  });
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    loadContacts();
    loadTags();
  }, [searchTerm, selectedTags, offset]);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      
      if (selectedTags.length > 0) {
        params.append('tags', selectedTags.join(','));
      }

      const response = await api.get(`/contacts?${params.toString()}`);
      setContacts(response.data.contacts);
      setTotal(response.data.total);
    } catch (error: any) {
      console.error('Erro ao carregar contatos:', error);
      setToast({
        message: 'Erro ao carregar contatos',
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
      if (editingContact) {
        await api.put(`/contacts/${editingContact.id}`, formData);
        setToast({ message: 'Contato atualizado com sucesso!', type: 'success' });
      } else {
        await api.post('/contacts', formData);
        setToast({ message: 'Contato criado com sucesso!', type: 'success' });
      }
      setShowModal(false);
      setEditingContact(null);
      setFormData({ phone_number: '', name: '', email: '' });
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao salvar contato',
        type: 'error'
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar este contato?')) return;
    try {
      await api.delete(`/contacts/${id}`);
      setToast({ message: 'Contato deletado com sucesso!', type: 'success' });
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao deletar contato',
        type: 'error'
      });
    }
  };

  const handleEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      phone_number: contact.phone_number,
      name: contact.name || '',
      email: contact.email || '',
    });
    setShowModal(true);
  };

  const handleAddTag = async (contactId: number, tagId: number) => {
    try {
      await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
      setToast({ message: 'Tag adicionada com sucesso!', type: 'success' });
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao adicionar tag',
        type: 'error'
      });
    }
  };

  const handleRemoveTag = async (contactId: number, tagId: number) => {
    try {
      await api.delete(`/contacts/${contactId}/tags/${tagId}`);
      setToast({ message: 'Tag removida com sucesso!', type: 'success' });
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao remover tag',
        type: 'error'
      });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const contactsToImport = lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          phone_number: parts[0] || '',
          name: parts[1] || '',
          email: parts[2] || '',
        };
      }).filter(c => c.phone_number);

      const response = await api.post('/contacts/import', { contacts: contactsToImport });
      setToast({
        message: `${response.data.results.created} criados, ${response.data.results.updated} atualizados`,
        type: 'success'
      });
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao importar contatos',
        type: 'error'
      });
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
                <Users className="h-6 w-6 text-white" />
              </div>
              Contatos
            </h1>
            <p className="text-gray-600 text-sm ml-13">
              Gerencie seus contatos e organize com tags
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleImport}
                className="hidden"
              />
              <Button
                variant="outline"
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Importar
              </Button>
            </label>
            <Button
              onClick={() => {
                setEditingContact(null);
                setFormData({ phone_number: '', name: '', email: '' });
                setShowModal(true);
              }}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-lg"
            >
              <Plus className="h-5 w-5" />
              Novo Contato
            </Button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-6 border-2 border-gray-200 rounded-2xl shadow-md">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Buscar por nome, telefone ou email..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setOffset(0);
                  }}
                  className="pl-10 h-12 border-2 border-gray-300 rounded-xl focus:border-blue-500"
                />
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => {
                    if (selectedTags.includes(tag.id)) {
                      setSelectedTags(selectedTags.filter(id => id !== tag.id));
                    } else {
                      setSelectedTags([...selectedTags, tag.id]);
                    }
                    setOffset(0);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    selectedTags.includes(tag.id)
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={!selectedTags.includes(tag.id) ? { borderLeft: `4px solid ${tag.color}` } : {}}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Contatos */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando contatos...</p>
          </div>
        </div>
      ) : contacts.length === 0 ? (
        <Card className="border-2 border-gray-200 rounded-2xl shadow-md">
          <CardContent className="p-12 text-center">
            <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Nenhum contato encontrado</h3>
            <p className="text-gray-600 mb-6">Comece adicionando seu primeiro contato</p>
            <Button
              onClick={() => {
                setEditingContact(null);
                setFormData({ phone_number: '', name: '', email: '' });
                setShowModal(true);
              }}
              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Contato
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {contacts.map(contact => (
              <Card key={contact.id} className="border-2 border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden bg-white shadow-md">
                <CardHeader className="bg-gradient-to-br from-blue-50 to-cyan-50 border-b-2 border-gray-100 px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg font-bold text-gray-900 mb-1">
                        {contact.name || 'Sem nome'}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4" />
                        <span>{contact.phone_number}</span>
                      </div>
                      {contact.email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                          <Mail className="h-4 w-4" />
                          <span>{contact.email}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {contact.whatsapp_validated && (
                        <CheckCircle2 className="h-5 w-5 text-green-500" title="WhatsApp validado" />
                      )}
                      {contact.opt_out && (
                        <XCircle className="h-5 w-5 text-red-500" title="Opt-out" />
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {/* Tags */}
                    <div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {contact.tags && contact.tags.length > 0 ? (
                          contact.tags.map(tag => (
                            <span
                              key={tag.id}
                              className="px-2 py-1 rounded-lg text-xs font-medium text-white"
                              style={{ backgroundColor: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">Sem tags</span>
                        )}
                      </div>
                      
                      {/* Adicionar tag */}
                      <div className="flex flex-wrap gap-1">
                        {tags.filter(t => !contact.tags?.some(ct => ct.id === t.id)).slice(0, 3).map(tag => (
                          <button
                            key={tag.id}
                            onClick={() => handleAddTag(contact.id, tag.id)}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                            style={{ borderLeft: `3px solid ${tag.color}` }}
                          >
                            + {tag.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(contact)}
                        className="flex-1"
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(contact.id)}
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

          {/* Paginação */}
          {total > limit && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-gray-600">
                Mostrando {offset + 1} - {Math.min(offset + limit, total)} de {total} contatos
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                >
                  Próximo
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md border-2 border-gray-200 rounded-2xl shadow-xl">
            <CardHeader className="bg-gradient-to-br from-blue-50 to-cyan-50 border-b-2 border-gray-100 px-6 py-4">
              <CardTitle className="text-xl font-bold text-gray-900">
                {editingContact ? 'Editar Contato' : 'Novo Contato'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Telefone *
                  </label>
                  <Input
                    type="text"
                    value={formData.phone_number}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    placeholder="5511999999999"
                    required
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome
                  </label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome do contato"
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@exemplo.com"
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowModal(false);
                      setEditingContact(null);
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
                  >
                    {editingContact ? 'Atualizar' : 'Criar'}
                  </Button>
                </div>
              </form>
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
