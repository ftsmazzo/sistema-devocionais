import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Switch from '@/components/ui/Switch';
import Label from '@/components/ui/Label';
import Tooltip from '@/components/ui/Tooltip';
import Toast from '@/components/ui/Toast';
import Slider from '@/components/ui/Slider';
import {
  Shield,
  Clock,
  BarChart3,
  RotateCcw,
  Calendar,
  Heart,
  FileText,
  Phone,
  Save,
  CheckCircle2,
  Server,
} from 'lucide-react';

interface BlindageRule {
  id: number;
  instance_id: number;
  rule_name: string;
  rule_type: string;
  enabled: boolean;
  config: any;
}

interface Instance {
  id: number;
  name: string;
  instance_name: string;
}

export default function Blindage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [rules, setRules] = useState<BlindageRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [allInstances, setAllInstances] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, [instanceId]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Carregar instância
      if (instanceId) {
        const instanceRes = await api.get(`/instances/${instanceId}`);
        setInstance(instanceRes.data.instance);
      }

      // Carregar todas as instâncias para seleção
      const instancesRes = await api.get('/instances');
      setAllInstances(instancesRes.data.instances || []);

      // Carregar regras
      const rulesRes = await api.get(`/blindage/rules${instanceId ? `?instanceId=${instanceId}` : ''}`);
      const loadedRules = (rulesRes.data.rules || []).map((rule: any) => ({
        ...rule,
        // Garantir que config seja um objeto, não string
        config: typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config,
      }));
      setRules(loadedRules);
      
      // Se a regra de seleção não existe, criar automaticamente
      const selectionRule = loadedRules.find((r: any) => r.rule_type === 'instance_selection');
      if (!selectionRule && instanceId) {
        try {
          // Criar regra de seleção de instâncias
          await api.post('/blindage/rules', {
            instance_id: parseInt(instanceId),
            rule_name: 'Seleção de Instâncias',
            rule_type: 'instance_selection',
            enabled: true,
            config: {
              selected_instance_ids: [],
              max_simultaneous: 1,
              auto_switch_on_failure: true,
              retry_after_pause: true,
            },
          });
          // Recarregar regras após criar
          const newRulesRes = await api.get(`/blindage/rules${instanceId ? `?instanceId=${instanceId}` : ''}`);
          const newLoadedRules = (newRulesRes.data.rules || []).map((rule: any) => ({
            ...rule,
            config: typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config,
          }));
          setRules(newLoadedRules);
        } catch (error) {
          console.error('Erro ao criar regra de seleção:', error);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      alert('Erro ao carregar configurações de blindagem');
    } finally {
      setLoading(false);
    }
  };

  const updateRule = (ruleId: number, updates: Partial<BlindageRule>) => {
    setRules(rules.map(rule => 
      rule.id === ruleId ? { ...rule, ...updates } : rule
    ));
    setHasChanges(true);
  };

  const updateRuleConfig = (ruleId: number, configKey: string, value: any) => {
    setRules(rules.map(rule => {
      if (rule.id === ruleId) {
        return {
          ...rule,
          config: {
            ...rule.config,
            [configKey]: value,
          },
        };
      }
      return rule;
    }));
    setHasChanges(true);
  };

  const handleSave = async (ruleId?: number) => {
    try {
      setSaving(true);
      setSaved(false);

      // Se ruleId fornecido, salvar apenas essa regra
      const rulesToSave = ruleId 
        ? rules.filter(r => r.id === ruleId)
        : rules;

      // Salvar cada regra modificada
      let savedCount = 0;
      const errors: string[] = [];
      
      for (const rule of rulesToSave) {
        try {
          console.log(`Salvando regra ${rule.id}:`, {
            enabled: rule.enabled,
            config: rule.config,
          });
          
          const response = await api.put(`/blindage/rules/${rule.id}`, {
            enabled: rule.enabled,
            config: rule.config,
          });
          
          console.log(`Regra ${rule.id} salva com sucesso:`, response.data);
          savedCount++;
        } catch (error: any) {
          console.error(`Erro ao salvar regra ${rule.id}:`, error);
          const errorMsg = error.response?.data?.error || error.message || 'Erro desconhecido';
          errors.push(`Regra ${rule.id}: ${errorMsg}`);
        }
      }

      if (errors.length > 0) {
        setToast({
          message: `⚠️ ${savedCount} salva(s), ${errors.length} erro(s): ${errors.join(', ')}`,
          type: 'warning',
        });
      } else {
        setSaved(true);
        if (!ruleId) {
          setHasChanges(false);
        }
        setToast({
          message: `✅ ${savedCount} configuração(ões) salva(s) com sucesso!`,
          type: 'success',
        });
      }
      
      // Recarregar dados para garantir sincronização
      await loadData();
    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      setToast({
        message: `❌ Erro ao salvar: ${error.response?.data?.error || error.message || 'Erro desconhecido'}`,
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando configurações...</p>
        </div>
      </div>
    );
  }

  // Agrupar regras por tipo
  const groupedRules = {
    delay: rules.find(r => r.rule_type === 'message_delay'),
    limit: rules.find(r => r.rule_type === 'message_limit'),
    rotation: rules.find(r => r.rule_type === 'instance_rotation'),
    hours: rules.find(r => r.rule_type === 'allowed_hours'),
    health: rules.find(r => r.rule_type === 'health_check'),
    content: rules.find(r => r.rule_type === 'content_validation'),
    number: rules.find(r => r.rule_type === 'number_validation'),
    selection: rules.find(r => r.rule_type === 'instance_selection'),
  };

  return (
    <div className="relative">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-md">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                Configurações de Blindagem
              </h1>
              {instance && (
                <p className="text-gray-500 text-xs ml-10.5">
                  Instância: <span className="font-semibold text-gray-700">{instance.name}</span>
                </p>
              )}
            </div>
            
            <Button
              onClick={() => handleSave()}
              disabled={saving || !hasChanges}
              size="sm"
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-all ${
                hasChanges
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                  Salvando...
                </>
              ) : saved ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Salvo!
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  {hasChanges ? 'Salvar Tudo' : 'Sem alterações'}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Grupos de Blindagem */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* 1. Delay Entre Mensagens */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Delay Entre Mensagens
                  </CardTitle>
                </div>
                <Tooltip content="Controla o tempo mínimo entre o envio de mensagens. O delay progressivo aumenta automaticamente conforme o volume de mensagens enviadas, ajudando a evitar bloqueios." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.delay ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.delay.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.delay!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.delay.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="min_delay" className="text-xs">
                            Mínimo (s)
                            <Tooltip content="Tempo mínimo entre mensagens. Recomendado: 3-5s." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.delay.config.min_delay_seconds || 3}</span>
                        </div>
                        <Slider
                          value={groupedRules.delay.config.min_delay_seconds || 3}
                          min={1}
                          max={60}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.delay!.id, 'min_delay_seconds', value)}
                        />
                      </div>
                      
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="max_delay" className="text-xs">
                            Máximo (s)
                            <Tooltip content="Tempo máximo do delay progressivo." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.delay.config.max_delay_seconds || 10}</span>
                        </div>
                        <Slider
                          value={groupedRules.delay.config.max_delay_seconds || 10}
                          min={1}
                          max={300}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.delay!.id, 'max_delay_seconds', value)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Progressivo</Label>
                        <Switch
                          checked={groupedRules.delay.config.progressive !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.delay!.id, 'progressive', checked)}
                        />
                      </div>
                      
                      {groupedRules.delay.config.progressive !== false && (
                        <div className="space-y-2 pt-2 border-t border-gray-100">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <Label htmlFor="base_delay" className="text-xs">
                                Base (s)
                                <Tooltip content="Delay inicial." />
                              </Label>
                              <span className="text-xs font-semibold text-indigo-600">{groupedRules.delay.config.base_delay || 3}</span>
                            </div>
                            <Slider
                              value={groupedRules.delay.config.base_delay || 3}
                              min={1}
                              max={30}
                              step={0.5}
                              onChange={(value) => updateRuleConfig(groupedRules.delay!.id, 'base_delay', value)}
                            />
                          </div>
                          
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <Label htmlFor="increment" className="text-xs">
                                Incremento
                                <Tooltip content="Segundos adicionados por mensagem." />
                              </Label>
                              <span className="text-xs font-semibold text-indigo-600">{groupedRules.delay.config.increment_per_message || 0.5}</span>
                            </div>
                            <Slider
                              value={groupedRules.delay.config.increment_per_message || 0.5}
                              min={0}
                              max={2}
                              step={0.1}
                              onChange={(value) => updateRuleConfig(groupedRules.delay!.id, 'increment_per_message', value)}
                            />
                          </div>
                        </div>
                      )}
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.delay!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 2. Limite de Mensagens */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <BarChart3 className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Limite de Mensagens
                  </CardTitle>
                </div>
                <Tooltip content="Define limites máximos de mensagens que podem ser enviadas por hora e por dia. Ajuda a evitar bloqueios por excesso de envios." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.limit ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.limit.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.limit!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.limit.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="max_hour" className="text-xs">
                            Por Hora
                            <Tooltip content="Máximo de mensagens por hora. Recomendado: 30-50." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.limit.config.max_per_hour || 50}</span>
                        </div>
                        <Slider
                          value={groupedRules.limit.config.max_per_hour || 50}
                          min={1}
                          max={1000}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.limit!.id, 'max_per_hour', value)}
                        />
                      </div>
                      
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="max_day" className="text-xs">
                            Por Dia
                            <Tooltip content="Máximo de mensagens por dia. Recomendado: 300-500." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.limit.config.max_per_day || 500}</span>
                        </div>
                        <Slider
                          value={groupedRules.limit.config.max_per_day || 500}
                          min={1}
                          max={10000}
                          step={10}
                          onChange={(value) => updateRuleConfig(groupedRules.limit!.id, 'max_per_day', value)}
                        />
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.limit!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 3. Rotação de Instâncias */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <RotateCcw className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Rotação de Instâncias
                  </CardTitle>
                </div>
                <Tooltip content="Distribui mensagens entre todas as instâncias conectadas, evitando sobrecarga em uma única instância. Funciona em modo round-robin (rodízio)." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.rotation ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.rotation.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.rotation!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.rotation.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="min_delay_instances" className="text-xs">
                            Delay Entre Instâncias (s)
                            <Tooltip content="Tempo mínimo entre usar instâncias diferentes." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.rotation.config.min_delay_between_instances || 1}</span>
                        </div>
                        <Slider
                          value={groupedRules.rotation.config.min_delay_between_instances || 1}
                          min={0}
                          max={60}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.rotation!.id, 'min_delay_between_instances', value)}
                        />
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.rotation!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 4. Horários Permitidos */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Horários Permitidos
                  </CardTitle>
                </div>
                <Tooltip content="Define em quais horários as mensagens podem ser enviadas. Bloqueia envios em horários de risco (madrugada) e permite apenas em horários comerciais." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.hours ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.hours.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.hours!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.hours.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <Label className="text-xs mb-1 block">
                        Horários (0-23, separados por vírgula)
                        <Tooltip content="Exemplo: 8,9,10,11,12,13,14,15,16,17,18,19,20 permite envios das 8h às 20h." />
                      </Label>
                      <Input
                        placeholder="8,9,10,11,12,13,14,15,16,17,18,19,20"
                        value={Array.isArray(groupedRules.hours.config.allowed_hours) 
                          ? groupedRules.hours.config.allowed_hours.join(',') 
                          : ''}
                        onChange={(e) => {
                          const hours = e.target.value
                            .split(',')
                            .map(h => parseInt(h.trim()))
                            .filter(h => !isNaN(h) && h >= 0 && h <= 23);
                          updateRuleConfig(groupedRules.hours!.id, 'allowed_hours', hours);
                        }}
                        className="h-8 text-xs"
                      />
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.hours!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 5. Health Check */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-rose-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Heart className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Health Check
                  </CardTitle>
                </div>
                <Tooltip content="Monitora a saúde das instâncias e pausa envios automaticamente se uma instância estiver com problemas (degradada ou down)." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.health ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.health.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.health!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.health.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Pausar se Degradada</Label>
                        <Switch
                          checked={groupedRules.health.config.pause_if_degraded !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.health!.id, 'pause_if_degraded', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Pausar se Down</Label>
                        <Switch
                          checked={groupedRules.health.config.pause_if_down !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.health!.id, 'pause_if_down', checked)}
                        />
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.health!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 6. Validação de Conteúdo */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Validação de Conteúdo
                  </CardTitle>
                </div>
                <Tooltip content="Valida o conteúdo das mensagens antes do envio. Pode bloquear mensagens muito longas ou com palavras proibidas." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.content ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.content.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.content!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.content.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="max_length" className="text-xs">
                            Tamanho Máximo (caracteres)
                            <Tooltip content="WhatsApp permite até 4096 caracteres." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.content.config.max_length || 4096}</span>
                        </div>
                        <Slider
                          value={groupedRules.content.config.max_length || 4096}
                          min={100}
                          max={4096}
                          step={50}
                          onChange={(value) => updateRuleConfig(groupedRules.content!.id, 'max_length', value)}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="blocked_words" className="text-xs mb-1">
                          Palavras Bloqueadas
                          <Tooltip content="Separadas por vírgula. Deixe vazio para não bloquear." />
                        </Label>
                        <Input
                          id="blocked_words"
                          placeholder="palavra1,palavra2,palavra3"
                          value={Array.isArray(groupedRules.content.config.blocked_words) 
                            ? groupedRules.content.config.blocked_words.join(',') 
                            : ''}
                          onChange={(e) => {
                            const words = e.target.value
                              .split(',')
                              .map(w => w.trim())
                              .filter(w => w.length > 0);
                            updateRuleConfig(groupedRules.content!.id, 'blocked_words', words);
                          }}
                          className="h-8 text-xs"
                        />
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.content!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 7. Validação de Número */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Validação de Número
                  </CardTitle>
                </div>
                <Tooltip content="Valida o formato do número de telefone e verifica se está cadastrado no WhatsApp antes de enviar. Usa cache para melhor performance." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.number ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.number.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.number!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.number.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Validar Formato</Label>
                        <Switch
                          checked={groupedRules.number.config.validate_format !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'validate_format', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Verificar WhatsApp</Label>
                        <Switch
                          checked={groupedRules.number.config.check_whatsapp !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'check_whatsapp', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between py-0.5">
                        <Label className="text-xs mb-0">Verificação Obrigatória</Label>
                        <Switch
                          checked={groupedRules.number.config.require_whatsapp_check === true}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'require_whatsapp_check', checked)}
                        />
                      </div>
                      
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="cache_hours" className="text-xs">
                            Cache (horas)
                            <Tooltip content="Tempo que o resultado da verificação fica em cache." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.number.config.cache_hours || 24}</span>
                        </div>
                        <Slider
                          value={groupedRules.number.config.cache_hours || 24}
                          min={1}
                          max={168}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.number!.id, 'cache_hours', value)}
                        />
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.number!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 8. Seleção de Instâncias */}
          <Card className="border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-br from-gray-50 to-white border-b border-gray-100 py-2.5 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Server className="h-3.5 w-3.5 text-white" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    Seleção de Instâncias
                  </CardTitle>
                </div>
                <Tooltip content="Escolha quais instâncias participarão dos disparos. Quando uma instância cair, o sistema automaticamente trocará para outra disponível." />
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2.5">
              {groupedRules.selection ? (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs mb-0">Habilitar</Label>
                    <Switch
                      checked={groupedRules.selection.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.selection!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.selection.enabled && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label htmlFor="max_instances" className="text-xs">
                            Máximo Simultâneas
                            <Tooltip content="Quantas instâncias usar simultaneamente nos disparos." />
                          </Label>
                          <span className="text-xs font-semibold text-indigo-600">{groupedRules.selection.config.max_simultaneous || 1}</span>
                        </div>
                        <Slider
                          value={groupedRules.selection.config.max_simultaneous || 1}
                          min={1}
                          max={allInstances.length || 10}
                          step={1}
                          onChange={(value) => updateRuleConfig(groupedRules.selection!.id, 'max_simultaneous', value)}
                        />
                      </div>
                      
                      <div>
                        <Label className="text-xs mb-1.5 block">
                          Instâncias Selecionadas
                          <Tooltip content="Marque as instâncias que participarão dos disparos." />
                        </Label>
                        <div className="max-h-40 overflow-y-auto space-y-1.5 p-2 bg-gray-50 rounded-lg border border-gray-100">
                          {allInstances.length === 0 ? (
                            <p className="text-xs text-gray-400">Carregando instâncias...</p>
                          ) : (
                            allInstances.map((inst) => {
                              const selectedIds = Array.isArray(groupedRules.selection?.config.selected_instance_ids) 
                                ? groupedRules.selection.config.selected_instance_ids 
                                : [];
                              const isSelected = selectedIds.includes(inst.id);
                              
                              return (
                                <div key={inst.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded">
                                  <input
                                    type="checkbox"
                                    id={`instance-${inst.id}`}
                                    checked={isSelected}
                                    onChange={(e) => {
                                      const currentIds = Array.isArray(groupedRules.selection?.config.selected_instance_ids) 
                                        ? groupedRules.selection.config.selected_instance_ids 
                                        : [];
                                      const newIds = e.target.checked
                                        ? [...currentIds, inst.id]
                                        : currentIds.filter((id: number) => id !== inst.id);
                                      updateRuleConfig(groupedRules.selection!.id, 'selected_instance_ids', newIds);
                                    }}
                                    className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                  />
                                  <label 
                                    htmlFor={`instance-${inst.id}`} 
                                    className="flex-1 text-xs cursor-pointer flex items-center gap-1.5"
                                  >
                                    <span className="font-medium text-gray-700">{inst.name}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                      inst.status === 'connected' 
                                        ? 'bg-green-100 text-green-700' 
                                        : inst.status === 'connecting'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}>
                                      {inst.status === 'connected' ? 'Conectado' : inst.status === 'connecting' ? 'Conectando' : 'Desconectado'}
                                    </span>
                                  </label>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <Button
                          size="sm"
                          onClick={() => handleSave(groupedRules.selection!.id)}
                          disabled={saving}
                          className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs py-1.5 rounded-lg"
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Toast Notification */}
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
