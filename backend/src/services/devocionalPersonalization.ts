/**
 * Personalizar mensagem de devocional
 * Adiciona saudação (Bom dia/Tarde/Noite) + primeiro nome
 */

export function personalizeDevocionalMessage(
  devocionalText: string,
  contactName: string | null,
  timezone: string = 'America/Sao_Paulo'
): string {
  // Obter hora atual no timezone especificado
  const now = new Date();
  const hour = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now).find(part => part.type === 'hour')?.value || '12';

  const hourNum = parseInt(hour, 10);

  // Determinar saudação baseada na hora
  let greeting = '';
  if (hourNum >= 5 && hourNum < 12) {
    greeting = 'Bom dia';
  } else if (hourNum >= 12 && hourNum < 18) {
    greeting = 'Boa tarde';
  } else {
    greeting = 'Boa noite';
  }

  // Extrair primeiro nome do contato
  let firstName = '';
  if (contactName) {
    firstName = contactName.trim().split(' ')[0];
  }

  // Montar mensagem personalizada
  let personalizedMessage = '';

  if (firstName) {
    personalizedMessage = `${greeting}, ${firstName}!\n\n${devocionalText}`;
  } else {
    personalizedMessage = `${greeting}!\n\n${devocionalText}`;
  }

  return personalizedMessage;
}

/**
 * Formatar devocional completo com versículos
 * O texto do devocional já vem completo do N8N (incluindo assinatura e versículos),
 * então verificamos se o texto já contém versículos antes de adicionar
 */
export function formatDevocionalMessage(devocional: {
  title: string;
  text: string;
  versiculo_principal?: {
    texto: string;
    referencia: string;
  };
  versiculo_apoio?: {
    texto: string;
    referencia: string;
  };
}): string {
  let message = `*${devocional.title}*\n\n`;

  // Verificar se o texto já contém a assinatura (indica que o texto já está completo)
  const textoCompleto = devocional.text.includes('Alex e Daniela') || 
                        devocional.text.includes('Mantovani');

  // Verificar se o versículo principal já está no texto
  const versiculoPrincipalNoTexto = devocional.versiculo_principal && 
    (devocional.text.includes(devocional.versiculo_principal.referencia) ||
     devocional.text.includes(devocional.versiculo_principal.texto));

  // Verificar se o versículo de apoio já está no texto
  const versiculoApoioNoTexto = devocional.versiculo_apoio && 
    (devocional.text.includes(devocional.versiculo_apoio.referencia) ||
     devocional.text.includes(devocional.versiculo_apoio.texto));

  // Se o texto já está completo (tem assinatura), não adicionar versículos
  if (textoCompleto) {
    message += devocional.text;
    return message;
  }

  // Adicionar versículo principal apenas se não estiver no texto
  if (devocional.versiculo_principal && !versiculoPrincipalNoTexto) {
    message += `📖 *${devocional.versiculo_principal.referencia}*\n`;
    message += `${devocional.versiculo_principal.texto}\n\n`;
  }

  message += devocional.text;

  // Adicionar versículo de apoio apenas se não estiver no texto
  if (devocional.versiculo_apoio && !versiculoApoioNoTexto) {
    message += `\n\n📖 *${devocional.versiculo_apoio.referencia}*\n`;
    message += `${devocional.versiculo_apoio.texto}`;
  }

  return message;
}
