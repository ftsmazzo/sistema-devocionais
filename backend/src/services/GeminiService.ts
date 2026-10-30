import axios from 'axios';
import { addLog } from '../routes/logs';

export interface OpenRouterChatResponse {
  choices?: {
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }[];
  error?: {
    message?: string;
  };
}

/** Mapeia o nome interno (UI/banco) para o slug do OpenRouter. */
export function toOpenRouterModel(model: string): string {
  const m = (model || '').trim();
  if (!m) return 'google/gemini-2.5-flash';
  if (m.includes('/')) return m;
  const bare = m.startsWith('models/') ? m.slice('models/'.length) : m;
  if (bare.startsWith('gemini-')) return `google/${bare}`;
  return bare;
}

function extractMessageText(content: OpenRouterChatResponse['choices']): string {
  const raw = content?.[0]?.message?.content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * Cliente de geração via OpenRouter (API compatível com OpenAI).
 * Mantém o nome GeminiService por compatibilidade com o gerador de devocionais;
 * os modelos continuam sendo Gemini (ex.: google/gemini-2.5-flash).
 */
export class GeminiService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = toOpenRouterModel(model);
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.WEBHOOK_BASE_URL || 'https://devocional.ia.ia.nom.br',
      'X-Title': 'Devocionais ImobMIQ',
    };
  }

  /**
   * Gera conteúdo estruturado (JSON) via OpenRouter
   */
  async generateStructuredContent<T>(prompt: string, schema?: any): Promise<T> {
    try {
      const fullPrompt =
        prompt +
        (schema
          ? '\n\nSua resposta deve ser estritamente um JSON válido seguindo este formato:\n' +
            JSON.stringify(schema, null, 2)
          : '\n\nResponda apenas com o JSON bruto, sem blocos de código markdown.');

      const response = await axios.post<OpenRouterChatResponse>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.model,
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 8192,
          messages: [{ role: 'user', content: fullPrompt }],
          response_format: { type: 'json_object' },
        },
        { headers: this.headers() }
      );

      if (response.data.error?.message) {
        throw new Error(response.data.error.message);
      }

      const text = extractMessageText(response.data.choices);
      if (!text) {
        throw new Error('Nenhum conteúdo gerado pelo OpenRouter');
      }

      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson) as T;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.error ||
        error.message;
      const msg = typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage);
      addLog('error', `[OpenRouter] Erro na geração: ${msg}`);
      if (/API key|auth|unauthorized|401/i.test(msg)) {
        throw new Error(
          `${msg} Confira a chave em https://openrouter.ai/settings/keys — salve de novo em Jornada Bíblica (motor global) ou defina OPENROUTER_API_KEY no ambiente do servidor.`
        );
      }
      throw new Error(`Erro no OpenRouter: ${msg}`);
    }
  }

  /**
   * Gera texto simples
   */
  async generateText(prompt: string): Promise<string> {
    try {
      const response = await axios.post<OpenRouterChatResponse>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.model,
          temperature: 0.7,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        },
        { headers: this.headers() }
      );

      if (response.data.error?.message) {
        throw new Error(response.data.error.message);
      }

      return extractMessageText(response.data.choices);
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.error ||
        error.message;
      const msg = typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage);
      addLog('error', `[OpenRouter] Erro na geração de texto: ${msg}`);
      if (/API key|auth|unauthorized|401/i.test(msg)) {
        throw new Error(
          `${msg} Confira a chave em https://openrouter.ai/settings/keys — salve de novo em Jornada Bíblica ou defina OPENROUTER_API_KEY no servidor.`
        );
      }
      throw new Error(`Erro no OpenRouter: ${msg}`);
    }
  }
}
