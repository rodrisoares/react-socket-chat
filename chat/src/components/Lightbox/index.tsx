import './styles.scss';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IoClose, IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { FiDownload } from 'react-icons/fi';

import useEscape from 'hooks/escape';
import { attachmentUrl, downloadUrl } from 'config/env';
import { timeLabel } from 'utils/dayLabel';
import type { Message } from '@react-chat/shared';

interface LightboxProps {
  /** Mídia da conversa, em ordem: é por ela que as setas navegam. */
  items: Message[];
  /** Índice aberto. Fora do intervalo, o visor não desenha nada. */
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * Visor de mídia em tela cheia.
 *
 * Sai num portal para o body porque a lista de mensagens é virtualizada e
 * recorta o que passa da linha — e porque o painel de detalhes, que também o
 * abre, vive dentro de um `overflow: hidden`.
 */
export default function Lightbox({ items, index, onNavigate, onClose }: LightboxProps) {
  const current = items[index];
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  const go = useCallback(
    (step: number) => {
      const next = index + step;
      if (next >= 0 && next < items.length) onNavigate(next);
    },
    [index, items.length, onNavigate],
  );

  // O visor fica no topo da pilha do Esc: fecha ele, e não o painel de trás.
  useEscape(onClose);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    }

    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [go]);

  if (!current?.attachment) return null;

  const { url, name, type } = current.attachment;
  const source = attachmentUrl(url);

  return createPortal(
    <div className='lightbox' role='dialog' aria-modal='true' aria-label={name}>
      {/* Clicar no fundo fecha; o conteúdo no meio para o clique. */}
      <div className='lightbox-backdrop' role='presentation' onClick={onClose} />

      <header className='lightbox-bar'>
        <div className='lightbox-bar-title'>
          <strong>{current.name}</strong>
          <span>{name}</span>
        </div>
        <div className='lightbox-bar-actions'>
          {/*
            O endereço pede o download ao servidor — o atributo `download`
            sozinho é ignorado em origem cruzada, e o clique só abria a foto
            numa aba nova. Ele fica assim mesmo, como nome sugerido do arquivo
            para quando as duas origens coincidirem.
          */}
          <a
            href={downloadUrl(url)}
            download={name}
            rel='noreferrer'
            aria-label='Baixar arquivo'
            title='Baixar'
          >
            <FiDownload size={18} />
          </a>
          <button
            type='button'
            onClick={onClose}
            aria-label='Fechar visualização'
            title='Fechar (Esc)'
          >
            <IoClose size={22} />
          </button>
        </div>
      </header>

      <div className='lightbox-stage'>
        {hasPrevious && (
          <button
            type='button'
            className='lightbox-nav lightbox-nav--previous'
            onClick={() => go(-1)}
            aria-label='Anterior'
            title='Anterior (←)'
          >
            <IoChevronBack size={26} />
          </button>
        )}

        {type.startsWith('video/') ? (
          // `key`: sem ele o browser reaproveita o mesmo <video> ao navegar e
          // continua tocando o anterior com a fonte trocada.
          <video key={current.id} src={source} controls autoPlay className='lightbox-media' />
        ) : (
          <img src={source} alt={name} className='lightbox-media' />
        )}

        {hasNext && (
          <button
            type='button'
            className='lightbox-nav lightbox-nav--next'
            onClick={() => go(1)}
            aria-label='Próxima'
            title='Próxima (→)'
          >
            <IoChevronForward size={26} />
          </button>
        )}
      </div>

      <footer className='lightbox-footer'>
        {timeLabel(current.createdAt)}
        {items.length > 1 && ` · ${index + 1} de ${items.length}`}
      </footer>
    </div>,
    document.body,
  );
}
