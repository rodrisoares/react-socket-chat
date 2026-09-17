import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { IoSend, IoClose } from 'react-icons/io5';
import { FiPaperclip, FiSmile } from 'react-icons/fi';

import useEscape from 'hooks/escape';
import { MESSAGE_MAX_LENGTH, UPLOAD_ACCEPT, type Message } from '@react-chat/shared';

// So aparece ao clicar no emoji: chunk proprio.
const EmojiPicker = lazy(() => import('components/EmojiPicker'));

/** Até onde o campo cresce antes de passar a rolar — cerca de seis linhas. */
const MAX_INPUT_HEIGHT = 140;

interface MessageComposerProps {
  text: string;
  onTextChange: (text: string) => void;
  replyTo: Message | null;
  editing: Message | null;
  onCancelDraft: () => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onEmoji: (emoji: string) => void;
  /**
   * Envia. O rascunho não é limpo aqui: quem limpa é o envio, que o devolve
   * se falhar — antes o anexo era descartado no clique e se perdia no erro.
   */
  onSubmit: () => void;
  /** Chamado a cada tecla para emitir o "digitando…". */
  onTyping: () => void;
  /** Envio em andamento: o botão fica travado até a resposta. */
  isSending: boolean;
  /**
   * Quanto do anexo já subiu, de 0 a 100.
   *
   * Um arquivo de vários megabytes deixava o botão travado sem sinal nenhum, e
   * numa conexão lenta isso é indistinguível de travamento.
   */
  progress: number;
}

export default function MessageComposer({
  text,
  onTextChange,
  replyTo,
  editing,
  onCancelDraft,
  file,
  onFileChange,
  onEmoji,
  onSubmit,
  onTyping,
  isSending,
  progress,
}: MessageComposerProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  /** Arquivo pairando sobre o compositor: o alvo precisa se anunciar. */
  const [isDragging, setIsDragging] = useState(false);
  /** Miniatura do anexo, quando ele é imagem. */
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * A miniatura do anexo escolhido.
   *
   * O nome do arquivo não diz qual foto é — com três capturas de tela seguidas,
   * `Captura 2026-09-16 103045.png` não distingue nada. A revogação na limpeza
   * não é zelo: cada `createObjectURL` sem revogar segura o arquivo inteiro na
   * memória da aba até a página recarregar.
   */
  useEffect(() => {
    if (!file?.type.startsWith('image/')) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  /**
   * Colar imagem (Ctrl+V) — uma captura de tela vai direto para a conversa,
   * sem passar por salvar em disco e escolher no seletor.
   *
   * Só intercepta quando há arquivo na área de transferência: colar texto
   * continua sendo colar texto.
   */
  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith('image/'),
    );
    if (!image) return;

    event.preventDefault();
    onFileChange(image);
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    // Sem o preventDefault o navegador abre o arquivo largado e troca a página
    // inteira pela imagem — perdendo a conversa e o que estava escrito.
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function onDragLeave(event: React.DragEvent<HTMLDivElement>) {
    // Passar por cima de um filho dispara `dragleave` no pai: sem esta
    // checagem o realce piscaria a cada movimento do cursor.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    // Um só: a conversa manda um anexo por mensagem.
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFileChange(dropped);
  }

  /**
   * Cresce com o texto, até o teto — e aí rola.
   *
   * A altura é zerada antes de medir: sem isso o `scrollHeight` nunca diminui,
   * e o campo que cresceu não voltaria ao tamanho de uma linha ao ser apagado.
   */
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;

    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [text]);

  // Esc cancela a resposta ou a edição em curso — antes ele fechava a
  // conversa e levava o rascunho junto.
  useEscape(onCancelDraft, Boolean(replyTo ?? editing));

  // Anexo fora do rascunho — enviado ou removido —: o campo de arquivo volta
  // a vazio, para o mesmo arquivo poder ser escolhido de novo.
  useEffect(() => {
    if (!file && fileInputRef.current) fileInputRef.current.value = '';
  }, [file]);

  return (
    <>
      {(replyTo ?? editing) && (
        <div className='display-draft'>
          <span>
            {editing ? 'Editando mensagem' : `Respondendo ${replyTo?.name}`}
            {replyTo && <em>{replyTo.text}</em>}
          </span>
          <button
            type='button'
            onClick={onCancelDraft}
            aria-label={editing ? 'Cancelar edição' : 'Cancelar resposta'}
            title={editing ? 'Cancelar edição (Esc)' : 'Cancelar resposta (Esc)'}
          >
            <IoClose size={16} />
          </button>
        </div>
      )}

      {file && (
        <div className='display-draft'>
          <span>
            {previewUrl ? (
              <img className='display-draft-thumb' src={previewUrl} alt='' />
            ) : (
              <FiPaperclip size={14} />
            )}
            {file.name}
          </span>
          <button
            type='button'
            onClick={() => onFileChange(null)}
            aria-label='Remover anexo'
            title='Remover anexo'
          >
            <IoClose size={16} />
          </button>
        </div>
      )}

      {/*
        A barra fica enquanto o envio dura, inclusive parada em 100: entre o
        último byte e a resposta do servidor ainda há espera, e sumir ali
        deixaria a impressão de que travou no fim.
      */}
      {isSending && progress > 0 && (
        <div
          className='display-progress'
          role='progressbar'
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label='Enviando anexo'
        >
          <div className='display-progress-bar' style={{ width: `${progress}%` }} />
        </div>
      )}

      <div
        className={`display-input${isDragging ? ' is-dragging' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className='display-input-tools'>
          {/* Como na barra de ações da mensagem: são ícones sem rótulo, e o
              `aria-label` sozinho só o leitor de tela lê. */}
          <button
            type='button'
            onClick={() => setShowEmoji((open) => !open)}
            aria-label='Emojis'
            title='Emojis'
            aria-expanded={showEmoji}
          >
            <FiSmile size={18} />
          </button>
          <button
            type='button'
            onClick={() => fileInputRef.current?.click()}
            aria-label='Anexar arquivo'
            title='Anexar arquivo'
          >
            <FiPaperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type='file'
            hidden
            // O seletor já abre filtrado pelo que o servidor aceita; o tamanho
            // e o tipo são conferidos de novo no `useComposer`, porque o
            // `accept` é só uma sugestão que o sistema pode ignorar.
            accept={UPLOAD_ACCEPT}
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          {showEmoji && (
            <Suspense fallback={null}>
              <EmojiPicker
                onSelect={(emoji) => {
                  onEmoji(emoji);
                  setShowEmoji(false);
                }}
                onClose={() => setShowEmoji(false)}
              />
            </Suspense>
          )}
        </div>

        {/*
          `textarea`, e não `input`: a mensagem podia ter 4000 caracteres e a
          pessoa escrevia tudo numa fresta de uma linha, sem como quebrar
          parágrafo. Cresce com o texto até o teto e então rola.
        */}
        <textarea
          ref={textareaRef}
          className='display-input-element'
          placeholder={editing ? 'Edite a mensagem' : 'Digite sua mensagem'}
          aria-label='Mensagem'
          rows={1}
          // O mesmo teto do servidor: recusar depois de digitar seria pior.
          maxLength={MESSAGE_MAX_LENGTH}
          value={text}
          onPaste={onPaste}
          onChange={(event) => {
            onTextChange(event.target.value);
            onTyping();
          }}
          onKeyDown={(event) => {
            // Enter envia, Shift+Enter quebra linha. O `preventDefault` é
            // obrigatório aqui: sem ele o textarea enviaria e ainda quebraria.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          className='display-input-button'
          onClick={onSubmit}
          disabled={isSending}
          aria-busy={isSending}
          aria-label={editing ? 'Salvar edição' : 'Enviar mensagem'}
          title={isSending ? 'Enviando…' : editing ? 'Salvar edição' : 'Enviar mensagem'}
        >
          <IoSend size={16} />
        </button>
      </div>
    </>
  );
}
