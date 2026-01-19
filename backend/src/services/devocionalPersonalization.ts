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

  if (devocional.versiculo_principal) {
    message += `📖 *${devocional.versiculo_principal.referencia}*\n`;
    message += `${devocional.versiculo_principal.texto}\n\n`;
  }

  message += `${devocional.text}\n`;

  if (devocional.versiculo_apoio) {
    message += `\n📖 *${devocional.versiculo_apoio.referencia}*\n`;
    message += `${devocional.versiculo_apoio.texto}`;
  }

  return message;
}
