import './styles.scss';
import { FiWifiOff, FiRefreshCw } from 'react-icons/fi';

import useConnection, { CONNECTION_LABEL } from 'hooks/connection';

/**
 * Faixa de estado da conexão, no topo da área de conversa.
 *
 * Antes isto era uma linha de texto de 9,5px dentro do rail, que tem 72px de
 * largura — o aviso mais importante da tela no lugar mais apertado dela. Como
 * faixa, ele cobre a largura toda e some assim que a conexão volta, que é o
 * que Slack e WhatsApp fazem.
 */
export default function ConnectionBanner() {
  const connection = useConnection();
  const isDown = connection === 'reconnecting' || connection === 'offline';

  return (
    <>
      {isDown && (
        <p className={`connection-banner connection-banner--${connection}`}>
          {connection === 'offline' ? (
            <FiWifiOff size={14} />
          ) : (
            <FiRefreshCw size={14} className='connection-banner-spinner' />
          )}
          {CONNECTION_LABEL[connection]}
          {connection === 'offline' && (
            <span className='connection-banner-hint'>
              As mensagens novas voltam a chegar quando a conexão voltar.
            </span>
          )}
        </p>
      )}

      {/* Montado desde sempre, e fora do bloco acima: um `aria-live` que só
          nasce junto com o aviso não é anunciado pelo leitor de tela. */}
      <span className='connection-banner-sr' role='status' aria-live='polite'>
        {CONNECTION_LABEL[connection]}
      </span>
    </>
  );
}
