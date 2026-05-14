import axios from 'axios';
import { addLog } from '../routes/logs';

export interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
  }[];
}

export class GeminiService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Gera conteúdo estruturado (JSON) usando o Gemini
   */
  async generateStructuredContent<T>(prompt: string, schema?: any): Promise<T> {
    try {
      const modelName = this.model.startsWith('models/') ? this.model : `models/${this.model}`;
      const keyQ = encodeURIComponent(this.apiKey.trim());
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${keyQ}`;
      
      const response = await axios.post<GeminiResponse>(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt + (schema ? '\n\nSua resposta deve ser estritamente um JSON válido seguindo este formato:\n' + JSON.stringify(schema, null, 2) : '\n\nResponda apenas com o JSON bruto, sem blocos de código markdown.')
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const text = response.data.candidates[0]?.content.parts[0]?.text;
      if (!text) {
        throw new Error('Nenhum conteúdo gerado pelo Gemini');
      }

      // Limpar possíveis blocos de código markdown se o Gemini os incluir
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      return JSON.parse(cleanJson) as T;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      addLog('error', `[Gemini] Erro na geração: ${errorMessage}`);
      if (typeof errorMessage === 'string' && /API key/i.test(errorMessage)) {
        throw new Error(
          `${errorMessage} Confira a chave em https://aistudio.google.com/apikey — salve de novo em Sessão Devocional (campo de credencial) ou defina GEMINI_API_KEY no ambiente do servidor.`
        );
      }
      throw new Error(`Erro no Gemini: ${errorMessage}`);
    }
  }

  /**
   * Gera texto simples
   */
  async generateText(prompt: string): Promise<string> {
    try {
      const modelName = this.model.startsWith('models/') ? this.model : `models/${this.model}`;
      const keyQ = encodeURIComponent(this.apiKey.trim());
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${keyQ}`;
      
      const response = await axios.post<GeminiResponse>(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
          }
        }
      );

      return response.data.candidates[0]?.content.parts[0]?.text || '';
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      addLog('error', `[Gemini] Erro na geração de texto: ${errorMessage}`);
      if (typeof errorMessage === 'string' && /API key/i.test(errorMessage)) {
        throw new Error(
          `${errorMessage} Confira a chave em https://aistudio.google.com/apikey — salve de novo em Sessão Devocional ou defina GEMINI_API_KEY no servidor.`
        );
      }
      throw new Error(`Erro no Gemini: ${errorMessage}`);
    }
  }
}
