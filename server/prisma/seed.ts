import bcrypt from 'bcryptjs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaBetterSqlite3({
  url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

/** Custo baixo: o seed cria vários usuários e não é código de produção. */
const BCRYPT_ROUNDS = 8;

/** Igual para todos, e válida pelas regras atuais (8+, letra e número). */
const SENHA = 'senha123';

interface SeedUser {
  key: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
  /// "AVAILABLE" | "BUSY" | "AWAY" — variado para a UI ter os tres pontos.
  status: string;
}

const users: SeedUser[] = [
  {
    key: 'rodrigo',
    name: 'Rodrigo',
    email: 'rodrigo@email.com',
    // Traços definidos na URL em vez de sorteados pelo seed: só com o seed,
    // o avataaars entregava um rosto feminino.
    image:
      'https://api.dicebear.com/9.x/avataaars/svg?seed=rodrigo' +
      '&top=shortFlat&hairColor=2c1b18' +
      '&facialHair=beardMedium&facialHairProbability=100',
    bio: 'Dev front-end. Café, TypeScript e futebol nos fins de semana.',
    status: 'AVAILABLE',
  },
  {
    key: 'luiz',
    name: 'Luiz',
    email: 'luiz@email.com',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=luiz',
    bio: 'Designer de produto. Sempre a fim de discutir espaçamento.',
    status: 'BUSY',
  },
  {
    key: 'marcia',
    name: 'Marcia',
    email: 'marcia@email.com',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=marcia',
    bio: 'QA. Se der para quebrar, eu quebro antes do cliente.',
    status: 'AWAY',
  },
  {
    // Sem foto de propósito: exercita o avatar com ícone genérico.
    key: 'joao',
    name: 'João',
    email: 'joao@email.com',
    // Sem bio de propósito: exercita o estado vazio nos detalhes do contato.
    image: null,
    bio: null,
    status: 'AVAILABLE',
  },
];

interface SeedMessage {
  from: string;
  text: string;
  /** Minutos desde o começo da conversa. */
  at: number;
  /** Índice (na própria conversa) da mensagem sendo respondida. */
  replyTo?: number;
  edited?: boolean;
  deleted?: boolean;
}

interface SeedChat {
  type: 'DIRECT' | 'GROUP';
  name?: string;
  members: string[];
  /** Quem já leu tudo — os demais ficam com mensagens não lidas. */
  readBy: string[];
  /** Há quantas horas a conversa começou. */
  hoursAgo: number;
  messages: SeedMessage[];
}

const chats: SeedChat[] = [
  {
    type: 'DIRECT',
    members: ['rodrigo', 'luiz'],
    readBy: ['luiz'],
    hoursAgo: 2,
    messages: [
      { from: 'luiz', text: 'Rodrigo, conseguiu olhar o roadmap?', at: 0 },
      { from: 'rodrigo', text: 'Olhei sim, terminei as 8 fases ontem', at: 3 },
      { from: 'luiz', text: 'Sério? Até os testes?', at: 4 },
      { from: 'rodrigo', text: '63 testes passando, servidor e client', at: 6 },
      { from: 'luiz', text: 'Isso é ótimo 🎉', at: 7, replyTo: 3 },
      { from: 'rodrigo', text: 'Falta só validar o visual no browser', at: 9 },
      { from: 'luiz', text: 'Me manda quando subir que eu abro aqui', at: 12 },
    ],
  },
  {
    type: 'DIRECT',
    members: ['rodrigo', 'marcia'],
    readBy: ['rodrigo', 'marcia'],
    hoursAgo: 26,
    messages: [
      { from: 'marcia', text: 'Bom dia! O bundle diminuiu mesmo?', at: 0 },
      { from: 'rodrigo', text: 'Caiu de 713 KB para 255 KB na carga inicial', at: 5 },
      { from: 'marcia', text: 'Quase um terço. O que pesava tanto?', at: 6 },
      { from: 'rodrigo', text: 'O faker, importado só para gerar um avatar', at: 8 },
      { from: 'marcia', text: 'Clássico 😅', at: 9 },
      { from: 'rodrigo', text: 'E o rxjs, que nem era usado', at: 11 },
      { from: 'marcia', text: 'Vale documentar isso no README', at: 15 },
    ],
  },
  {
    type: 'DIRECT',
    members: ['rodrigo', 'joao'],
    readBy: ['joao'],
    hoursAgo: 1,
    messages: [
      { from: 'joao', text: 'Opa, o login está pedindo senha forte agora?', at: 0 },
      { from: 'rodrigo', text: 'Está: 8 caracteres, com letra e número', at: 2 },
      { from: 'joao', text: 'Testei com "12345678" e recusou certinho', at: 4 },
      { from: 'rodrigo', text: 'A validação é no backend, o front só exibe', at: 5 },
      { from: 'joao', text: 'mensagem que eu ia apagar', at: 6, deleted: true },
      { from: 'joao', text: 'Boa. E mostra tudo que falta de uma vez?', at: 7 },
      { from: 'rodrigo', text: 'Mostra, o Zod devolve a lista inteira', at: 9 },
    ],
  },
  {
    type: 'DIRECT',
    members: ['luiz', 'marcia'],
    readBy: ['luiz', 'marcia'],
    hoursAgo: 50,
    messages: [
      { from: 'marcia', text: 'Luiz, você viu a tela nova de login?', at: 0 },
      { from: 'luiz', text: 'Ainda não, melhorou?', at: 2 },
      { from: 'marcia', text: 'Bem melhor que a antiga', at: 4 },
    ],
  },
  {
    type: 'GROUP',
    name: 'Time do Chat',
    members: ['rodrigo', 'luiz', 'marcia', 'joao'],
    readBy: ['rodrigo'],
    hoursAgo: 5,
    messages: [
      { from: 'rodrigo', text: 'Abri o grupo para acompanharmos a migração', at: 0 },
      { from: 'marcia', text: 'Boa! Em que pé está?', at: 2 },
      { from: 'rodrigo', text: 'Prisma no lugar do db.json, JWT, TypeScript nos dois lados', at: 4 },
      { from: 'luiz', text: 'O json-server saiu de vez?', at: 6 },
      { from: 'rodrigo', text: 'Saiu. Servia um endpoint só', at: 7, replyTo: 3 },
      { from: 'joao', text: 'E a race condition das mensagens?', at: 10 },
      {
        from: 'rodrigo',
        text: 'Resolvida com transação. Tem teste com 30 envios em paralelo',
        at: 12,
        edited: true,
      },
      { from: 'marcia', text: 'Agora sim dá para levar para produção 🚀', at: 15 },
      { from: 'luiz', text: 'Falta o code splitting?', at: 18 },
      { from: 'joao', text: 'Esse já foi, 16 chunks', at: 20, replyTo: 8 },
    ],
  },
];

async function main() {
  // Ordem importa: as FKs são ON DELETE CASCADE, mas limpamos explicitamente.
  await prisma.message.deleteMany();
  await prisma.chatParticipant.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(SENHA, BCRYPT_ROUNDS);
  const ids = new Map<string, number>();

  for (const [index, user] of users.entries()) {
    const created = await prisma.user.create({
      data: {
        name: user.name,
        email: user.email,
        passwordHash,
        image: user.image,
        bio: user.bio,
        status: user.status,
        isOnline: false,
        // Saidas espalhadas no tempo: sem isto todo contato semeado nasce sem
        // "visto por ultimo", e a tela de detalhes so sabe dizer "Offline".
        // Os minutos crescem com a posicao para dar horarios diferentes.
        lastSeenAt: new Date(Date.now() - (index + 1) * 37 * 60_000),
      },
    });
    ids.set(user.key, created.id);
  }

  const now = Date.now();

  for (const chat of chats) {
    const start = now - chat.hoursAgo * 60 * 60 * 1000;

    const memberIds = chat.members.map((key) => ids.get(key) ?? 0);

    const created = await prisma.chat.create({
      data: {
        type: chat.type,
        ...(chat.name ? { name: chat.name } : {}),
        // Chave do par, como a rota de criar conversa direta grava: é o unique
        // que impede o mesmo par ganhar duas conversas.
        ...(chat.type === 'DIRECT' && memberIds.length === 2
          ? { directKey: `${Math.min(...memberIds)}:${Math.max(...memberIds)}` }
          : {}),
        participants: {
          create: chat.members.map((key) => ({
            userId: ids.get(key) ?? 0,
            // Quem criou o grupo é admin; em conversa direta ninguém é.
            isAdmin: chat.type === 'GROUP' && key === chat.members[0],
          })),
        },
      },
    });

    const createdIds: string[] = [];

    for (const message of chat.messages) {
      const createdAt = new Date(start + message.at * 60 * 1000);
      const replyToId =
        message.replyTo !== undefined ? createdIds[message.replyTo] : undefined;

      const row = await prisma.message.create({
        data: {
          chatId: created.id,
          senderId: ids.get(message.from) ?? 0,
          text: message.deleted ? '' : message.text,
          createdAt,
          ...(replyToId ? { replyToId } : {}),
          ...(message.edited ? { editedAt: new Date(createdAt.getTime() + 60_000) } : {}),
          ...(message.deleted ? { deletedAt: new Date(createdAt.getTime() + 30_000) } : {}),
        },
      });
      createdIds.push(row.id);
    }

    // Quem leu tudo fica com lastReadAt depois da última mensagem;
    // os demais ficam com mensagens não lidas na lista.
    const last = chat.messages.at(-1);
    const lastAt = new Date(start + (last?.at ?? 0) * 60 * 1000 + 1000);

    // O semeador escreve as mensagens direto, sem passar pelo repositório que
    // mantém este campo — e é ele que ordena e pagina a lista de conversas.
    await prisma.chat.update({
      where: { id: created.id },
      data: { lastMessageAt: new Date(start + (last?.at ?? 0) * 60 * 1000) },
    });

    for (const key of chat.readBy) {
      await prisma.chatParticipant.updateMany({
        where: { chatId: created.id, userId: ids.get(key) ?? 0 },
        data: { lastReadAt: lastAt },
      });
    }
  }

  const [totalUsers, totalChats, totalMessages, groups] = await Promise.all([
    prisma.user.count(),
    prisma.chat.count(),
    prisma.message.count(),
    prisma.chat.count({ where: { type: 'GROUP' } }),
  ]);

  console.log(
    `seed concluido: ${totalUsers} usuarios, ${totalChats} conversas ` +
      `(${groups} grupo), ${totalMessages} mensagens`,
  );
  console.log(`senha de todos: ${SENHA}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
