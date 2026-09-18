import {
  addMembersSchema,
  createChatSchema,
  createGroupSchema,
  deleteAccountSchema,
  editMessageSchema,
  forwardSchema,
  jsonSchemaOf,
  loginSchema,
  muteChatSchema,
  pinMessageSchema,
  reactionSchema,
  registerSchema,
  sendMessageSchema,
  setAdminSchema,
  updateGroupSchema,
  updateProfileSchema,
} from '@react-chat/shared/schemas';
import { APP_REQUEST_HEADER, UPLOAD_ACCEPT, UPLOAD_MAX_MB } from '@react-chat/shared';

/**
 * O documento OpenAPI da API.
 *
 * São ~50 operações, e até agora o único jeito de saber quais era ler os três
 * arquivos de rota. Os tipos do pacote compartilhado descrevem o que a API
 * devolve, mas só para quem compila TypeScript junto: não serviam a ninguém de
 * fora.
 *
 * O corpo de cada requisição sai do mesmo schema Zod que a valida — não há uma
 * segunda descrição para envelhecer. O resto (caminhos, parâmetros, códigos de
 * resposta) é escrito aqui, e um teste confere que a lista de operações bate
 * com o que o roteador do Express de fato registrou: é o que impede uma rota
 * nova de nascer sem documento, que é como um documento começa a mentir.
 *
 * As respostas vão descritas, e não esquematizadas. O formato delas mora nos
 * tipos do `@react-chat/shared`, que não são schemas em tempo de execução —
 * transcrevê-los aqui criaria justamente a segunda cópia que este arquivo
 * existe para evitar.
 */

/** O que uma operação precisa dizer. O resto o `expand` deduz. */
interface Operation {
  tag: string;
  summary: string;
  description?: string;
  /** Falso nas quatro rotas abertas: entrar, cadastrar, renovar e sair. */
  auth?: boolean;
  /** Nome -> para que serve. Parâmetro de caminho sai do próprio endereço. */
  query?: Record<string, string>;
  /** Schema Zod do corpo, ou 'multipart' quando a rota recebe arquivo. */
  body?: Parameters<typeof jsonSchemaOf>[0] | 'multipart';
  /** Campos do multipart escritos à mão — o arquivo, que schema nenhum descreve. */
  form?: Record<string, string>;
  /**
   * Os demais campos do multipart, tirados do schema que os valida.
   *
   * O envio de mensagem é multipart porque carrega o anexo, mas `text` e
   * `replyToId` passam pelo mesmo Zod das rotas JSON — e é de lá que a
   * descrição deles deve sair, e não de uma segunda cópia aqui.
   */
  formFrom?: Parameters<typeof jsonSchemaOf>[0];
  /** Exige o cabeçalho que marca a requisição como vinda do app. */
  appHeader?: boolean;
  /** Código -> o que ele significa nesta rota. */
  responses: Record<string, string>;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** Os parâmetros de caminho saem do próprio endereço: `/chats/{id}` tem `id`. */
function pathParams(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((found) => ({
    name: found[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function queryParams(query: Record<string, string> = {}) {
  return Object.entries(query).map(([name, description]) => ({
    name,
    in: 'query',
    required: false,
    description,
    schema: { type: 'string' },
  }));
}

/**
 * Resposta de erro sempre com o corpo do `errorHandler`; resposta de sucesso
 * só com a descrição — ver o cabeçalho deste arquivo.
 */
function expandResponses(responses: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(responses).map(([status, description]) => [
      status,
      status.startsWith('2')
        ? { description }
        : {
            description,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Erro' } },
            },
          },
    ]),
  );
}

function expandBody(operation: Operation) {
  if (!operation.body) return {};

  if (operation.body === 'multipart') {
    const doSchema = operation.formFrom
      ? ((jsonSchemaOf(operation.formFrom)['properties'] ?? {}) as Record<string, unknown>)
      : {};

    const aMao = Object.fromEntries(
      Object.entries(operation.form ?? {}).map(([name, description]) => [
        name,
        { type: 'string', description },
      ]),
    );

    return {
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { ...doSchema, ...aMao } },
          },
        },
      },
    };
  }

  return {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: jsonSchemaOf(operation.body) } },
    },
  };
}

function expand(path: string, operation: Operation) {
  const parameters = [
    ...pathParams(path),
    ...queryParams(operation.query),
    ...(operation.appHeader
      ? [
          {
            name: APP_REQUEST_HEADER,
            in: 'header',
            required: true,
            description: 'Marca a requisição como vinda do app — ver middlewares/csrf.',
            schema: { type: 'string' },
          },
        ]
      : []),
  ];

  return {
    tags: [operation.tag],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.auth === false ? { security: [] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...expandBody(operation),
    responses: expandResponses(operation.responses),
  };
}

/** Respostas que quase toda rota autenticada tem, para não repeti-las. */
const AUTENTICADA = {
  '401': 'Sem token, token vencido, ou sessão encerrada.',
} as const;

const RECUSADA = {
  '403': 'Você não participa desta conversa, ou não tem permissão para isto.',
} as const;

const NAO_ENCONTRADA = { '404': 'Não existe, ou não existe para você.' } as const;

const INVALIDA = { '400': 'Dados inválidos — o corpo traz `issues` com o que falhou.' };

const routes: Record<string, Partial<Record<Method, Operation>>> = {
  // ------------------------------------------------------------------ conta
  '/api/auth/register': {
    post: {
      tag: 'Conta',
      summary: 'Cria a conta e já abre a sessão',
      description:
        'Devolve o access token, o id da sessão e a primeira página da lista de conversas. O refresh vai num cookie httpOnly.',
      auth: false,
      body: registerSchema,
      responses: {
        '201': 'Conta criada e sessão aberta.',
        ...INVALIDA,
        '409': 'Este e-mail já está cadastrado.',
        '429': 'Muitas contas criadas deste endereço.',
      },
    },
  },
  '/api/auth/login': {
    post: {
      tag: 'Conta',
      summary: 'Entra na conta',
      auth: false,
      body: loginSchema,
      responses: {
        '200': 'Sessão aberta.',
        '401': 'E-mail ou senha incorretos — a mesma resposta para os dois, de propósito.',
        '429': 'Muitas tentativas de login.',
      },
    },
  },
  '/api/auth/refresh': {
    post: {
      tag: 'Conta',
      summary: 'Renova o access token pelo cookie',
      description:
        'Não leva header de autenticação: quem chama é justamente quem está com o token vencido. O refresh é rotacionado — o antigo deixa de valer na mesma hora.',
      auth: false,
      appHeader: true,
      responses: {
        '200': 'Token novo.',
        '401': 'Não há sessão viva neste navegador.',
        '403': 'Requisição sem a marca do app.',
        '429': 'Muitas renovações seguidas.',
      },
    },
  },
  '/api/auth/logout': {
    post: {
      tag: 'Conta',
      summary: 'Encerra a sessão deste dispositivo',
      auth: false,
      appHeader: true,
      responses: {
        '200': 'Sessão encerrada e cookie apagado.',
        '403': 'Requisição sem a marca do app.',
      },
    },
  },
  '/api/auth/me': {
    get: {
      tag: 'Conta',
      summary: 'Restaura a sessão: o usuário e a primeira página das conversas',
      responses: { '200': 'O usuário autenticado.', ...AUTENTICADA },
    },
  },

  // ------------------------------------------------------------------ perfil
  '/api/me': {
    get: {
      tag: 'Perfil',
      summary: 'O próprio perfil',
      responses: { '200': 'O perfil, com e-mail e ajustes de privacidade.', ...AUTENTICADA },
    },
    patch: {
      tag: 'Perfil',
      summary: 'Edita nome, foto, bio, status, privacidade ou senha',
      description:
        'Trocar a senha encerra as sessões dos outros dispositivos. String vazia em foto, bio e recado significa "limpar".',
      body: updateProfileSchema,
      responses: { '200': 'O perfil atualizado.', ...INVALIDA, ...AUTENTICADA },
    },
    delete: {
      tag: 'Perfil',
      summary: 'Exclui a conta',
      description:
        'Anonimiza em vez de apagar: nome, e-mail, senha, foto, bio e presença somem, e as mensagens continuam nas conversas de quem ficou, atribuídas a "Usuário excluído". Sem volta.',
      body: deleteAccountSchema,
      responses: {
        '200': 'Conta excluída; todas as sessões caem.',
        '400': 'Senha incorreta.',
        ...AUTENTICADA,
      },
    },
  },
  '/api/me/export': {
    get: {
      tag: 'Perfil',
      summary: 'Baixa seus dados em JSON',
      description:
        'Perfil, conversas, as mensagens que você enviou, reações, salvas, bloqueados e dispositivos. O que outras pessoas escreveram não entra.',
      responses: {
        '200': 'Arquivo JSON, como anexo.',
        ...AUTENTICADA,
        '429': 'Muitas exportações seguidas.',
      },
    },
  },
  '/api/me/avatar': {
    post: {
      tag: 'Perfil',
      summary: 'Envia uma foto de perfil',
      description: `Só imagem. A foto é reduzida a um quadrado de 512px em webp. Devolve a URL — quem a grava no perfil é o PATCH /api/me. Limite de ${String(UPLOAD_MAX_MB)} MB.`,
      body: 'multipart',
      form: { image: 'O arquivo de imagem.' },
      responses: {
        '200': 'A URL da foto.',
        '400': 'Não é imagem, passa do limite, ou o conteúdo não bate com o tipo.',
        ...AUTENTICADA,
        '429': 'Muitos envios seguidos.',
      },
    },
  },
  '/api/me/chats': {
    get: {
      tag: 'Perfil',
      summary: 'A lista de conversas, paginada por cursor — e a busca nelas',
      description:
        'Com `q`, filtra por nome **e** por conteúdo, e o resultado continua paginado. A conversa que casou pelo conteúdo vem com `matchedMessage`; a que casou pelo nome, não. O nome vale desde a primeira letra; o conteúdo, a partir de duas.',
      query: {
        limit: 'Quantas por página (1 a 100).',
        cursor: 'Id da conversa que fechou a página anterior.',
        q: 'Filtra por nome de conversa ou por conteúdo das mensagens.',
      },
      responses: {
        '200': 'As conversas e o cursor da próxima página.',
        '400': 'Parâmetro "limit" inválido.',
        ...AUTENTICADA,
        '429': 'Muitas buscas seguidas.',
      },
    },
  },
  '/api/me/contacts': {
    get: {
      tag: 'Perfil',
      summary: 'Contatos para iniciar conversa ou montar grupo',
      query: { q: 'Filtra por nome ou e-mail. Sem termo, a primeira página em ordem alfabética.' },
      responses: { '200': 'Até uma página de contatos.', ...AUTENTICADA, '429': 'Muitas buscas.' },
    },
  },
  '/api/me/blocks': {
    get: {
      tag: 'Perfil',
      summary: 'Quem você bloqueou',
      responses: { '200': 'As pessoas bloqueadas, com nome e foto.', ...AUTENTICADA },
    },
  },
  '/api/me/blocks/{userId}': {
    post: {
      tag: 'Perfil',
      summary: 'Bloqueia um contato',
      description: 'Silencioso: o bloqueado não é avisado, o envio dele apenas falha.',
      responses: { '200': 'Bloqueado.', ...INVALIDA, ...AUTENTICADA, ...NAO_ENCONTRADA },
    },
    delete: {
      tag: 'Perfil',
      summary: 'Desbloqueia um contato',
      responses: { '200': 'Desbloqueado.', ...AUTENTICADA },
    },
  },
  '/api/me/sessions': {
    get: {
      tag: 'Perfil',
      summary: 'Dispositivos com sessão aberta',
      responses: { '200': 'As sessões vivas.', ...AUTENTICADA },
    },
    delete: {
      tag: 'Perfil',
      summary: 'Encerra as outras sessões',
      query: { keep: 'O id da sessão atual, que fica.' },
      responses: { '200': 'Quantas foram encerradas.', ...INVALIDA, ...AUTENTICADA },
    },
  },
  '/api/me/sessions/{id}': {
    delete: {
      tag: 'Perfil',
      summary: 'Encerra uma sessão',
      description: 'O socket dela cai na hora, e o access token dela para de valer.',
      responses: { '200': 'Encerrada.', ...AUTENTICADA, ...NAO_ENCONTRADA },
    },
  },
  '/api/me/saved/ids': {
    get: {
      tag: 'Perfil',
      summary: 'Ids das mensagens salvas',
      responses: { '200': 'Os ids — é o que a estrela de cada mensagem precisa.', ...AUTENTICADA },
    },
  },
  '/api/me/saved': {
    get: {
      tag: 'Perfil',
      summary: 'As mensagens salvas, com conteúdo',
      responses: { '200': 'As salvas visíveis para você.', ...AUTENTICADA },
    },
  },
  '/api/me/saved/{messageId}': {
    post: {
      tag: 'Perfil',
      summary: 'Salva uma mensagem',
      description: 'Privado: o autor da mensagem nunca fica sabendo.',
      responses: { '200': 'Salva.', ...AUTENTICADA, ...RECUSADA, ...NAO_ENCONTRADA },
    },
    delete: {
      tag: 'Perfil',
      summary: 'Tira uma mensagem das salvas',
      responses: { '200': 'Removida.', ...AUTENTICADA },
    },
  },

  // --------------------------------------------------------------- conversas
  '/api/chats': {
    post: {
      tag: 'Conversas',
      summary: 'Abre (ou reabre) a conversa direta com alguém',
      description: '201 quando ela nasce agora; 200 quando já existia.',
      body: createChatSchema,
      responses: {
        '200': 'A conversa que já existia.',
        '201': 'Conversa criada.',
        ...INVALIDA,
        ...AUTENTICADA,
        '403': 'Há bloqueio entre vocês.',
        ...NAO_ENCONTRADA,
        '429': 'Muitas conversas criadas.',
      },
    },
  },
  '/api/chats/groups': {
    post: {
      tag: 'Conversas',
      summary: 'Cria um grupo',
      description: 'Quem cria vira administrador.',
      body: createGroupSchema,
      responses: { '201': 'Grupo criado.', ...INVALIDA, ...AUTENTICADA, '429': 'Muitos grupos criados.' },
    },
  },
  '/api/chats/invites/{code}/join': {
    post: {
      tag: 'Conversas',
      summary: 'Entra num grupo pelo link de convite',
      description: 'Único caminho de entrada que não exige ser administrador.',
      responses: {
        '200': 'Você já estava no grupo.',
        '201': 'Entrou agora.',
        ...AUTENTICADA,
        '404': 'Convite inválido ou revogado.',
      },
    },
  },
  '/api/chats/{id}': {
    get: {
      tag: 'Conversas',
      summary: 'Detalhes da conversa: membros, descrição e convite',
      description: 'O link de convite só vai para administrador.',
      responses: { '200': 'Os detalhes.', ...AUTENTICADA, ...RECUSADA, ...NAO_ENCONTRADA },
    },
    patch: {
      tag: 'Conversas',
      summary: 'Muda nome, foto, descrição ou quem pode enviar',
      description: 'Só administrador. Cada mudança deixa um aviso no grupo.',
      body: updateGroupSchema,
      responses: { '200': 'Atualizado.', ...INVALIDA, ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Exclui a conversa da sua lista',
      description:
        'Só para você: o outro continua vendo tudo. Em grupo, exige ter saído antes.',
      responses: {
        '200': 'Fora da sua lista.',
        '400': 'Saia do grupo antes de excluir.',
        ...AUTENTICADA,
        ...RECUSADA,
      },
    },
  },
  '/api/chats/{id}/summary': {
    get: {
      tag: 'Conversas',
      summary: 'A conversa no formato do card da lista',
      description:
        'Existe para o evento `chat-updated` do socket não custar a lista inteira. Devolve `null` quando ela deixou de existir para você.',
      responses: { '200': 'A conversa, ou null.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/members': {
    post: {
      tag: 'Conversas',
      summary: 'Adiciona pessoas ao grupo',
      description: 'Só administrador. Quem já está dentro não conta.',
      body: addMembersSchema,
      responses: { '200': 'Quantas entraram.', ...INVALIDA, ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/members/{userId}': {
    delete: {
      tag: 'Conversas',
      summary: 'Remove alguém do grupo — ou sai dele',
      description:
        'Sair não exige ser administrador; remover outra pessoa, sim. Se o último administrador sair, quem está há mais tempo herda.',
      responses: { '200': 'Removido.', '400': 'Conversa direta não tem como sair.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/members/{userId}/admin': {
    put: {
      tag: 'Conversas',
      summary: 'Promove a administrador, ou tira',
      body: setAdminSchema,
      responses: {
        '200': 'Feito.',
        '400': 'Esta pessoa não está no grupo, ou ele ficaria sem administrador.',
        ...AUTENTICADA,
        ...RECUSADA,
      },
    },
  },
  '/api/chats/{id}/invite': {
    post: {
      tag: 'Conversas',
      summary: 'Gera o link de convite — ou troca o que existia',
      description: 'Gerar de novo invalida o anterior: é assim que se revoga um link que vazou.',
      responses: { '200': 'A URL do convite.', ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Revoga o convite',
      responses: { '200': 'Os links que circulam param de funcionar.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/media': {
    get: {
      tag: 'Conversas',
      summary: 'Galeria: mídia, arquivos e links da conversa',
      description:
        'Sem `tab`, as três listas numa resposta só — trocar de aba não custa uma ida ao servidor. Com `tab` e `cursor`, a próxima página daquela aba; as outras duas voltam vazias. O `hasMore` de cada aba diz se ainda há mais para trás.',
      query: {
        tab: '`media`, `files` ou `links`. Sem ela, a primeira página das três.',
        cursor:
          'Id da última mensagem já mostrada naquela aba — em `links`, o `messageId` do último link. Exige `tab`.',
      },
      responses: {
        '200': 'A página da galeria.',
        '400': '`tab` desconhecida, ou `cursor` sem `tab`.',
        ...AUTENTICADA,
        ...RECUSADA,
      },
    },
  },
  '/api/chats/{id}/pinned': {
    post: {
      tag: 'Conversas',
      summary: 'Fixa uma mensagem no topo da conversa',
      description: 'Compartilhada: todos na conversa veem a mesma.',
      body: pinMessageSchema,
      responses: { '200': 'Fixada.', ...INVALIDA, ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Solta a mensagem fixada',
      responses: { '200': 'Solta.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/readMessages': {
    post: {
      tag: 'Conversas',
      summary: 'Marca a conversa como lida',
      description: 'Quem desligou o recibo de leitura não avisa ninguém — mas o não lido zera do mesmo jeito.',
      responses: { '200': 'Lida.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/unreadMessages': {
    post: {
      tag: 'Conversas',
      summary: 'Marca como não lida',
      description: 'Estado privado: não desfaz o recibo que os outros já viram.',
      responses: { '200': 'Marcada.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/pin': {
    post: {
      tag: 'Conversas',
      summary: 'Fixa a conversa no topo da sua lista',
      responses: { '200': 'Fixada.', ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Desafixa a conversa',
      responses: { '200': 'Desafixada.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/archive': {
    post: {
      tag: 'Conversas',
      summary: 'Arquiva a conversa',
      description: 'Mensagem nova desarquiva sozinha.',
      responses: { '200': 'Arquivada.', ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Tira do arquivo',
      responses: { '200': 'Desarquivada.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/mute': {
    post: {
      tag: 'Conversas',
      summary: 'Silencia a conversa',
      description: 'Sem `minutes` é o "até eu desfazer"; com, é o prazo. O não lido continua contando.',
      body: muteChatSchema,
      responses: { '200': 'Silenciada.', ...INVALIDA, ...AUTENTICADA, ...RECUSADA },
    },
    delete: {
      tag: 'Conversas',
      summary: 'Reativa as notificações',
      responses: { '200': 'Reativada.', ...AUTENTICADA, ...RECUSADA },
    },
  },
  '/api/chats/{id}/clear': {
    post: {
      tag: 'Conversas',
      summary: 'Limpa o histórico só para você',
      description: 'Nenhuma mensagem é apagada: o outro continua vendo tudo.',
      responses: { '200': 'Limpa.', ...AUTENTICADA, ...RECUSADA },
    },
  },

  // --------------------------------------------------------------- mensagens
  '/api/chats/{id}/messages': {
    get: {
      tag: 'Mensagens',
      summary: 'O histórico, paginado nos dois sentidos',
      description:
        'Sem parâmetro, a página mais recente. `before`/`beforeId` andam para trás, `after`/`afterId` para a frente, e `around` abre a janela em volta de uma mensagem.',
      query: {
        before: 'ISO da mensagem mais antiga já carregada.',
        beforeId: 'O id dela — os dois juntos desempatam o milissegundo.',
        after: 'ISO da mensagem mais nova já carregada.',
        afterId: 'O id dela.',
        around: 'Id da mensagem a centrar — o salto até a citação, a fixada ou a busca.',
      },
      responses: {
        '200': 'A página, em ordem cronológica.',
        '400': 'Parâmetro de data inválido.',
        ...AUTENTICADA,
        ...RECUSADA,
        ...NAO_ENCONTRADA,
      },
    },
    post: {
      tag: 'Mensagens',
      summary: 'Envia uma mensagem, com ou sem anexo',
      description: `Multipart porque a mesma rota aceita arquivo. Tipos aceitos: ${UPLOAD_ACCEPT}. Limite de ${String(UPLOAD_MAX_MB)} MB.`,
      body: 'multipart',
      // `text` e `replyToId` saem do próprio schema que os valida; só o
      // arquivo é descrito aqui, porque Zod nenhum o vê.
      formFrom: sendMessageSchema,
      form: { attachment: 'O arquivo. Um por mensagem.' },
      responses: {
        '200': 'A mensagem criada.',
        '400': 'Sem texto e sem anexo, tipo recusado, ou arquivo grande demais.',
        ...AUTENTICADA,
        '403': 'Você não participa, saiu do grupo, há bloqueio, ou só admins enviam.',
        '429': 'Muitas mensagens ou muitos anexos seguidos.',
      },
    },
  },
  '/api/chats/{id}/search': {
    get: {
      tag: 'Mensagens',
      summary: 'Busca dentro da conversa',
      query: { q: 'O termo. Abaixo de dois caracteres a resposta vem vazia.' },
      responses: { '200': 'As ocorrências, em ordem cronológica.', ...AUTENTICADA, ...RECUSADA, '429': 'Muitas buscas.' },
    },
  },
  '/api/chats/{id}/messages/{messageId}': {
    patch: {
      tag: 'Mensagens',
      summary: 'Edita o texto de uma mensagem',
      description: 'Só o autor. A UI passa a mostrar "editada".',
      body: editMessageSchema,
      responses: {
        '200': 'A mensagem atualizada.',
        '400': 'Mensagem apagada não pode ser editada.',
        ...AUTENTICADA,
        '403': 'Só o autor edita.',
        ...NAO_ENCONTRADA,
      },
    },
    delete: {
      tag: 'Mensagens',
      summary: 'Apaga uma mensagem',
      description:
        '`?scope=me` tira só da sua tela, e vale para qualquer mensagem. Sem ele é "para todos": só o autor, e só dentro do prazo.',
      query: { scope: '`me` para apagar só para você.' },
      responses: {
        '200': 'Apagada.',
        '400': 'Fora do prazo para apagar para todos, ou aviso do grupo.',
        ...AUTENTICADA,
        '403': 'Só o autor apaga para todos.',
        ...NAO_ENCONTRADA,
      },
    },
  },
  '/api/chats/{id}/messages/{messageId}/info': {
    get: {
      tag: 'Mensagens',
      summary: 'Quem já leu, e quando',
      description:
        'Só o autor pergunta. Quem desligou o recibo não aparece em nenhuma das listas — nem como lido, nem como pendente.',
      responses: { '200': 'Quem leu e quem falta.', ...AUTENTICADA, '403': 'Só o autor vê.', ...NAO_ENCONTRADA },
    },
  },
  '/api/chats/{id}/messages/{messageId}/forward': {
    post: {
      tag: 'Mensagens',
      summary: 'Encaminha para outras conversas',
      description: 'O anexo é copiado, e não referenciado. A citação não vai junto.',
      body: forwardSchema,
      responses: {
        '200': 'Para quantas conversas foi.',
        '400': 'Mensagem apagada, ou lista de destinos inválida — o corpo traz `issues`.',
        ...AUTENTICADA,
        ...RECUSADA,
        ...NAO_ENCONTRADA,
      },
    },
  },
  '/api/chats/{id}/messages/{messageId}/reaction': {
    put: {
      tag: 'Mensagens',
      summary: 'Reage à mensagem',
      description: 'Uma reação por pessoa: mandar outro emoji troca o anterior.',
      body: reactionSchema,
      responses: {
        '200': 'A mensagem, com as reações agrupadas.',
        '400': 'Mensagem apagada, ou emoji inválido — o corpo traz `issues`.',
        ...AUTENTICADA,
        ...RECUSADA,
        ...NAO_ENCONTRADA,
      },
    },
    delete: {
      tag: 'Mensagens',
      summary: 'Remove a sua reação',
      responses: { '200': 'A mensagem atualizada.', ...AUTENTICADA, ...RECUSADA, ...NAO_ENCONTRADA },
    },
  },

  // ----------------------------------------------------------------- público
  '/uploads/{file}': {
    get: {
      tag: 'Arquivos',
      summary: 'Serve um anexo por URL assinada',
      description:
        'Sem autenticação por header: o `<img>` do navegador não manda nenhum. A assinatura vem dentro da mensagem e expira. `?download=1` força o download.',
      auth: false,
      query: {
        exp: 'Instante de vencimento da assinatura.',
        sig: 'A assinatura HMAC.',
        download: 'Presente, força `Content-Disposition: attachment`.',
      },
      responses: {
        '200': 'O arquivo.',
        '403': 'Link inválido ou expirado.',
        '404': 'Anexo não encontrado.',
      },
    },
  },
  '/health': {
    get: {
      tag: 'Operação',
      summary: 'Sonda de saúde',
      description: 'Toca o banco de propósito: um processo que responde HTTP mas perdeu o SQLite está de pé sem servir para nada.',
      auth: false,
      responses: { '200': 'No ar.', '503': 'Banco indisponível.' },
    },
  },
  '/api/openapi.json': {
    get: {
      tag: 'Operação',
      summary: 'Este documento',
      auth: false,
      responses: { '200': 'O documento OpenAPI.' },
    },
  },
};

/** As operações documentadas, como "MÉTODO /caminho" — o teste compara com o roteador. */
export function documentedOperations(): string[] {
  return Object.entries(routes).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
  );
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'react-socket-chat',
    version: '1.0.0',
    description:
      'Chat em tempo real: conversas diretas e grupos, anexos, reações, menções, busca e presença.\n\nO tempo real não está aqui — ele roda por Socket.IO, e os eventos estão tipados em `@react-chat/shared/events`.',
  },
  servers: [{ url: '/', description: 'O próprio servidor que serve este documento.' }],
  tags: [
    { name: 'Conta', description: 'Cadastro, entrada, renovação e saída.' },
    { name: 'Perfil', description: 'O que é do próprio usuário.' },
    { name: 'Conversas', description: 'Conversas diretas e grupos.' },
    { name: 'Mensagens', description: 'Ler, enviar, editar, apagar, encaminhar e reagir.' },
    { name: 'Arquivos', description: 'Anexos servidos por URL assinada.' },
    { name: 'Operação', description: 'Sonda de saúde e este documento.' },
  ],
  components: {
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'O access token do login, válido por 15 minutos. Ele vive só na memória da aba; quem o renova é o cookie do refresh.',
      },
    },
    schemas: {
      Erro: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', description: 'A mensagem, já em português.' },
          issues: {
            type: 'array',
            description: 'Só na validação: todas as regras que falharam, e não apenas a primeira.',
            items: {
              type: 'object',
              properties: {
                campo: { type: 'string' },
                mensagem: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: Object.fromEntries(
    Object.entries(routes).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, operation]) => [
          method,
          expand(path, operation),
        ]),
      ),
    ]),
  ),
};
