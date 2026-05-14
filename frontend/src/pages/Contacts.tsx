import { useEffect, useState } from 'react';
import api from '@/lib/api';
import {
  Users,
  Plus,
  Search,
  Edit,
  Trash2,
  Upload,
  CheckCircle2,
  Phone,
  Mail,
  Grid3x3,
  List as ListIcon,
  X,
  RefreshCw,
  AlertTriangle,
  Filter,
  Info,
  Download,
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

interface TagType {
  id: number;
  name: string;
  color: string;
  category: string;
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function contactFromHeaderRow(headers: string[], cells: string[]) {
  const norm = headers.map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const col = (candidates: string[]) => {
    for (const c of candidates) {
      const i = norm.indexOf(c.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const ph = col(['phone_number', 'phone', 'telefone', 'celular', 'whatsapp', 'numero']);
  const nm = col(['name', 'nome', 'full_name', 'nome_completo']);
  const em = col(['email', 'e_mail', 'email_address']);
  const tg = col(['tags', 'tag']);
  return {
    phone_number: ph >= 0 ? (cells[ph] ?? '').trim() : '',
    name: nm >= 0 ? (cells[nm] ?? '').trim() : '',
    email: em >= 0 ? (cells[em] ?? '').trim() : '',
    tags: tg >= 0 ? (cells[tg] ?? '').trim() : '',
  };
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterWhatsapp, setFilterWhatsapp] = useState<string>('');
  const [filterOptIn, setFilterOptIn] = useState<string>('');
  const [filterOptOut, setFilterOptOut] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    phone_number: '',
    name: '',
    email: '',
    opt_in: true,
    opt_out: false,
  });
  const [contactTags, setContactTags] = useState<number[]>([]);
  const [bulkTagSelection, setBulkTagSelection] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [showAll] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTags, setImportTags] = useState<number[]>([]);
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 450);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    loadTags();
  }, []);

  useEffect(() => {
    setOffset(0);
    setSelectedContacts([]);
  }, [debouncedSearch, selectedTags, filterWhatsapp, filterOptIn, filterOptOut]);

  useEffect(() => {
    loadContacts();
  }, [debouncedSearch, selectedTags, offset, showAll, filterWhatsapp, filterOptIn, filterOptOut]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const buildListQueryParams = () => {
    const currentLimit = showAll ? 10000 : limit;
    const params = new URLSearchParams({
      limit: currentLimit.toString(),
      offset: offset.toString(),
    });
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
    if (filterWhatsapp === 'true' || filterWhatsapp === 'false') params.append('whatsappValidated', filterWhatsapp);
    if (filterOptIn === 'true' || filterOptIn === 'false') params.append('optIn', filterOptIn);
    if (filterOptOut === 'true' || filterOptOut === 'false') params.append('optOut', filterOptOut);
    return params;
  };

  const buildFilterIdsParams = () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
    if (filterWhatsapp === 'true' || filterWhatsapp === 'false') params.append('whatsappValidated', filterWhatsapp);
    if (filterOptIn === 'true' || filterOptIn === 'false') params.append('optIn', filterOptIn);
    if (filterOptOut === 'true' || filterOptOut === 'false') params.append('optOut', filterOptOut);
    return params;
  };

  const loadContacts = async () => {
    try {
      setLoading(true);
      const params = buildListQueryParams();
      const response = await api.get(`/contacts?${params.toString()}`);
      setContacts(response.data.contacts);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Erro ao carregar contatos:', error);
      setToast({ message: 'Erro ao carregar contatos', type: 'error' });
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
    const wasEditing = !!editingContact;
    try {
      let contactId: number;
      if (editingContact) {
        await api.put(`/contacts/${editingContact.id}`, formData);
        contactId = editingContact.id;
      } else {
        const response = await api.post('/contacts', formData);
        contactId = response.data.contact.id;
      }
      
      // Manage tags
      if (editingContact) {
        const tagsToRemove = editingContact.tags?.filter(t => !contactTags.includes(t.id)).map(t => t.id) || [];
        for (const tagId of tagsToRemove) await api.delete(`/contacts/${contactId}/tags/${tagId}`);
        const tagsToAdd = contactTags.filter(tagId => !editingContact.tags?.some(t => t.id === tagId));
        for (const tagId of tagsToAdd) await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
      } else {
        for (const tagId of contactTags) await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
      }
      
      setShowModal(false);
      setEditingContact(null);
      setFormData({ phone_number: '', name: '', email: '', opt_in: true, opt_out: false });
      setContactTags([]);
      setToast({ message: wasEditing ? 'Contato atualizado!' : 'Contato criado!', type: 'success' });
      loadContacts();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao salvar contato', type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar este contato?')) return;
    try {
      await api.delete(`/contacts/${id}`);
      setToast({ message: 'Contato deletado!', type: 'success' });
      loadContacts();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao deletar contato', type: 'error' });
    }
  };

  const handleEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      phone_number: contact.phone_number,
      name: contact.name || '',
      email: contact.email || '',
      opt_in: contact.opt_in !== false,
      opt_out: contact.opt_out === true,
    });
    setContactTags(contact.tags?.map(t => t.id) || []);
    setShowModal(true);
  };

  const handleSelectAllFiltered = async () => {
    try {
      setSelectingAllFiltered(true);
      const params = buildFilterIdsParams();
      const res = await api.get(`/contacts/filter/ids?${params.toString()}`);
      setSelectedContacts(res.data.ids);
      if (res.data.capped) {
        setToast({
          message: `Selecionados os primeiros ${res.data.max} contatos do filtro. Afine a busca se precisar de todos.`,
          type: 'warning',
        });
      } else {
        setToast({ message: `${res.data.count} contato(s) selecionado(s) (filtro atual).`, type: 'info' });
      }
    } catch (error) {
      console.error(error);
      setToast({ message: 'Não foi possível selecionar todos do filtro', type: 'error' });
    } finally {
      setSelectingAllFiltered(false);
    }
  };

  const handleBulkValidateWhatsApp = async () => {
    if (selectedContacts.length === 0) return;
    if (!confirm(`Revalidar WhatsApp na Evolution para ${selectedContacts.length} contato(s)? Requer instância conectada.`)) return;
    try {
      setLoading(true);
      const res = await api.post('/contacts/bulk-update', {
        contact_ids: selectedContacts,
        validate_whatsapp: true,
      });
      setToast({
        message: res.data?.message || `Validação: ${res.data?.validated ?? 0} ok, ${res.data?.invalid ?? 0} inválidos.`,
        type: 'success',
      });
      loadContacts();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro na validação em massa', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTag = async (contactId: number, tagId: number) => {
    try {
      await api.delete(`/contacts/${contactId}/tags/${tagId}`);
      loadContacts();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao remover tag', type: 'error' });
    }
  };

  const handleExportCsv = async () => {
    try {
      setExportingCsv(true);
      const params = buildFilterIdsParams();
      const response = await api.get(`/contacts/export/csv?${params.toString()}`, { responseType: 'blob' });
      const disposition = response.headers['content-disposition'] as string | undefined;
      let filename = 'contatos.csv';
      if (disposition) {
        const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition) || /filename="([^"]+)"/i.exec(disposition);
        if (m?.[1]) filename = decodeURIComponent(m[1].trim());
      }
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      const truncated = String(response.headers['x-export-truncated'] || '').toLowerCase() === 'true';
      setToast({
        message: truncated
          ? 'CSV baixado (primeiros 100.000 contatos deste filtro; refine o filtro se precisar do restante).'
          : 'CSV exportado com sucesso.',
        type: truncated ? 'warning' : 'success',
      });
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao exportar CSV', type: 'error' });
    } finally {
      setExportingCsv(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const textRaw = await file.text();
      const text = textRaw.replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        setToast({ message: 'Arquivo vazio', type: 'error' });
        setLoading(false);
        return;
      }

      const firstCells = parseCSVLine(lines[0]);
      const firstLower = firstCells.map((c) => c.toLowerCase());
      const headerKeys = new Set([
        'phone_number', 'phone', 'telefone', 'celular', 'whatsapp', 'numero',
        'name', 'nome', 'full_name', 'nome_completo',
        'email', 'e_mail', 'email_address',
        'tags', 'tag',
      ]);
      const hasHeader = firstLower.some((c) => headerKeys.has(c));

      let contactsToImport: Array<{ phone_number: string; name: string; email: string; tags?: string }>;

      if (hasHeader) {
        const headers = firstCells;
        contactsToImport = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = parseCSVLine(lines[i]);
          const row = contactFromHeaderRow(headers, cells);
          if (row.phone_number) {
            contactsToImport.push({
              phone_number: row.phone_number,
              name: row.name,
              email: row.email,
              ...(row.tags ? { tags: row.tags } : {}),
            });
          }
        }
      } else {
        contactsToImport = lines
          .map((line) => {
            const parts = parseCSVLine(line);
            return {
              phone_number: parts[0] || '',
              name: parts[1] || '',
              email: parts[2] || '',
              ...(parts[3] ? { tags: parts[3] } : {}),
            };
          })
          .filter((c) => c.phone_number);
      }

      if (contactsToImport.length === 0) {
        setToast({ message: 'Nenhum contato válido encontrado', type: 'error' });
        setLoading(false);
        return;
      }

      const response = await api.post('/contacts/import', { 
        contacts: contactsToImport,
        tags: importTags.length > 0 ? tags.filter(t => importTags.includes(t.id)).map(t => t.name) : []
      });
      
      setToast({ message: `Importação concluída: ${response.data.results.created} criados, ${response.data.results.updated} atualizados.`, type: 'success' });
      setShowImportModal(false);
      loadContacts();
    } catch (error: any) {
      setToast({ message: 'Erro ao importar contatos', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)'
            : toast.type === 'error' ? 'rgba(244,63,94,0.15)'
            : toast.type === 'warning' ? 'rgba(245,158,11,0.15)'
            : 'rgba(56,189,248,0.12)',
          border: `1px solid ${
            toast.type === 'success' ? 'rgba(16,185,129,0.4)'
            : toast.type === 'error' ? 'rgba(244,63,94,0.4)'
            : toast.type === 'warning' ? 'rgba(245,158,11,0.45)'
            : 'rgba(56,189,248,0.35)'
          }`,
          color: toast.type === 'success' ? '#34d399'
            : toast.type === 'error' ? '#fb7185'
            : toast.type === 'warning' ? '#fbbf24'
            : '#38bdf8',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : toast.type === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div style={{ marginBottom: 40 }}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 20px rgba(56, 189, 248, 0.2)',
            }}>
              <Users size={28} color="#0d0c14" strokeWidth={2.5} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif' }}>
                Agenda de Contatos
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Gerencie sua base de {total} contatos e organize por segmentação.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exportingCsv || loading}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, opacity: exportingCsv || loading ? 0.65 : 1 }}
            >
              <Download size={18} />
              <span>{exportingCsv ? 'Exportando…' : 'Exportar CSV'}</span>
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12 }}
            >
              <Upload size={18} />
              <span>Importar CSV</span>
            </button>
            
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', padding: 4, borderRadius: 12, border: '1px solid var(--border)' }}>
              <button
                onClick={() => setViewMode('cards')}
                style={{ padding: 8, borderRadius: 8, background: viewMode === 'cards' ? 'var(--gold-primary)' : 'transparent', color: viewMode === 'cards' ? '#0d0c14' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
              >
                <Grid3x3 size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{ padding: 8, borderRadius: 8, background: viewMode === 'list' ? 'var(--gold-primary)' : 'transparent', color: viewMode === 'list' ? '#0d0c14' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
              >
                <ListIcon size={18} />
              </button>
            </div>

            <button
              onClick={() => {
                setEditingContact(null);
                setFormData({ phone_number: '', name: '', email: '', opt_in: true, opt_out: false });
                setContactTags([]);
                setShowModal(true);
              }}
              className="btn-gold"
              style={{ padding: '10px 24px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Plus size={20} strokeWidth={3} />
              <span>Novo Contato</span>
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ display: 'flex', gap: 12, padding: '14px 20px', marginBottom: 16, borderLeft: '3px solid #38bdf8', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        <Info size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
        <strong style={{ color: 'var(--text-primary)' }}>Disparos</strong> usam só contatos com{' '}
        <strong>WhatsApp validado</strong>, <strong>opt-in</strong> e <strong>sem opt-out</strong>. Se a lista mostra mais gente do que o disparo alcança, filtre aqui por validação/opt-in ou use <strong>Revalidar WhatsApp</strong> com uma instância conectada.
        Contatos com etiqueta <strong>WhatsApp</strong> foram criados ao receber mensagem (webhook), não por importação manual.
        </div>
      </div>

      {/* Filters Area */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 32 }}>
        <div className="flex flex-col gap-5">
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Buscar por nome, telefone ou e-mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '14px 16px 14px 48px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', borderRadius: 12, outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', width: '100%' }}>WhatsApp</span>
            {(['', 'true', 'false'] as const).map((v) => (
              <button
                key={`wa-${v || 'all'}`}
                type="button"
                onClick={() => { setFilterWhatsapp(v); setOffset(0); }}
                className="btn-outline"
                style={{
                  padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem',
                  background: filterWhatsapp === v ? 'rgba(16,185,129,0.12)' : undefined,
                  borderColor: filterWhatsapp === v ? 'rgba(16,185,129,0.35)' : undefined,
                }}
              >
                {v === '' ? 'Todos' : v === 'true' ? 'Validado' : 'Não validado'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', width: '100%' }}>Opt-in</span>
            {(['', 'true', 'false'] as const).map((v) => (
              <button
                key={`optin-${v || 'all'}`}
                type="button"
                onClick={() => { setFilterOptIn(v); setOffset(0); }}
                className="btn-outline"
                style={{
                  padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem',
                  background: filterOptIn === v ? 'rgba(245,158,11,0.12)' : undefined,
                  borderColor: filterOptIn === v ? 'rgba(245,158,11,0.35)' : undefined,
                }}
              >
                {v === '' ? 'Todos' : v === 'true' ? 'Com opt-in' : 'Sem opt-in'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', width: '100%' }}>Opt-out</span>
            {(['', 'false', 'true'] as const).map((v) => (
              <button
                key={`optout-${v || 'all'}`}
                type="button"
                onClick={() => { setFilterOptOut(v); setOffset(0); }}
                className="btn-outline"
                style={{
                  padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem',
                  background: filterOptOut === v ? 'rgba(167,139,250,0.12)' : undefined,
                  borderColor: filterOptOut === v ? 'rgba(167,139,250,0.35)' : undefined,
                }}
              >
                {v === '' ? 'Todos' : v === 'false' ? 'Sem opt-out (ok p/ envio)' : 'Com opt-out'}
              </button>
            ))}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Filter size={18} color="var(--text-muted)" />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tags</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', maxHeight: 120, overflowY: 'auto' }}>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    setSelectedTags(selectedTags.includes(tag.id) ? selectedTags.filter((id) => id !== tag.id) : [...selectedTags, tag.id]);
                    setOffset(0);
                  }}
                  style={{
                    padding: '6px 14px', borderRadius: 100, fontSize: '0.8rem', fontWeight: 600,
                    background: selectedTags.includes(tag.id) ? tag.color : 'rgba(255,255,255,0.05)',
                    color: selectedTags.includes(tag.id) ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${selectedTags.includes(tag.id) ? 'transparent' : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: selectedTags.includes(tag.id) ? '#fff' : tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div style={{ padding: '80px 0', textAlign: 'center' }}>
          <RefreshCw size={40} color="var(--gold-primary)" className="animate-spin" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)' }}>Sincronizando contatos...</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="glass-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <Users size={64} color="var(--border)" strokeWidth={1} style={{ margin: '0 auto 24px' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Nenhum contato encontrado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Tente ajustar seus filtros ou adicione um novo contato.</p>
        </div>
      ) : (
        <>
          {/* Status Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, padding: '0 8px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Mostrando <strong style={{ color: 'var(--gold-primary)' }}>{contacts.length}</strong> de {total} contatos
              {selectedContacts.length > 0 && (
                <>
                  {' '}
                  · <strong style={{ color: 'var(--sky)' }}>{selectedContacts.length}</strong> selecionado(s)
                </>
              )}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedContacts(contacts.map((c) => c.id))}
                className="btn-outline"
                style={{ padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem' }}
              >
                Página atual
              </button>
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                disabled={selectingAllFiltered || total === 0}
                className="btn-outline"
                style={{ padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem', opacity: selectingAllFiltered ? 0.6 : 1 }}
              >
                {selectingAllFiltered ? '…' : `Todos do filtro (${total})`}
              </button>
              {selectedContacts.length > 0 && (
                <>
                  <button type="button" onClick={() => setSelectedContacts([])} className="btn-outline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem' }}>
                    Limpar seleção
                  </button>
                  <button type="button" onClick={handleBulkValidateWhatsApp} className="btn-outline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: '0.78rem', color: '#38bdf8', borderColor: 'rgba(56,189,248,0.35)' }}>
                    Revalidar WhatsApp ({selectedContacts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkTagSelection([]);
                      setShowBulkTagModal(true);
                    }}
                    className="badge badge-gold"
                    style={{ border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: '0.78rem' }}
                  >
                    Ações em massa
                  </button>
                </>
              )}
            </div>
          </div>

          {viewMode === 'cards' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
              {contacts.map(contact => (
                <div key={contact.id} className="glass-card hover-glow" style={{ padding: 0, overflow: 'hidden', transition: 'all 0.3s' }}>
                  {/* Card Header */}
                  <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedContacts(selectedContacts.includes(contact.id) ? selectedContacts.filter(id => id !== contact.id) : [...selectedContacts, contact.id]);
                        }}
                        style={{
                          width: 20, height: 20, borderRadius: 6, border: '2px solid',
                          borderColor: selectedContacts.includes(contact.id) ? 'var(--gold-primary)' : 'var(--border)',
                          background: selectedContacts.includes(contact.id) ? 'var(--gold-primary)' : 'transparent',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {selectedContacts.includes(contact.id) && <CheckCircle2 size={14} color="#0d0c14" strokeWidth={3} />}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                          {contact.name || 'Sem Nome'}
                        </h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
                          {contact.whatsapp_validated ? (
                            <span style={{ fontSize: '0.65rem', color: 'var(--emerald)', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                              <CheckCircle2 size={11} /> WA ok
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>WA pendente</span>
                          )}
                          {contact.opt_in ? (
                            <span style={{ fontSize: '0.65rem', color: '#a78bfa' }}>Opt-in</span>
                          ) : (
                            <span style={{ fontSize: '0.65rem', color: '#fb7185' }}>Sem opt-in</span>
                          )}
                          {contact.opt_out && <span style={{ fontSize: '0.65rem', color: '#fb7185' }}>Opt-out</span>}
                          {contact.source === 'webhook_inbound' && (
                            <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontWeight: 600 }}>WhatsApp</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Phone size={14} color="var(--gold-primary)" />
                        </div>
                        <span style={{ fontWeight: 500 }}>{contact.phone_number}</span>
                      </div>
                      {contact.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(167, 139, 250, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Mail size={14} color="var(--violet)" />
                          </div>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.email}</span>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {contact.tags && contact.tags.length > 0 ? (
                          contact.tags.map(tag => (
                            <div key={tag.id} style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600,
                              background: 'var(--bg-elevated)', border: `1px solid ${tag.color}40`, color: 'var(--text-primary)',
                              display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: tag.color }} />
                              {tag.name}
                              <button
                                onClick={() => handleRemoveTag(contact.id, tag.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Nenhuma tag</span>
                        )}
                        <button
                          onClick={() => handleEdit(contact)}
                          style={{
                            padding: '4px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600,
                            background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <Plus size={10} /> Tag
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'rgba(0,0,0,0.1)' }}>
                    <button
                      onClick={() => handleEdit(contact)}
                      className="btn-outline"
                      style={{ flex: 1, padding: '8px 0', fontSize: '0.8rem', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Edit size={14} /> Editar
                    </button>
                    <button
                      onClick={() => handleDelete(contact.id)}
                      style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(244, 63, 94, 0.1)', color: 'var(--rose)', border: '1px solid rgba(244, 63, 94, 0.2)', cursor: 'pointer' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '16px 20px', textAlign: 'left', width: 40 }}>
                      <div
                        onClick={() => setSelectedContacts(selectedContacts.length === contacts.length ? [] : contacts.map(c => c.id))}
                        style={{
                          width: 20, height: 20, borderRadius: 6, border: '2px solid var(--border)',
                          background: selectedContacts.length === contacts.length ? 'var(--gold-primary)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                        }}
                      >
                        {selectedContacts.length === contacts.length && <CheckCircle2 size={14} color="#0d0c14" strokeWidth={3} />}
                      </div>
                    </th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome</th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Telefone</th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>WA</th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Opt-in</th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Origem</th>
                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags</th>
                    <th style={{ padding: '16px 20px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ações</th>
                  </tr>
                </thead>
                <tbody style={{ borderTop: '1px solid var(--border)' }}>
                  {contacts.map(contact => (
                    <tr key={contact.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="hover:bg-white/[0.02]">
                      <td style={{ padding: '16px 20px' }}>
                        <div
                          onClick={() => setSelectedContacts(selectedContacts.includes(contact.id) ? selectedContacts.filter(id => id !== contact.id) : [...selectedContacts, contact.id])}
                          style={{
                            width: 20, height: 20, borderRadius: 6, border: '2px solid',
                            borderColor: selectedContacts.includes(contact.id) ? 'var(--gold-primary)' : 'var(--border)',
                            background: selectedContacts.includes(contact.id) ? 'var(--gold-primary)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                          }}
                        >
                          {selectedContacts.includes(contact.id) && <CheckCircle2 size={14} color="#0d0c14" strokeWidth={3} />}
                        </div>
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{contact.name || '-'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{contact.email || ''}</div>
                      </td>
                      <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{contact.phone_number}</td>
                      <td style={{ padding: '16px 20px', fontSize: '0.75rem' }}>
                        {contact.whatsapp_validated ? <span style={{ color: '#34d399' }}>Sim</span> : <span style={{ color: 'var(--text-muted)' }}>Não</span>}
                      </td>
                      <td style={{ padding: '16px 20px', fontSize: '0.75rem' }}>
                        {contact.opt_in ? <span style={{ color: '#a78bfa' }}>Sim</span> : <span style={{ color: '#fb7185' }}>Não</span>}
                        {contact.opt_out && <span style={{ color: '#fb7185', display: 'block', fontSize: '0.65rem' }}>opt-out</span>}
                      </td>
                      <td style={{ padding: '16px 20px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {contact.source === 'webhook_inbound' ? <span style={{ color: '#38bdf8', fontWeight: 600 }}>WhatsApp</span> : (contact.source || 'manual')}
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {contact.tags?.map(t => (
                            <span key={t.id} style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', background: `${t.color}20`, color: t.color, border: `1px solid ${t.color}40`, fontWeight: 600 }}>
                              {t.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button onClick={() => handleEdit(contact)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Edit size={16} /></button>
                          <button onClick={() => handleDelete(contact.id)} style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {total > limit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 32 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Mostrando {offset + 1} - {Math.min(offset + limit, total)} de {total}
              </span>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="btn-outline"
                  style={{ padding: '8px 20px', opacity: offset === 0 ? 0.4 : 1 }}
                >
                  Anterior
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="btn-outline"
                  style={{ padding: '8px 20px', opacity: (offset + limit >= total) ? 0.4 : 1 }}
                >
                  Próximo
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal - Adicionar/Editar */}
      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 480, padding: 0, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>
                {editingContact ? 'Editar Contato' : 'Novo Contato'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: 32 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Telefone *</label>
                  <input
                    type="text" required value={formData.phone_number}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    placeholder="Ex: 5511999999999"
                    style={{ width: '100%', padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome Completo</label>
                  <input
                    type="text" value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="João Silva"
                    style={{ width: '100%', padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>E-mail</label>
                  <input
                    type="email" value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="exemplo@gmail.com"
                    style={{ width: '100%', padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, background: 'rgba(0,0,0,0.15)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={formData.opt_in}
                      onChange={(e) => setFormData({ ...formData, opt_in: e.target.checked })}
                    />
                    Opt-in ativo (recomendado para disparos)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={formData.opt_out}
                      onChange={(e) => setFormData({ ...formData, opt_out: e.target.checked })}
                    />
                    Opt-out (não recebe envios automáticos)
                  </label>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags de Segmentação</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px solid var(--border)' }}>
                    {tags.map(tag => (
                      <button
                        key={tag.id} type="button"
                        onClick={() => setContactTags(contactTags.includes(tag.id) ? contactTags.filter(id => id !== tag.id) : [...contactTags, tag.id])}
                        style={{
                          padding: '4px 12px', borderRadius: 100, fontSize: '0.75rem', fontWeight: 600,
                          background: contactTags.includes(tag.id) ? tag.color : 'transparent',
                          color: contactTags.includes(tag.id) ? '#fff' : 'var(--text-secondary)',
                          border: `1px solid ${contactTags.includes(tag.id) ? 'transparent' : 'var(--border)'}`,
                          cursor: 'pointer'
                        }}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-outline" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>Cancelar</button>
                <button type="submit" className="btn-gold" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>{editingContact ? 'Salvar Alterações' : 'Criar Contato'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal - Importar CSV */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 480, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Upload size={32} color="var(--sky)" />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>Importar Lista de Contatos</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>CSV com cabeçalho: phone_number, name, email, tags (opcional). Ou três colunas sem cabeçalho: telefone, nome, email. Use &quot;Exportar CSV&quot; para gerar um arquivo compatível com os filtros atuais.</p>
            </div>
            
            <div style={{ marginBottom: 24 }}>
              <input
                type="file" accept=".csv,.txt"
                onChange={handleImportFile}
                style={{ width: '100%', padding: '40px 20px', border: '2px dashed var(--border)', borderRadius: 16, textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>Aplicar Tags Automáticas</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => setImportTags(importTags.includes(tag.id) ? importTags.filter(id => id !== tag.id) : [...importTags, tag.id])}
                    style={{
                      padding: '4px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600,
                      background: importTags.includes(tag.id) ? tag.color : 'var(--bg-elevated)',
                      color: importTags.includes(tag.id) ? '#fff' : 'var(--text-secondary)',
                      border: 'none', cursor: 'pointer'
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => setShowImportModal(false)} className="btn-outline" style={{ width: '100%', padding: '12px 0', borderRadius: 12 }}>Fechar</button>
          </div>
        </div>
      )}

      {/* Modal - Ações em Massa */}
      {showBulkTagModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 480, padding: 32 }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit', marginBottom: 24 }}>Ações para {selectedContacts.length} contatos</h3>
            
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase' }}>Adicionar Tags Selecionadas</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setBulkTagSelection(bulkTagSelection.includes(tag.id) ? bulkTagSelection.filter(id => id !== tag.id) : [...bulkTagSelection, tag.id])}
                    style={{
                      padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600,
                      background: bulkTagSelection.includes(tag.id) ? tag.color : 'rgba(255,255,255,0.05)',
                      color: bulkTagSelection.includes(tag.id) ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${bulkTagSelection.includes(tag.id) ? 'transparent' : 'var(--border)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                disabled={bulkTagSelection.length === 0}
                onClick={async () => {
                  try {
                    setLoading(true);
                    let ok = 0;
                    let fail = 0;
                    for (const contactId of selectedContacts) {
                      for (const tagId of bulkTagSelection) {
                        try {
                          await api.post(`/contacts/${contactId}/tags`, { tag_id: tagId });
                          ok++;
                        } catch {
                          fail++;
                        }
                      }
                    }
                    setShowBulkTagModal(false);
                    setBulkTagSelection([]);
                    setSelectedContacts([]);
                    if (fail > 0) {
                      setToast({ message: `Tags: ${ok} vínculo(s) ok, ${fail} falha(s). Verifique duplicatas ou rede.`, type: fail >= ok ? 'error' : 'warning' });
                    } else {
                      setToast({ message: 'Tags aplicadas com sucesso!', type: 'success' });
                    }
                    loadContacts();
                  } catch (e) {
                    setToast({ message: 'Erro na operação em massa', type: 'error' });
                  } finally {
                    setLoading(false);
                  }
                }}
                className="btn-gold" style={{ padding: '14px 0', borderRadius: 12, opacity: bulkTagSelection.length === 0 ? 0.5 : 1 }}
              >
                Aplicar Tags
              </button>
              
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Excluir ${selectedContacts.length} contatos definitivamente?`)) return;
                  const n = selectedContacts.length;
                  const ids = [...selectedContacts];
                  try {
                    setLoading(true);
                    let delFail = 0;
                    for (const id of ids) {
                      try {
                        await api.delete(`/contacts/${id}`);
                      } catch {
                        delFail++;
                      }
                    }
                    setShowBulkTagModal(false);
                    setBulkTagSelection([]);
                    setSelectedContacts([]);
                    setToast({
                      message: delFail > 0 ? `${n - delFail} removidos, ${delFail} falha(s).` : 'Contatos excluídos!',
                      type: delFail > 0 ? 'warning' : 'success',
                    });
                    loadContacts();
                  } catch (e) {
                    setToast({ message: 'Erro ao excluir', type: 'error' });
                  } finally {
                    setLoading(false);
                  }
                }}
                style={{ padding: '14px 0', borderRadius: 12, background: 'rgba(244, 63, 94, 0.1)', color: 'var(--rose)', border: '1px solid rgba(244, 63, 94, 0.2)', cursor: 'pointer', fontWeight: 600 }}
              >
                Excluir Todos Selecionados
              </button>
              
              <button type="button" onClick={() => { setShowBulkTagModal(false); setBulkTagSelection([]); }} className="btn-outline" style={{ padding: '12px 0', borderRadius: 12 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
