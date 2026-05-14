/**
 * Extrai dados estruturados do HTML da página codigo-postal.org (CEP)
 * Uso: script Node ou automação externa recebendo o HTML (campo body/data).
 *
 * Entrada esperada: item com campo "data" ou "body" contendo o HTML string.
 * Saída: objeto com cep, logradouro, bairro, cidade, estado, mapa_url.
 *
 * Lat/Long: esta página NÃO expõe coordenadas no HTML. O mapa é um iframe
 * do Google Maps com query "CEP X - Brasil". Para lat/long use depois
 * Google Geocoding API ou BrasilAPI (ex: https://brasilapi.com.br/api/cep/v1/{cep}).
 */

function extractCepFromHtml(html) {
  if (!html || typeof html !== 'string') {
    return { error: 'HTML inválido ou vazio' };
  }

  const result = {
    cep: null,
    logradouro: null,
    bairro: null,
    cidade: null,
    estado: null,
    mapa_url: null,
    raw_text: null,
  };

  // 1) CEP do título ou do primeiro parágrafo (padrão 00000-000)
  const cepMatch = html.match(/\b(\d{5})-?(\d{3})\b/);
  if (cepMatch) {
    result.cep = `${cepMatch[1]}-${cepMatch[2]}`;
  }

  // 2) Texto principal: "para [LOGRADOURO] no bairro [BAIRRO] na cidade de [CIDADE]/[ESTADO]"
  // A cidade pode estar em link: <a ...>Ribeirão Preto/SP</a>
  const paragraphMatch = html.match(
    /para\s+([^n]+?)\s+no bairro\s+([^n]+?)\s+na cidade de\s+(?:<a[^>]*>)?([^\/<]+)\/([A-Z]{2})/i
  );
  if (paragraphMatch) {
    result.logradouro = paragraphMatch[1].replace(/\s+/g, ' ').trim();
    result.bairro = paragraphMatch[2].replace(/\s+/g, ' ').trim();
    result.cidade = paragraphMatch[3].replace(/\s+/g, ' ').trim();
    result.estado = paragraphMatch[4].trim();
    result.raw_text = paragraphMatch[0];
  }

  // 3) Fallback: extrair só bairro/cidade se o padrão acima falhar (ex: texto em inglês)
  if (!result.bairro) {
    const bairroMatch = html.match(/O bairro\s+<em>([^<]+)<\/em>\s+pertence/i);
    if (bairroMatch) result.bairro = bairroMatch[1].trim();
  }
  if (!result.cidade) {
    const cidadeMatch = html.match(/na cidade de\s+<a[^>]*>([^<]+)<\/a>/i);
    if (cidadeMatch) result.cidade = cidadeMatch[1].trim();
  }

  // 4) URL do iframe do mapa (Google Maps) - não contém lat/long, só a query do CEP
  const iframeMatch = html.match(
    /<iframe[^>]+src="(https:\/\/maps\.google\.com\/maps\?[^"]+)"/
  );
  if (iframeMatch) {
    result.mapa_url = iframeMatch[1];
    // Decodificar para uso em geocoding: "CEP+14060-550+-+Brasil" -> "14060-550, Brasil"
    result.mapa_query_para_geocode = result.cep ? `${result.cep}, Brasil` : null;
  }

  return result;
}

// --- Exemplo de entrada (automação / script) ---
// Quando o HTTP Request retorna { "data": "<html>..." } (como no seu caso)
function getHtmlFromInput(input) {
  const item = input.first().json;
  if (item?.data) return typeof item.data === 'string' ? item.data : String(item.data);
  if (item?.body) return typeof item.body === 'string' ? item.body : String(item.body);
  const bin = input.first().binary?.data;
  if (bin) return typeof bin === 'string' ? bin : Buffer.from(bin).toString('utf8');
  return '';
}

const html = getHtmlFromInput($input);
const extracted = extractCepFromHtml(html);

// Opcional: se quiser lat/long, use depois a BrasilAPI (sem chave):
// GET https://brasilapi.com.br/api/cep/v1/14060-550
// Retorna: cep, state, city, neighborhood, street, location: { coordinates: { longitude, latitude } }
extracted.obs_lat_long = 'Lat/long não vêm no HTML desta página. Use BrasilAPI ou Google Geocoding com o CEP/cidade.';

return { json: extracted };
