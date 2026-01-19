import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Toast from '@/components/ui/Toast';
import {
  Tag as TagIcon,
  Plus,
  Edit,
  Trash2,
} from 'lucide-react';

interface Tag {
  id: number;
  name: string;
  color: string;
  description?: string;
  category: string;
  total_contacts: number;
  created_at: string;
}

const DEFAULT_COLORS = [
  '#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'
];

export default function Tags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#6366f1',
    description: '',
    category: 'custom',
  });

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    try {
      setLoading(true);
      const response = await api.get('/tags');
      setTags(response.data.tags);
    } catch (error: any) {
      console.error('Erro ao carregar tags:', error);
      setToast({
        message: 'Erro ao carregar tags',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTag) {
        await api.put(`/tags/${editingTag.id}`, formData);
        setToast({ message: 'Tag atualizada com sucesso!', type: 'success' });
      } else {
        await api.post('/tags', formData);
        setToast({ message: 'Tag criada com sucesso!', type: 'success' });
      }
      setShowModal(false);
      setEditingTag(null);
      setFormData({ name: '', color: '#6366f1', description: '', category: 'custom' });
      loadTags();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao salvar tag',
        type: 'error'
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta tag?')) return;
    try {
      await api.delete(`/tags/${id}`);
      setToast({ message: 'Tag deletada com sucesso!', type: 'success' });
      loadTags();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao deletar tag',
        type: 'error'
      });
    }
  };

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      color: tag.color,
      description: tag.description || '',
      category: tag.category,
    });
    setShowModal(true);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <TagIcon className="h-6 w-6 text-white" />
              </div>
              Tags
            </h1>
            <p className="text-gray-600 text-sm ml-13">
              Organize contatos com tags e categorias
            </p>
          </div>
          
          <Button
            onClick={() => {
              setEditingTag(null);
              setFormData({ name: '', color: '#6366f1', description: '', category: 'custom' });
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg"
          >
            <Plus className="h-5 w-5" />
            Nova Tag
          </Button>
        </div>
      </div>

      {/* Lista de Tags */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Carregando tags...</p>
          </div>
        </div>
      ) : tags.length === 0 ? (
        <Card className="border-2 border-gray-200 rounded-2xl shadow-md">
          <CardContent className="p-12 text-center">
            <TagIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Nenhuma tag encontrada</h3>
            <p className="text-gray-600 mb-6">Crie tags para organizar seus contatos</p>
            <Button
              onClick={() => {
                setEditingTag(null);
                setFormData({ name: '', color: '#6366f1', description: '', category: 'custom' });
                setShowModal(true);
              }}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Criar Tag
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tags.map(tag => (
            <Card key={tag.id} className="border-2 border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden bg-white shadow-md">
              <CardHeader className="px-6 py-4" style={{ backgroundColor: `${tag.color}15`, borderBottom: `2px solid ${tag.color}40` }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
                      style={{ backgroundColor: tag.color }}
                    >
                      <TagIcon className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg font-bold text-gray-900 mb-1">
                        {tag.name}
                      </CardTitle>
                      {tag.description && (
                        <p className="text-sm text-gray-600">{tag.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Categoria:</span>
                    <span className="font-medium text-gray-900 capitalize">{tag.category}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Contatos:</span>
                    <span className="font-bold text-gray-900">{tag.total_contacts}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(tag)}
                      className="flex-1"
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(tag.id)}
                      className="text-red-600 hover:text-red-700 hover:border-red-300"
                      title={['devocional', 'marketing', 'vip', 'teste', 'bloqueado'].includes(tag.category) ? 'Tags padrão não podem ser excluídas' : 'Excluir tag'}
                      disabled={['devocional', 'marketing', 'vip', 'teste', 'bloqueado'].includes(tag.category)}
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md border-2 border-gray-200 rounded-2xl shadow-xl">
            <CardHeader className="bg-gradient-to-br from-purple-50 to-pink-50 border-b-2 border-gray-100 px-6 py-4">
              <CardTitle className="text-xl font-bold text-gray-900">
                {editingTag ? 'Editar Tag' : 'Nova Tag'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome *
                  </label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome da tag"
                    required
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-purple-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cor
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="h-12 w-20 rounded-xl border-2 border-gray-300 cursor-pointer"
                    />
                    <div className="flex-1 flex flex-wrap gap-2">
                      {DEFAULT_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setFormData({ ...formData, color })}
                          className={`w-8 h-8 rounded-lg border-2 transition-all ${
                            formData.color === color ? 'border-gray-900 scale-110' : 'border-gray-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
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
                    className="h-12 border-2 border-gray-300 rounded-xl focus:border-purple-500"
                  />
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowModal(false);
                      setEditingTag(null);
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                  >
                    {editingTag ? 'Atualizar' : 'Criar'}
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
