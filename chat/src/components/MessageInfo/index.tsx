import './styles.scss';
import { useEffect, useState } from 'react';

import Avatar from 'components/Avatar';
import Modal from 'components/Modal';
import fetch from 'config/fetchInstance';
import { fullDateLabel, timeLabel } from 'utils/dayLabel';
import type { Message, MessageInfo as Info } from '@react-chat/shared';

interface MessageInfoProps {
  chatId: string;
  message: Message;
  onClose: () => void;
}

/**
 * "Dados da mensagem": quem já leu, e quando.
 *
 * O ✓✓ do balão responde sim ou não; aqui está a resposta por extenso, que em
 * grupo é a única que diz algo — com dez pessoas, "lida" só contava se todas
 * tinham aberto, e não dizia quem faltava.
 *
 * Só o autor pergunta, e o servidor confere isso de novo: o botão que abre este
 * painel já só aparece nas mensagens da própria pessoa.
 */
export default function MessageInfo({ chatId, message, onClose }: MessageInfoProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void fetch
      .get<Info>(`/api/chats/${chatId}/messages/${message.id}/info`)
      .then((response) => {
        if (!cancelled) setInfo(response.data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os dados da mensagem.');
      });

    return () => {
      cancelled = true;
    };
  }, [chatId, message.id]);

  /**
   * As duas listas vazias com a busca concluída significam recibo desligado —
   * o seu, o dos outros, ou ambos. O servidor não distingue os casos de
   * propósito: dizer qual deles é entregaria o que o recibo desligado esconde.
   */
  const isSilent =
    info !== null && info.readBy.length === 0 && info.pending.length === 0;

  return (
    <Modal title='Dados da mensagem' onClose={onClose}>
      {/* A mensagem em si, para o painel dizer de qual se trata: aberto pelo
          menu, ele chegava sem nenhum contexto do que foi clicado. */}
      <p className='message-info-quote'>
        {message.text || <em>mensagem sem texto</em>}
      </p>
      <p className='message-info-sent' title={fullDateLabel(message.createdAt)}>
        Enviada às {timeLabel(message.createdAt)}
      </p>

      {error && <p className='message-info-error'>{error}</p>}

      {!error && info === null && <p className='message-info-empty'>Carregando…</p>}

      {isSilent && (
        <p className='message-info-empty'>
          A confirmação de leitura está desligada nesta conversa, então não há o
          que mostrar aqui.
        </p>
      )}

      {info !== null && !isSilent && (
        <>
          <section className='message-info-section'>
            <h4>Lida por {info.readBy.length}</h4>
            {info.readBy.length === 0 ? (
              <p className='message-info-empty'>Ninguém abriu ainda.</p>
            ) : (
              <ul className='message-info-list'>
                {info.readBy.map((who) => (
                  <li key={who.id}>
                    <Avatar image={who.image} isLogged={false} />
                    <span className='message-info-name'>{who.name}</span>
                    <span className='message-info-time' title={fullDateLabel(who.readAt)}>
                      {timeLabel(who.readAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {info.pending.length > 0 && (
            <section className='message-info-section'>
              <h4>Ainda não leram {info.pending.length}</h4>
              <ul className='message-info-list'>
                {info.pending.map((who) => (
                  <li key={who.id}>
                    <Avatar
                      image={who.image}
                      isLogged={who.isOnline}
                      status={who.status}
                    />
                    <span className='message-info-name'>{who.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
