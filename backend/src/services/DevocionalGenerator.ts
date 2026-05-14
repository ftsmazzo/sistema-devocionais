import { pool } from '../database';
import { GeminiService } from './GeminiService';
import { addLog } from '../routes/logs';
import { sanitizeDevocionalWhatsappText } from './devocionalWhatsAppText';

interface DevocionalAIConfigRow {
  central_theme: string;
  journey_description: string;
  preaching_tone: string;
  bible_version: string;
  signature: string;
  gemini_api_key: string;
  model_name: string;
  character_limit: number;
}

interface EffectiveJourneyConfig extends DevocionalAIConfigRow {
  journey_id: number | null;
  journey_title: string | null;
  journey_start_date: string | null;
  journey_end_date: string | null;
  is_first_devocional_of_journey: boolean;
}

function parseJsonField<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** Converte valor vindo do pg (Date) ou string ISO / YYYY-MM-DD para AAAA-MM-DD. */
function rowDateToYmd(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

/** Chave real do Gemini: ignora placeholder do front e espaços; senão usa env. */
function resolveGeminiApiKey(dbRaw: unknown, envRaw: string | undefined): string | null {
  const env = typeof envRaw === 'string' ? envRaw.trim() : '';
  const db = typeof dbRaw === 'string' ? dbRaw.trim() : '';
  if (db && db !== '********') return db;
  if (env) return env;
  return null;
}

export class DevocionalGenerator {
  /**
   * Gera um devocional para uma data específica
   */
  async generate(date: string): Promise<any> {
    try {
      addLog('info', `[AI Generator] Iniciando geração de devocional para ${date}`);

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
        throw new Error('Data inválida: use o formato AAAA-MM-DD (ex.: 2026-05-14).');
      }

      const configResult = await pool.query(
        `SELECT * FROM devocional_ai_config
         WHERE enabled IS NULL OR enabled = true
         ORDER BY id DESC LIMIT 1`
      );

      if (configResult.rows.length === 0) {
        throw new Error('Configuração de IA de devocional não encontrada ou desativada (enabled = false).');
      }

      const row = configResult.rows[0];
      const base: DevocionalAIConfigRow = {
        central_theme: row.central_theme ?? '',
        journey_description: row.journey_description ?? '',
        preaching_tone: row.preaching_tone ?? '',
        bible_version: row.bible_version ?? 'ACF',
        signature: row.signature ?? '',
        gemini_api_key: row.gemini_api_key,
        model_name: row.model_name ?? 'gemini-2.5-flash',
        character_limit: Number(row.character_limit) || 4000
      };

      const journeyResult = await pool.query(
        `SELECT * FROM devocional_journeys WHERE is_active = true ORDER BY id DESC LIMIT 1`
      );

      let effective: EffectiveJourneyConfig = {
        ...base,
        journey_id: null,
        journey_title: null,
        journey_start_date: null,
        journey_end_date: null,
        is_first_devocional_of_journey: false
      };

      if (journeyResult.rows.length > 0) {
        const j = journeyResult.rows[0];
        const jStart = rowDateToYmd(j.start_date);
        const jEnd = j.end_date ? rowDateToYmd(j.end_date) : null;
        effective = {
          ...base,
          central_theme: j.central_theme ?? base.central_theme,
          journey_description: j.journey_description ?? base.journey_description,
          preaching_tone: j.preaching_tone ?? base.preaching_tone,
          bible_version: (j.bible_version && String(j.bible_version).trim()) || base.bible_version,
          signature: (j.signature != null && String(j.signature).trim()) ? String(j.signature).trim() : base.signature,
          journey_id: j.id,
          journey_title: j.title ?? null,
          journey_start_date: jStart,
          journey_end_date: jEnd,
          is_first_devocional_of_journey: false
        };

        const prior = await pool.query(
          `SELECT COUNT(*)::int AS c FROM devocionais
           WHERE date::date < $1::date
             AND date::date >= $2::date
             AND ($3::date IS NULL OR date::date <= $3::date)`,
          [date, jStart, jEnd]
        );
        effective.is_first_devocional_of_journey = prior.rows[0].c === 0;
      }

      const apiKey = resolveGeminiApiKey(row.gemini_api_key, process.env.GEMINI_API_KEY);

      if (!apiKey) {
        throw new Error(
          'Chave do Gemini não configurada. Informe a API key em Jornada Bíblica (motor global) ou defina GEMINI_API_KEY no servidor.'
        );
      }

      const gemini = new GeminiService(apiKey.trim(), effective.model_name);

      const [year, month, day] = date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const dataFormatada = `${diasSemana[dateObj.getDay()]}, ${day} de ${meses[month - 1]} de ${year}`;
      addLog('info', `[AI Generator] Data formatada para o prompt: ${dataFormatada}`);

      const histParams: string[] = [date];
      let histWhere = 'date < $1::date';
      if (effective.journey_start_date) {
        histParams.push(effective.journey_start_date);
        histWhere += ` AND date >= $${histParams.length}::date`;
      }
      if (effective.journey_end_date) {
        histParams.push(effective.journey_end_date);
        histWhere += ` AND date <= $${histParams.length}::date`;
      }

      const contextResult = await pool.query(
        `SELECT date, title, metadata, versiculo_principal, versiculo_apoio
         FROM devocionais
         WHERE ${histWhere}
         ORDER BY date DESC
         LIMIT 30`,
        histParams
      );

      const refsUsadas: string[] = [];
      const history = contextResult.rows.map(d => {
        const vp = parseJsonField<{ referencia?: string }>(d.versiculo_principal);
        const va = parseJsonField<{ referencia?: string }>(d.versiculo_apoio);
        if (vp?.referencia) refsUsadas.push(vp.referencia);
        if (va?.referencia) refsUsadas.push(va.referencia);
        const meta = parseJsonField<Record<string, unknown>>(d.metadata) || {};
        return {
          data: d.date,
          titulo: d.title,
          tema: meta.tema,
          conceito: meta.conceito_central,
          palavras_chave: meta.palavras_chave,
          versiculos: [vp?.referencia, va?.referencia].filter(Boolean)
        };
      });

      const refsUnicas = [...new Set(refsUsadas.filter(Boolean))];

      const janelaDesc = effective.journey_id
        ? `Jornada ativa #${effective.journey_id} "${effective.journey_title ?? '—'}". Somente devocionais entre ${effective.journey_start_date ?? '—'} e ${effective.journey_end_date ?? 'aberto'} (e anteriores à data alvo) entram no histórico (${contextResult.rows.length} registros).`
        : 'Nenhuma jornada ativa na tabela de jornadas — usando configuração global e histórico dos últimos 30 devocionais anteriores à data alvo.';

      const blocoJornada = [
        effective.journey_title ? `Nome desta jornada: "${effective.journey_title}".` : null,
        effective.journey_start_date || effective.journey_end_date
          ? `Período desta jornada: início ${effective.journey_start_date ?? '—'}, fim ${effective.journey_end_date ?? '—'}.`
          : null,
        janelaDesc
      ]
        .filter(Boolean)
        .join('\n');

      const blocoPrimeiroJornada = effective.is_first_devocional_of_journey
        ? `
=== PRIMEIRO DEVOCIONAL DESTA JORNADA (NOVO INÍCIO) ===
Não há devocional anterior gravado nesta jornada antes da data que está sendo gerada.
A IA deve assumir que está DANDO O PONTAPÉ desta fase com um propósito novo.

OBRIGAÇÕES ESPECÍFICAS:
- Deixe claro ao leitor que se inicia uma nova etapa (sem inventar outra data no texto além da solicitada no cabeçalho).
- Não use "ontem vimos", "no devocional passado desta série" nem continuidade com dias que não existem nesta jornada.
- Abra o arco com convite, clareza de propósito e fundação espiritual, como largada — sem depender de histórico interno da jornada.
- O tom configurado deve aparecer de forma marcante desde a primeira linha após a data.
`
        : '';

      const analysisPrompt = `
Você é um especialista em análise de conteúdo devocional e jornadas espirituais.

CONFIGURAÇÃO ATIVA (use como âncora — qualquer mudança aqui deve mudar a sugestão de hoje):
- TEMA CENTRAL: "${effective.central_theme}"
- DESCRIÇÃO DA JORNADA (arco, objetivos, tensões espirituais): "${effective.journey_description}"
- TOM DE PREGAÇÃO DESEJADO: "${effective.preaching_tone}"

${blocoJornada}
${blocoPrimeiroJornada}

HISTÓRICO NO PERÍODO CONSIDERADO:
${JSON.stringify(history, null, 2)}

VERSÍCULOS JÁ USADOS NESSE HISTÓRICO (referências exatas — não repetir):
${JSON.stringify(refsUnicas, null, 2)}

SUA MISSÃO:
${effective.is_first_devocional_of_journey
  ? `Esta é a ABERTURA da jornada. Não há progressão prévia nesta fase: proponha o primeiro passo forte, alinhado ao tema e à descrição, sem depender de "continuação" do histórico.`
  : `Analise o histórico e proponha o próximo passo coerente com a DESCRIÇÃO DA JORNADA e o TOM acima.`}

REGRAS:
- Liste temas e ângulos já usados para não repetir o mesmo gancho emocional ou o mesmo argumento (se houver histórico).
- O "próximo passo" deve soar diferente dos títulos/temas recentes quando possível.
- Não sugira versículos que apareçam em VERSÍCULOS JÁ USADOS.
`;

      const analysisSchema = {
        analise: {
          temas_abordados: ['string'],
          versiculos_no_historico: ['string'],
          progressao: 'string',
          proximo_passo: 'string'
        },
        sugestao: {
          tema_sugerido: 'string',
          conceito_central: 'string',
          direcionamento: 'string'
        }
      };

      const analysis = await gemini.generateStructuredContent<any>(analysisPrompt, analysisSchema);
      addLog('info', `[AI Generator] Análise concluída: ${analysis.sugestao?.tema_sugerido ?? '—'}`);

      const listaRefsAnalise = Array.isArray(analysis.analise?.versiculos_no_historico)
        ? analysis.analise.versiculos_no_historico
        : refsUnicas;

      const creationPrompt = `
Você é um Pastor experiente, especializado em pregação bíblica poderosa e inspiradora.

OBRIGAÇÃO DE CONSISTÊNCIA COM A CONFIGURAÇÃO (não é decorativo):
- O texto precisa refletir claramente o TOM abaixo na escolha de palavras, ritmo, humor ou seriedade, e imagens mentais.
- O conteúdo precisa avançar o arco descrito na DESCRIÇÃO DA JORNADA — não use um discurso genérico que poderia servir a qualquer campanha.
- Se esta configuração fosse trocada por outra (tom ou jornada diferentes), o devocional de hoje deveria ficar perceptivelmente diferente. Evite "modelo único" com sinônimos leves.

TOM DE PREGAÇÃO (aplique de verdade): ${effective.preaching_tone}
Versão Bíblica obrigatória nos versículos: ${effective.bible_version}

TEMA CENTRAL DA JORNADA: ${effective.central_theme}
DESCRIÇÃO DA JORNADA (cumpra o arco): ${effective.journey_description}

${blocoJornada}
${blocoPrimeiroJornada}

CONTEXTO ONDE A LISTA ESTÁ (progressão):
"${analysis.analise?.progressao ?? ''}"

PRÓXIMO PASSO SUGERIDO:
"${analysis.analise?.proximo_passo ?? ''}"

DIRECIONAMENTO DE HOJE:
"${analysis.sugestao?.direcionamento ?? ''}"

CONCEITO A TRABALHAR:
"${analysis.sugestao?.conceito_central ?? ''}"

REFERÊNCIAS BÍBLICAS A EVITAR (não repetir; escolha passagens novas):
${JSON.stringify([...new Set([...refsUnicas, ...listaRefsAnalise])], null, 2)}

ESTRUTURA DO DEVOCIONAL (WhatsApp):
1. OBRIGATÓRIO — Use EXATAMENTE esta data na primeira linha: ${dataFormatada}
2. Título inspirador (🌟 *Título*)
3. Dois versículos inéditos (📖 *Versículo Principal* e 📖 *Versículo de Apoio*) na ${effective.bible_version}
4. Reflexão (💬) — 3 a 4 parágrafos
5. Aplicação prática (🌱)
6. Oração (🙏)
7. Assinatura final: ${effective.signature}

REGRAS CRÍTICAS:
- A data no início deve ser EXATAMENTE: "${dataFormatada}".
- NUNCA use ** (asterisco duplo). Use *itálico* só nos rótulos de seção conforme o modelo acima.
- Quebras de linha reais no campo "text" (não escreva a sequência barra+n como texto).
- Limite máximo de ${effective.character_limit} caracteres no campo "text".
- Não inclua saudações tipo "Bom dia" no início.
`;

      const creationSchema = {
        text: 'string (conteúdo completo formatado para WhatsApp)',
        title: 'string (apenas o título, sem emoji inicial)',
        versiculo_principal: {
          texto: 'string',
          referencia: 'string'
        },
        versiculo_apoio: {
          texto: 'string',
          referencia: 'string'
        },
        metadata: {
          tema: 'string',
          conceito_central: 'string',
          palavras_chave: ['string'],
          relacionado_expressar: 'string'
        }
      };

      const result = await gemini.generateStructuredContent<any>(creationPrompt, creationSchema);

      let textOut = sanitizeDevocionalWhatsappText(result.text ?? '');
      if (textOut.length > effective.character_limit) {
        textOut = textOut.slice(0, effective.character_limit);
        addLog('warn', `[AI Generator] Texto truncado ao limite de ${effective.character_limit} caracteres`);
      }
      result.text = textOut;

      const metadataMerged = {
        ...(typeof result.metadata === 'object' && result.metadata ? result.metadata : {}),
        ai_journey_id: effective.journey_id,
        ai_journey_title: effective.journey_title,
        ai_journey_start_date: effective.journey_start_date,
        ai_journey_end_date: effective.journey_end_date,
        ai_is_first_journey_devocional: effective.is_first_devocional_of_journey
      };

      await pool.query(
        `INSERT INTO devocionais (date, title, text, versiculo_principal, versiculo_apoio, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (date) DO UPDATE SET
           title = EXCLUDED.title,
           text = EXCLUDED.text,
           versiculo_principal = EXCLUDED.versiculo_principal,
           versiculo_apoio = EXCLUDED.versiculo_apoio,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
        [
          date,
          result.title,
          result.text,
          JSON.stringify(result.versiculo_principal),
          JSON.stringify(result.versiculo_apoio),
          JSON.stringify(metadataMerged)
        ]
      );

      addLog('success', `[AI Generator] Devocional gerado e salvo para ${date}`);
      return result;
    } catch (error: any) {
      addLog('error', `[AI Generator] Falha na geração: ${error.message}`);
      throw error;
    }
  }
}
