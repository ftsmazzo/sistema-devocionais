import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import Switch from '@/components/ui/Switch';
import Label from '@/components/ui/Label';
import Tooltip from '@/components/ui/Tooltip';
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

      // Carregar regras
      const rulesRes = await api.get(`/blindage/rules${instanceId ? `?instanceId=${instanceId}` : ''}`);
      setRules(rulesRes.data.rules || []);
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
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaved(false);

      // Salvar cada regra modificada
      for (const rule of rules) {
        await api.put(`/blindage/rules/${rule.id}`, {
          enabled: rule.enabled,
          config: rule.config,
        });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      alert(error.response?.data?.error || 'Erro ao salvar configurações');
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
  };

  return (
    <div>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Shield className="h-8 w-8 text-blue-600" />
                Configurações de Blindagem
              </h1>
              {instance && (
                <p className="text-gray-600 mt-2">
                  Instância: <span className="font-semibold">{instance.name}</span>
                </p>
              )}
            </div>
            
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2"
            >
              {saved ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Salvo!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Grupos de Blindagem */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Delay Entre Mensagens */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                Delay Entre Mensagens
                <Tooltip content="Controla o tempo mínimo entre o envio de mensagens. O delay progressivo aumenta automaticamente conforme o volume de mensagens enviadas, ajudando a evitar bloqueios." />
              </CardTitle>
              <CardDescription>
                Configure o intervalo de tempo entre envios
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.delay ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Delay</Label>
                    <Switch
                      checked={groupedRules.delay.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.delay!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.delay.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <Label htmlFor="min_delay">
                          Delay Mínimo (segundos)
                          <Tooltip content="Tempo mínimo obrigatório entre cada mensagem enviada. Recomendado: 3-5 segundos." />
                        </Label>
                        <Input
                          id="min_delay"
                          type="number"
                          min="1"
                          max="60"
                          value={groupedRules.delay.config.min_delay_seconds || 3}
                          onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'min_delay_seconds', parseInt(e.target.value))}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="max_delay">
                          Delay Máximo (segundos)
                          <Tooltip content="Tempo máximo que o delay pode atingir quando progressivo. Evita delays muito longos." />
                        </Label>
                        <Input
                          id="max_delay"
                          type="number"
                          min="1"
                          max="300"
                          value={groupedRules.delay.config.max_delay_seconds || 10}
                          onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'max_delay_seconds', parseInt(e.target.value))}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label>Delay Progressivo</Label>
                        <Switch
                          checked={groupedRules.delay.config.progressive !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.delay!.id, 'progressive', checked)}
                        />
                      </div>
                      
                      {groupedRules.delay.config.progressive !== false && (
                        <div className="space-y-4 pt-4 border-t">
                          <div>
                            <Label htmlFor="base_delay">
                              Delay Base (segundos)
                              <Tooltip content="Delay inicial quando o sistema começa a enviar mensagens." />
                            </Label>
                            <Input
                              id="base_delay"
                              type="number"
                              min="1"
                              value={groupedRules.delay.config.base_delay || 3}
                              onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'base_delay', parseFloat(e.target.value))}
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="increment">
                              Incremento por Mensagem
                              <Tooltip content="Quantos segundos são adicionados ao delay a cada mensagem enviada. Exemplo: 0.5 = +0.5s por mensagem." />
                            </Label>
                            <Input
                              id="increment"
                              type="number"
                              min="0"
                              step="0.1"
                              value={groupedRules.delay.config.increment_per_message || 0.5}
                              onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'increment_per_message', parseFloat(e.target.value))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 2. Limite de Mensagens */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                Limite de Mensagens
                <Tooltip content="Define limites máximos de mensagens que podem ser enviadas por hora e por dia. Ajuda a evitar bloqueios por excesso de envios." />
              </CardTitle>
              <CardDescription>
                Configure limites de envio por período
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.limit ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Limites</Label>
                    <Switch
                      checked={groupedRules.limit.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.limit!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.limit.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <Label htmlFor="max_hour">
                          Máximo por Hora
                          <Tooltip content="Número máximo de mensagens que podem ser enviadas em uma hora. Recomendado: 30-50 mensagens/hora." />
                        </Label>
                        <Input
                          id="max_hour"
                          type="number"
                          min="1"
                          max="1000"
                          value={groupedRules.limit.config.max_per_hour || 50}
                          onChange={(e) => updateRuleConfig(groupedRules.limit!.id, 'max_per_hour', parseInt(e.target.value))}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="max_day">
                          Máximo por Dia
                          <Tooltip content="Número máximo de mensagens que podem ser enviadas em um dia. Recomendado: 300-500 mensagens/dia." />
                        </Label>
                        <Input
                          id="max_day"
                          type="number"
                          min="1"
                          max="10000"
                          value={groupedRules.limit.config.max_per_day || 500}
                          onChange={(e) => updateRuleConfig(groupedRules.limit!.id, 'max_per_day', parseInt(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 3. Rotação de Instâncias */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-blue-600" />
                Rotação de Instâncias
                <Tooltip content="Distribui mensagens entre todas as instâncias conectadas, evitando sobrecarga em uma única instância. Funciona em modo round-robin (rodízio)." />
              </CardTitle>
              <CardDescription>
                Configure a distribuição entre instâncias
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.rotation ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Rotação</Label>
                    <Switch
                      checked={groupedRules.rotation.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.rotation!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.rotation.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <Label htmlFor="min_delay_instances">
                          Delay Mínimo Entre Instâncias (segundos)
                          <Tooltip content="Tempo mínimo entre usar instâncias diferentes. Evita alternância muito rápida." />
                        </Label>
                        <Input
                          id="min_delay_instances"
                          type="number"
                          min="0"
                          max="60"
                          value={groupedRules.rotation.config.min_delay_between_instances || 1}
                          onChange={(e) => updateRuleConfig(groupedRules.rotation!.id, 'min_delay_between_instances', parseInt(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 4. Horários Permitidos */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600" />
                Horários Permitidos
                <Tooltip content="Define em quais horários as mensagens podem ser enviadas. Bloqueia envios em horários de risco (madrugada) e permite apenas em horários comerciais." />
              </CardTitle>
              <CardDescription>
                Configure horários de envio permitidos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.hours ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Controle de Horários</Label>
                    <Switch
                      checked={groupedRules.hours.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.hours!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.hours.enabled && (
                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-600 mb-4">
                        Configure os horários permitidos (0-23). Exemplo: [8, 9, 10, ..., 20] permite envios das 8h às 20h.
                      </p>
                      <div className="space-y-2">
                        <Label>Horários Permitidos (separados por vírgula)</Label>
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
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 5. Health Check */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-blue-600" />
                Health Check
                <Tooltip content="Monitora a saúde das instâncias e pausa envios automaticamente se uma instância estiver com problemas (degradada ou down)." />
              </CardTitle>
              <CardDescription>
                Configure monitoramento de saúde das instâncias
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.health ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Health Check</Label>
                    <Switch
                      checked={groupedRules.health.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.health!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.health.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <Label>Pausar se Degradada</Label>
                        <Switch
                          checked={groupedRules.health.config.pause_if_degraded !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.health!.id, 'pause_if_degraded', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label>Pausar se Down</Label>
                        <Switch
                          checked={groupedRules.health.config.pause_if_down !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.health!.id, 'pause_if_down', checked)}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 6. Validação de Conteúdo */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Validação de Conteúdo
                <Tooltip content="Valida o conteúdo das mensagens antes do envio. Pode bloquear mensagens muito longas ou com palavras proibidas." />
              </CardTitle>
              <CardDescription>
                Configure validações de conteúdo das mensagens
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.content ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Validação</Label>
                    <Switch
                      checked={groupedRules.content.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.content!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.content.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <Label htmlFor="max_length">
                          Tamanho Máximo (caracteres)
                          <Tooltip content="Tamanho máximo permitido para uma mensagem. WhatsApp permite até 4096 caracteres." />
                        </Label>
                        <Input
                          id="max_length"
                          type="number"
                          min="1"
                          max="4096"
                          value={groupedRules.content.config.max_length || 4096}
                          onChange={(e) => updateRuleConfig(groupedRules.content!.id, 'max_length', parseInt(e.target.value))}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="blocked_words">
                          Palavras Bloqueadas (separadas por vírgula)
                          <Tooltip content="Lista de palavras que, se encontradas na mensagem, farão com que ela seja bloqueada. Deixe vazio para não bloquear palavras." />
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
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>

          {/* 7. Validação de Número */}
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-blue-600" />
                Validação de Número
                <Tooltip content="Valida o formato do número de telefone e verifica se está cadastrado no WhatsApp antes de enviar. Usa cache para melhor performance." />
              </CardTitle>
              <CardDescription>
                Configure validação de números de telefone
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedRules.number ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Habilitar Validação</Label>
                    <Switch
                      checked={groupedRules.number.enabled}
                      onCheckedChange={(checked) => updateRule(groupedRules.number!.id, { enabled: checked })}
                    />
                  </div>
                  
                  {groupedRules.number.enabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <Label>Validar Formato</Label>
                        <Switch
                          checked={groupedRules.number.config.validate_format !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'validate_format', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label>Verificar WhatsApp</Label>
                        <Switch
                          checked={groupedRules.number.config.check_whatsapp !== false}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'check_whatsapp', checked)}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label>Verificação Obrigatória</Label>
                        <Switch
                          checked={groupedRules.number.config.require_whatsapp_check === true}
                          onCheckedChange={(checked) => updateRuleConfig(groupedRules.number!.id, 'require_whatsapp_check', checked)}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="cache_hours">
                          Cache (horas)
                          <Tooltip content="Tempo que o resultado da verificação fica em cache. Números verificados não serão verificados novamente durante este período." />
                        </Label>
                        <Input
                          id="cache_hours"
                          type="number"
                          min="1"
                          max="168"
                          value={groupedRules.number.config.cache_hours || 24}
                          onChange={(e) => updateRuleConfig(groupedRules.number!.id, 'cache_hours', parseInt(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Regra não encontrada</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
