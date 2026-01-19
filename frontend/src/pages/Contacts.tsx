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
  CheckCircle2,
  XCircle,
  Phone,
  Mail,
  Grid3x3,
  List as ListIcon,
  X,
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
  const [contactTags, setContactTags] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);

  useEffect(() => {
    loadContacts();
    loadTags();
  }, [searchTerm, selectedTags, offset, showAll]);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const currentLimit = showAll ? 10000 : limit;
      const params = new URLSearchParams({
        limit: currentLimit.toString(),
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
      let contactId: number;
      
      if (editingContact) {
        await api.put(`/contacts/${editingContact.id}`, formData);
        contactId = editingContact.id;
        setToast({ message: 'Contato atualizado com sucesso!', type: 'success' });
      } else {
        const response = await api.post('/contacts', formData);
        contactId = response.data.contact.id;
        setToast({ message: 'Contato criado com sucesso!', type: 'success' });
      }
      
      // Gerenciar tags
      if (editingContact) {
        // Remover tags que não estão mais selecionadas
        const tagsToRemove = editingContact.tags
          ?.filter(t => !contactTags.includes(t.id))
          .map(t => t.id) || [];
        
        for (const tagId of tagsToRemove) {
          try {
            await api.delete(`/contacts/${contactId}/tags/${tagId}`);
          } catch (error) {
            console.error('Erro ao remover tag:', error);
          }
        }
        
        // Adicionar novas tags
        const tagsToAdd = contactTags.filter(tagId => 
          !editingContact.tags?.some(t => t.id === tagId)
        );
        
        for (const tagId of tagsToAdd) {
          try {
            await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
          } catch (error) {
            console.error('Erro ao adicionar tag:', error);
          }
        }
      } else {
        // Para novo contato, adicionar todas as tags selecionadas
        for (const tagId of contactTags) {
          try {
            await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
          } catch (error) {
            console.error('Erro ao adicionar tag:', error);
          }
        }
      }
      
      setShowModal(false);
      setEditingContact(null);
      setFormData({ phone_number: '', name: '', email: '' });
      setContactTags([]);
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
    setContactTags(contact.tags?.map(t => t.id) || []);
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


  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processImportFile(file);
  };

  const processImportFile = async (file: File) => {

    try {
      setLoading(true);
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        setToast({
          message: 'Arquivo vazio',
          type: 'error'
        });
        return;
      }

      // Detectar se tem header
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('phone') || 
                       firstLine.includes('telefone') || 
                       firstLine.includes('nome') || 
                       firstLine.includes('name') ||
                       firstLine.includes('email');
      
      const dataLines = hasHeader ? lines.slice(1) : lines;
      
      // Se tem header, mapear colunas
      let columnMap: { [key: string]: number } = {};
      if (hasHeader) {
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        headers.forEach((header, index) => {
          if (header.includes('phone') || header.includes('telefone') || header.includes('celular') || header.includes('whatsapp') || header.includes('numero')) {
            columnMap['phone'] = index;
          } else if (header.includes('nome') || header.includes('name')) {
            columnMap['name'] = index;
          } else if (header.includes('email') || header.includes('e-mail')) {
            columnMap['email'] = index;
          } else if (header.includes('tag')) {
            columnMap['tags'] = index;
          }
        });
      }

      const contactsToImport = dataLines.map((line) => {
        // Tratar CSV com aspas e vírgulas dentro de campos
        const parts: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            parts.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        parts.push(current.trim());

        let contact: any = {};
        
        if (hasHeader && Object.keys(columnMap).length > 0) {
          // Usar mapeamento de colunas
          if (columnMap['phone'] !== undefined) {
            contact.phone_number = parts[columnMap['phone']] || '';
          }
          if (columnMap['name'] !== undefined) {
            contact.name = parts[columnMap['name']] || '';
          }
          if (columnMap['email'] !== undefined) {
            contact.email = parts[columnMap['email']] || '';
          }
          if (columnMap['tags'] !== undefined) {
            contact.tags = parts[columnMap['tags']] || '';
          }
          
          // Adicionar campos extras ao metadata
          const metadata: any = {};
          parts.forEach((part, index) => {
            if (index !== columnMap['phone'] && index !== columnMap['name'] && index !== columnMap['email'] && index !== columnMap['tags'] && part) {
              metadata[`col_${index}`] = part;
            }
          });
          if (Object.keys(metadata).length > 0) {
            contact.metadata = metadata;
          }
        } else {
          // Sem header, usar posição padrão
          contact = {
            phone_number: parts[0] || '',
            name: parts[1] || '',
            email: parts[2] || '',
          };
          
          // Campos extras
          if (parts.length > 3) {
            const metadata: any = {};
            parts.slice(3).forEach((part, index) => {
              if (part) metadata[`extra_${index}`] = part;
            });
            contact.metadata = metadata;
          }
        }

        return contact;
      }).filter(c => c.phone_number);

      if (contactsToImport.length === 0) {
        setToast({
          message: 'Nenhum contato válido encontrado no arquivo',
          type: 'error'
        });
        return;
      }

      const response = await api.post('/contacts/import', { 
        contacts: contactsToImport,
        tags: importTags.length > 0 ? tags.filter(t => importTags.includes(t.id)).map(t => t.name) : []
      });
      
      const errorsCount = response.data.results.errors?.length || 0;
      const tagsApplied = response.data.results.tagsApplied || 0;
      let message = `${response.data.results.created} criados, ${response.data.results.updated} atualizados`;
      if (tagsApplied > 0) {
        message += `, ${tagsApplied} tags aplicadas`;
      }
      if (errorsCount > 0) {
        message += `, ${errorsCount} erros`;
      }
      
      setToast({
        message,
        type: errorsCount > 0 ? 'warning' : 'success'
      });
      
      // Limpar input e modal
      const input = document.getElementById('csv-import') as HTMLInputElement;
      if (input) input.value = '';
      setShowImportModal(false);
      setImportTags([]);
      loadContacts();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao importar contatos',
        type: 'error'
      });
    } finally {
      setLoading(false);
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
              Gerencie seus contatos e organize com tags. <strong>Tags</strong> categorizam contatos (ex: "Cliente VIP", "Interessado"). <strong>Listas</strong> agrupam contatos para disparos específicos.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <input
              type="file"
              id="csv-import"
              accept=".csv,.txt"
              onChange={handleImport}
              className="hidden"
            />
            <Button
              variant="outline"
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => {
                setShowImportModal(true);
              }}
            >
              <Upload className="h-4 w-4" />
              Importar CSV
            </Button>
            {selectedContacts.length > 0 && (
              <Button
                variant="outline"
                className="flex items-center gap-2"
                onClick={() => setShowBulkTagModal(true)}
              >
                <Tag className="h-4 w-4" />
                Adicionar Tags ({selectedContacts.length})
              </Button>
            )}
            <div className="flex items-center gap-1 border rounded-lg p-1">
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('cards')}
                className="h-8 w-8 p-0"
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="h-8 w-8 p-0"
              >
                <ListIcon className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={() => {
                setEditingContact(null);
                setFormData({ phone_number: '', name: '', email: '' });
                setContactTags([]);
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
          {!showAll && total > limit && (
            <Card className="mb-4 border-2 border-yellow-200 bg-yellow-50 rounded-xl">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-yellow-900">
                  Mostrando apenas {limit} de {total} contatos
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAll(true);
                    setOffset(0);
                  }}
                >
                  Carregar todos ({total})
                </Button>
              </CardContent>
            </Card>
          )}
          {selectedContacts.length > 0 && (
            <Card className="mb-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900">
                  {selectedContacts.length} contato(s) selecionado(s)
                  {!showAll && total > limit && (
                    <span className="text-xs text-blue-600 ml-2">
                      (Mostrando apenas {limit} de {total}. 
                      <button
                        onClick={() => {
                          setShowAll(true);
                          setOffset(0);
                          loadContacts();
                        }}
                        className="underline ml-1 font-semibold"
                      >
                        Carregar todos
                      </button>)
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowBulkTagModal(true)}
                  >
                    <Tag className="h-4 w-4 mr-1" />
                    Adicionar Tags
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!confirm(`Tem certeza que deseja excluir ${selectedContacts.length} contato(s)?`)) return;
                      try {
                        setLoading(true);
                        for (const contactId of selectedContacts) {
                          try {
                            await api.delete(`/contacts/${contactId}`);
                          } catch (error) {
                            console.error(`Erro ao excluir contato ${contactId}:`, error);
                          }
                        }
                        setToast({
                          message: `${selectedContacts.length} contato(s) excluído(s) com sucesso!`,
                          type: 'success'
                        });
                        setSelectedContacts([]);
                        setShowAll(false);
                        setLimit(50);
                        setOffset(0);
                        await loadContacts();
                      } catch (error: any) {
                        setToast({
                          message: error.response?.data?.error || 'Erro ao excluir contatos',
                          type: 'error'
                        });
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="text-red-600 hover:text-red-700 hover:border-red-300"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Excluir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedContacts([]);
                      setShowAll(false);
                      setLimit(50);
                      setOffset(0);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Limpar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {viewMode === 'cards' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {contacts.map(contact => (
                <Card key={contact.id} className="border-2 border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden bg-white shadow-md">
                  <CardHeader className="bg-gradient-to-br from-blue-50 to-cyan-50 border-b-2 border-gray-100 px-6 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(contact.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedContacts([...selectedContacts, contact.id]);
                            } else {
                              setSelectedContacts(selectedContacts.filter(id => id !== contact.id));
                            }
                          }}
                          className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
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
                      </div>
                      <div className="flex items-center gap-2">
                        {contact.whatsapp_validated && (
                          <div title="WhatsApp validado">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          </div>
                        )}
                        {contact.opt_out && (
                          <div title="Opt-out">
                            <XCircle className="h-5 w-5 text-red-500" />
                          </div>
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
                              <div key={tag.id} className="flex items-center gap-1">
                                <span
                                  className="px-2 py-1 rounded-lg text-xs font-medium text-white"
                                  style={{ backgroundColor: tag.color }}
                                >
                                  {tag.name}
                                </span>
                                <button
                                  onClick={() => handleRemoveTag(contact.id, tag.id)}
                                  className="text-white hover:text-red-200 transition-colors"
                                  title="Remover tag"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
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
          ) : (
            <Card className="mb-6 border-2 border-gray-200 rounded-2xl shadow-md">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gradient-to-br from-blue-50 to-cyan-50 border-b-2 border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={selectedContacts.length === contacts.length && contacts.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedContacts(contacts.map(c => c.id));
                              } else {
                                setSelectedContacts([]);
                              }
                            }}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Nome</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Telefone</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tags</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {contacts.map(contact => (
                        <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedContacts.includes(contact.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedContacts([...selectedContacts, contact.id]);
                                } else {
                                  setSelectedContacts(selectedContacts.filter(id => id !== contact.id));
                                }
                              }}
                              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {contact.name || 'Sem nome'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{contact.phone_number}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{contact.email || '-'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {contact.tags && contact.tags.length > 0 ? (
                                contact.tags.map(tag => (
                                  <div key={tag.id} className="flex items-center gap-1">
                                    <span
                                      className="px-2 py-0.5 rounded text-xs font-medium text-white"
                                      style={{ backgroundColor: tag.color }}
                                    >
                                      {tag.name}
                                    </span>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await handleRemoveTag(contact.id, tag.id);
                                      }}
                                      className="text-gray-400 hover:text-red-500 transition-colors ml-1"
                                      title="Remover tag"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(contact)}
                              >
                                <Edit className="h-4 w-4" />
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

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

                {/* Tags */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 border-2 border-gray-200 rounded-xl min-h-[60px] bg-gray-50">
                    {tags.length === 0 ? (
                      <span className="text-sm text-gray-400">Nenhuma tag disponível. Crie tags na página de Tags.</span>
                    ) : (
                      tags.map(tag => {
                        const isSelected = contactTags.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setContactTags(contactTags.filter(id => id !== tag.id));
                              } else {
                                setContactTags([...contactTags, tag.id]);
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
                  <p className="text-xs text-gray-500 mt-1">
                    Tags ajudam a categorizar e filtrar contatos. Clique para selecionar/deselecionar.
                  </p>
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

      {/* Modal Adicionar Tags em Massa */}
      {showBulkTagModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md border-2 border-gray-200 rounded-2xl shadow-xl">
            <CardHeader className="bg-gradient-to-br from-blue-50 to-cyan-50 border-b-2 border-gray-100 px-6 py-4">
              <CardTitle className="text-xl font-bold text-gray-900">
                Adicionar Tags ({selectedContacts.length} contatos)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 p-3 border-2 border-gray-200 rounded-xl min-h-[100px] bg-gray-50">
                  {tags.length === 0 ? (
                    <span className="text-sm text-gray-400">Nenhuma tag disponível. Crie tags na página de Tags.</span>
                  ) : (
                    tags.map(tag => {
                      const isSelected = contactTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setContactTags(contactTags.filter(id => id !== tag.id));
                            } else {
                              setContactTags([...contactTags, tag.id]);
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
                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowBulkTagModal(false);
                      setContactTags([]);
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      try {
                        setLoading(true);
                        let successCount = 0;
                        for (const contactId of selectedContacts) {
                          for (const tagId of contactTags) {
                            try {
                              await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
                              successCount++;
                            } catch (error) {
                              // Ignorar erros de tag duplicada
                            }
                          }
                        }
                        setToast({
                          message: `Tags adicionadas a ${selectedContacts.length} contato(s)!`,
                          type: 'success'
                        });
                        setShowBulkTagModal(false);
                        setContactTags([]);
                        setSelectedContacts([]);
                        await loadContacts();
                      } catch (error: any) {
                        setToast({
                          message: error.response?.data?.error || 'Erro ao adicionar tags',
                          type: 'error'
                        });
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
                    disabled={contactTags.length === 0}
                  >
                    Adicionar
                  </Button>
                </div>
              </div>
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
