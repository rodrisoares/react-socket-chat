import './styles.scss';
import { useEffect, useState } from 'react';
import { FiPaperclip, FiExternalLink, FiPlay } from 'react-icons/fi';

import Lightbox from 'components/Lightbox';
import useChatGallery from 'hooks/gallery';
import { attachmentUrl } from 'config/env';
import { timeLabel } from 'utils/dayLabel';
import type { Message } from '@react-chat/shared';

type Tab = 'media' | 'files' | 'links';

const TABS: { id: Tab; label: string }[] = [
  { id: 'media', label: 'Mídia' },
  { id: 'files', label: 'Arquivos' },
  { id: 'links', label: 'Links' },
];

/** Só o domínio: a URL inteira estoura a largura do painel. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Mídia, arquivos e links da conversa — o painel que o WhatsApp abre nos
 * detalhes do contato.
 *
 * Uma requisição só, com as três listas: elas vêm juntas do servidor porque
 * trocar de aba não deveria custar uma ida à rede.
 */
export default function ChatGallery({ chatId }: { chatId: string }) {
  const [tab, setTab] = useState<Tab>('media');
  /** Índice aberto no visor; null = fechado. */
  const [mediaIndex, setMediaIndex] = useState<number | null>(null);

  const { gallery, isFailed } = useChatGallery(chatId);

  // Trocar de conversa fecha o visor: o índice era da galeria anterior.
  useEffect(() => setMediaIndex(null), [chatId]);

  const media = gallery?.media ?? [];
  const files = gallery?.files ?? [];
  const links = gallery?.links ?? [];

  /** Contagem na aba: sem ela não dá para saber onde há algo sem clicar. */
  function countOf(id: Tab): number {
    if (id === 'media') return media.length;
    if (id === 'files') return files.length;
    return links.length;
  }

  return (
    <section className='chat-details-section chat-gallery'>
      <h4>Mídia, arquivos e links</h4>

      <div className='chat-gallery-tabs' role='tablist' aria-label='Galeria da conversa'>
        {TABS.map((item) => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            className={`chat-gallery-tabs-item${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {gallery && <span className='chat-gallery-tabs-count'>{countOf(item.id)}</span>}
          </button>
        ))}
      </div>

      {isFailed && (
        <p className='chat-gallery-empty'>Não foi possível carregar a galeria.</p>
      )}
      {!gallery && !isFailed && <p className='chat-gallery-empty'>Carregando…</p>}

      {gallery && tab === 'media' && (
        media.length === 0 ? (
          <p className='chat-gallery-empty'>Nenhuma foto ou vídeo por aqui.</p>
        ) : (
          <div className='chat-gallery-grid'>
            {media.map((message: Message, index: number) => (
              <button
                key={message.id}
                type='button'
                className='chat-gallery-thumb'
                onClick={() => setMediaIndex(index)}
                aria-label={`Abrir ${message.attachment?.name ?? 'mídia'}`}
                // O nome do arquivo não cabe na miniatura: a dica é o único
                // lugar onde ele aparece antes de abrir.
                title={`${message.attachment?.name ?? 'mídia'} · ${message.name}, ${timeLabel(message.createdAt)}`}
              >
                {message.attachment?.type.startsWith('video/') ? (
                  <>
                    {/* O primeiro quadro basta de capa; o áudio nem carrega. */}
                    <video src={attachmentUrl(message.attachment.url)} preload='metadata' muted />
                    <span className='chat-gallery-thumb-play'>
                      <FiPlay size={14} />
                    </span>
                  </>
                ) : (
                  <img
                    // A miniatura quando existe: a grade mostra a imagem com
                    // 80px de lado, e até agora baixava o original inteiro
                    // para isso. Sem miniatura — anexo antigo —, o original.
                    src={attachmentUrl(
                      message.attachment?.thumbnailUrl ?? message.attachment?.url ?? '',
                    )}
                    alt={message.attachment?.name ?? ''}
                    loading='lazy'
                  />
                )}
              </button>
            ))}
          </div>
        )
      )}

      {gallery && tab === 'files' && (
        files.length === 0 ? (
          <p className='chat-gallery-empty'>Nenhum arquivo enviado.</p>
        ) : (
          <ul className='chat-gallery-list'>
            {files.map((message) => (
              <li key={message.id}>
                <a
                  href={attachmentUrl(message.attachment?.url ?? '')}
                  target='_blank'
                  rel='noreferrer'
                >
                  <FiPaperclip size={15} />
                  <span className='chat-gallery-list-text'>
                    <strong>{message.attachment?.name}</strong>
                    <small>
                      {message.name} · {timeLabel(message.createdAt)}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )
      )}

      {gallery && tab === 'links' && (
        links.length === 0 ? (
          <p className='chat-gallery-empty'>Nenhum link compartilhado.</p>
        ) : (
          <ul className='chat-gallery-list'>
            {links.map((link) => (
              <li key={`${link.messageId}-${link.url}`}>
                <a href={link.url} target='_blank' rel='noreferrer'>
                  <FiExternalLink size={15} />
                  <span className='chat-gallery-list-text'>
                    <strong>{hostOf(link.url)}</strong>
                    <small>
                      {link.name} · {timeLabel(link.createdAt)}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )
      )}

      {mediaIndex !== null && (
        <Lightbox
          items={media}
          index={mediaIndex}
          onNavigate={setMediaIndex}
          onClose={() => setMediaIndex(null)}
        />
      )}
    </section>
  );
}
