import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UPLOAD_ACCEPT, UPLOAD_MAX_MB, type Chat, type Message } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { appendMessage, removeMessage, replaceMessage } from 'hooks/messageHistory/cache';
import useMessageHistory from 'hooks/messageHistory';
import { useUiStore } from 'store/ui';

/** Erro que o axios devolve com o corpo do errorHandler do servidor. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string } } }).response?.data;
  return data?.error ?? fallback;
}

/**
 * O rascunho e tudo que se manda para o servidor a partir dele.
 *
 * O histórico vem do `useMessageHistory`; aqui ficam o texto sendo digitado, a
 * resposta citada, o anexo escolhido — e as mutações que os transformam em
 * mensagem. O nome era `useMessages`, que se confundia com o store do
 * histórico.
 */
export default function useComposer(chat: Chat | null) {
  const chatId = chat?.id;
  const queryClient = useQueryClient();
  const history = useMessageHistory(chatId);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  /**
   * Trava síncrona do envio. O `isPending` da mutação só muda no render
   * seguinte, e um Enter duplo cabe inteiro antes dele — era assim que saíam
   * duas mensagens.
   */
  const sendingRef = useRef(false);
  /** A conversa de agora: um envio que falhou não devolve o rascunho na errada. */
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  /**
   * Trocar de conversa guarda o que estava escrito e traz o rascunho da outra.
   *
   * Antes o texto era simplesmente descartado: quem estava respondendo, ia
   * conferir algo noutra conversa e voltava, encontrava o campo vazio. A
   * resposta citada e o anexo não sobrevivem de propósito — eles apontam para
   * mensagens e arquivos daquele momento.
   */
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setFile(null);
    setError('');
    setText(chatId ? (useUiStore.getState().drafts[chatId] ?? '') : '');
  }, [chatId]);

  /** Cada tecla também guarda o rascunho, para ele sobreviver à troca. */
  const changeText = useCallback(
    (next: string) => {
      setText(next);
      // Editando não há rascunho a guardar: o texto já existe no servidor, e
      // guardá-lo faria o card anunciar "Rascunho:" por uma edição em curso.
      if (chatId && !editing) useUiStore.getState().setDraft(chatId, next);
    },
    [chatId, editing],
  );

  /**
   * Confere o anexo antes de ele sair da máquina.
   *
   * O seletor não tinha `accept` nem olhava o tamanho: escolher um .zip de
   * 40 MB só falhava depois da subida inteira, com o erro do servidor.
   */
  const chooseFile = useCallback((next: File | null) => {
    if (!next) {
      setFile(null);
      return;
    }

    if (next.size > UPLOAD_MAX_MB * 1024 * 1024) {
      setError(`O anexo passa do limite de ${UPLOAD_MAX_MB} MB.`);
      setFile(null);
      return;
    }

    // O `accept` do seletor é só uma sugestão: o sistema deixa escolher
    // "todos os arquivos", e aí o tipo chega aqui sem ter passado por filtro.
    if (!UPLOAD_ACCEPT.split(',').includes(next.type)) {
      setError('Este tipo de arquivo não é aceito como anexo.');
      setFile(null);
      return;
    }

    setError('');
    setFile(next);
  }, []);

  const startEdit = useCallback((message: Message) => {
    setEditing(message);
    setReplyTo(null);
    setText(message.text);
  }, []);

  const cancelDraft = useCallback(() => {
    setReplyTo(null);
    setEditing(null);
    setText('');
    if (chatId) useUiStore.getState().clearDraft(chatId);
  }, [chatId]);

  /**
   * Quanto do anexo já subiu, de 0 a 100. Zero quando não há envio em curso.
   *
   * Existe porque um anexo de vários megabytes deixava o botão travado sem
   * nenhum sinal de que algo estava acontecendo — e numa conexão lenta isso é
   * indistinguível de travamento.
   */
  const [progress, setProgress] = useState(0);

  const sendMessage = useMutation({
    mutationFn: (form: FormData) =>
      fetch
        .post<Message>(`/api/chats/${chatId ?? ''}/messages`, form, {
          onUploadProgress: (event) => {
            // Sem `total` não há percentual: o navegador nem sempre sabe o
            // tamanho do corpo. Melhor barra indeterminada do que um número
            // inventado sobre um total desconhecido.
            if (!event.total) return;
            setProgress(Math.round((event.loaded / event.total) * 100));
          },
        })
        .then((response) => response.data),
    // O socket traz a mesma mensagem para todo mundo; aqui ela entra na hora,
    // para a conversa não esperar o tempo real do próprio autor.
    onSuccess: (message) => {
      if (chatId) appendMessage(queryClient, chatId, message);
    },
    // Deu certo ou não, a barra some: ela conta o envio, não o resultado.
    onSettled: () => setProgress(0),
  });

  const editMessage = useMutation({
    mutationFn: ({ messageId, value }: { messageId: string; value: string }) =>
      fetch
        .patch<Message>(`/api/chats/${chatId ?? ''}/messages/${messageId}`, { text: value })
        .then((response) => response.data),
    onSuccess: (message) => {
      if (chatId) replaceMessage(queryClient, chatId, message);
    },
  });

  /** Envia ou salva a edição, conforme o rascunho atual. */
  const submit = useCallback(async () => {
    if (!chatId || sendingRef.current) return;
    setError('');

    const trimmed = text.trim();

    if (editing) {
      if (!trimmed) return;

      sendingRef.current = true;
      try {
        await editMessage.mutateAsync({ messageId: editing.id, value: trimmed });
        setEditing(null);
        setText('');
      } catch (err) {
        setError(errorMessage(err, 'Não foi possível editar a mensagem.'));
      } finally {
        sendingRef.current = false;
      }
      return;
    }

    if (!trimmed && !file) return;

    // O rascunho sai da tela antes da ida ao servidor: um segundo Enter não
    // encontra mais nada para mandar. Se o envio falhar, ele volta.
    const draft = { text: trimmed, replyTo, file };
    setText('');
    setReplyTo(null);
    setFile(null);
    // Sai também do rascunho guardado: senão a conversa voltaria a exibir,
    // e o card a anunciar, um texto que já foi enviado.
    useUiStore.getState().clearDraft(chatId);
    sendingRef.current = true;

    try {
      // FormData porque a mesma rota aceita anexo.
      const form = new FormData();
      form.append('text', draft.text);
      if (draft.replyTo) form.append('replyToId', draft.replyTo.id);
      if (draft.file) form.append('attachment', draft.file);

      await sendMessage.mutateAsync(form);
    } catch (err) {
      // Trocou de conversa no meio do envio: o rascunho não é da que está aberta.
      if (chatIdRef.current === chatId) {
        setError(errorMessage(err, 'Não foi possível enviar.'));
        // Sem pisar no que já tiver sido digitado depois do clique.
        setText((current) => {
          const restored = current || draft.text;
          useUiStore.getState().setDraft(chatId, restored);
          return restored;
        });
        setReplyTo((current) => current ?? draft.replyTo);
        setFile((current) => current ?? draft.file);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [chatId, text, editing, file, replyTo, editMessage, sendMessage]);

  /**
   * Apagar, nos dois sentidos que a palavra tem.
   *
   * `'all'` apaga para todos: só o autor, só dentro do prazo, e a mensagem fica
   * na conversa como "mensagem apagada" — o servidor devolve a versão nova e
   * ela substitui a antiga no cache.
   *
   * `'me'` apaga só da sua tela. É privado como bloquear e silenciar: nada é
   * emitido, o autor não fica sabendo, e vale para qualquer mensagem — inclusive
   * as dos outros e as que já passaram do prazo. Aqui a linha some de vez, sem
   * lápide: ela seria um aviso, para você mesmo, do que você mandou sumir.
   *
   * O padrão é `'all'` para o caminho antigo continuar significando o que
   * sempre significou.
   */
  const remove = useCallback(
    async (message: Message, scope: 'me' | 'all' = 'all') => {
      if (!chatId) return;
      const url = `/api/chats/${chatId}/messages/${message.id}`;

      try {
        if (scope === 'me') {
          await fetch.delete(`${url}?scope=me`);
          removeMessage(queryClient, chatId, message.id);
          return;
        }

        const response = await fetch.delete<Message>(url);
        replaceMessage(queryClient, chatId, response.data);
      } catch (err) {
        setError(errorMessage(err, 'Não foi possível apagar a mensagem.'));
      }
    },
    [chatId, queryClient],
  );

  /** Emoji vazio remove a minha reação; o servidor troca a anterior sozinho. */
  const react = useCallback(
    async (message: Message, emoji: string) => {
      if (!chatId) return;
      const url = `/api/chats/${chatId}/messages/${message.id}/reaction`;

      try {
        const response = emoji
          ? await fetch.put<Message>(url, { emoji })
          : await fetch.delete<Message>(url);
        replaceMessage(queryClient, chatId, response.data);
      } catch (err) {
        setError(errorMessage(err, 'Não foi possível reagir.'));
      }
    },
    [chatId, queryClient],
  );

  /** Encaminha para várias conversas; o servidor recusa o lote inteiro se uma falhar. */
  const forward = useCallback(
    async (message: Message, chatIds: string[]) => {
      if (!chatId) return;
      await fetch.post(`/api/chats/${chatId}/messages/${message.id}/forward`, { chatIds });
    },
    [chatId],
  );

  const appendEmoji = useCallback((emoji: string) => {
    setText((current) => current + emoji);
  }, []);

  return {
    messages: history.messages,
    hasMore: history.hasMore,
    isLoading: history.isLoading,
    isLoadingMore: history.isLoadingMore,
    loadOlder: history.loadOlder,
    /**
     * A volta do salto: depois de pular até uma mensagem antiga, o que está na
     * tela é um trecho do meio da conversa, e estes três são o caminho de volta
     * até o fim dela. Fora de um salto, `hasNewer` é sempre falso.
     */
    hasNewer: history.hasNewer,
    isLoadingNewer: history.isLoadingNewer,
    loadNewer: history.loadNewer,
    goToLatest: history.goToLatest,
    /** Salta para uma mensagem fora da tela; ver useMessageHistory. */
    jumpTo: history.jumpTo,
    text,
    setText: changeText,
    replyTo,
    setReplyTo,
    editing,
    startEdit,
    cancelDraft,
    file,
    setFile: chooseFile,
    appendEmoji,
    submit,
    isSending: sendMessage.isPending || editMessage.isPending,
    /** 0–100 enquanto o anexo sobe; 0 fora de um envio. */
    progress,
    remove,
    react,
    forward,
    error,
  };
}
