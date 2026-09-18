import './styles.scss';
import { useState } from 'react';
import { FiLogOut, FiMonitor, FiSmartphone } from 'react-icons/fi';

import useDevices from 'hooks/devices';
import { lastSeenLabel } from 'utils/lastSeen';

/**
 * O User-Agent inteiro não cabe e não diz nada: o que a pessoa reconhece é
 * "Chrome no Windows". Sem regex de detecção de browser — só os nomes comuns,
 * e "Dispositivo desconhecido" quando nada casa.
 */
function describe(userAgent: string | null): { label: string; isMobile: boolean } {
  const agent = userAgent ?? '';
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(agent);

  const browser =
    /Edg\//.test(agent) ? 'Edge'
    : /OPR\/|Opera/.test(agent) ? 'Opera'
    : /Firefox\//.test(agent) ? 'Firefox'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : '';

  const system =
    /Windows/.test(agent) ? 'Windows'
    : /Android/.test(agent) ? 'Android'
    : /iPhone|iPad|iOS/.test(agent) ? 'iOS'
    : /Mac OS X|Macintosh/.test(agent) ? 'macOS'
    : /Linux/.test(agent) ? 'Linux'
    : '';

  if (!browser && !system) return { label: 'Dispositivo desconhecido', isMobile };
  return { label: [browser, system].filter(Boolean).join(' · '), isMobile };
}

/** Dispositivos com sessão aberta — e o botão para encerrar cada um. */
export default function SessionList() {
  const {
    sessions,
    currentId,
    isFailed,
    closing,
    closeDevice,
    closeOtherDevices,
  } = useDevices();
  const [error, setError] = useState('');

  async function close(id: string) {
    setError('');

    try {
      await closeDevice(id);
    } catch {
      setError('Não foi possível encerrar a sessão.');
    }
  }

  async function closeOthers() {
    if (!currentId) return;
    setError('');

    try {
      await closeOtherDevices();
    } catch {
      setError('Não foi possível encerrar as outras sessões.');
    }
  }

  const others = sessions?.filter((session) => session.id !== currentId) ?? [];

  return (
    <section className='profile-section'>
      <h3 className='profile-section-title'>Dispositivos conectados</h3>

      {error && <p className='session-list-error'>{error}</p>}
      {isFailed && (
        <p className='session-list-error'>Não foi possível carregar os dispositivos.</p>
      )}
      {!sessions && !isFailed && <p className='session-list-empty'>Carregando…</p>}

      {sessions && (
        <ul className='session-list'>
          {sessions.map((session) => {
            const { label, isMobile } = describe(session.userAgent);
            const isCurrent = session.id === currentId;

            return (
              <li key={session.id} className='session-list-item'>
                <span className='session-list-icon'>
                  {isMobile ? <FiSmartphone size={16} /> : <FiMonitor size={16} />}
                </span>

                <span className='session-list-text'>
                  <strong>
                    {label}
                    {isCurrent && (
                      <em className='session-list-current'>este dispositivo</em>
                    )}
                  </strong>
                  <small>
                    {/* O mesmo rótulo do "visto por último": a última vez que
                        esta sessão renovou o acesso. */}
                    {lastSeenLabel(session.lastUsedAt).replace('visto por último ', 'ativo ')}
                  </small>
                </span>

                {/* A sessão atual não se encerra por aqui: para isso existe o
                    "Sair da conta", que também desliga o socket. */}
                {!isCurrent && (
                  <button
                    type='button'
                    className='session-list-close'
                    onClick={() => void close(session.id)}
                    disabled={closing === session.id}
                    aria-label={`Encerrar sessão em ${label}`}
                    title='Encerrar esta sessão'
                  >
                    <FiLogOut size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {others.length > 0 && (
        <button
          type='button'
          className='session-list-all'
          onClick={() => void closeOthers()}
          disabled={closing === 'others'}
        >
          {closing === 'others'
            ? 'Encerrando…'
            : `Encerrar as outras ${others.length === 1 ? 'sessão' : `${others.length} sessões`}`}
        </button>
      )}
    </section>
  );
}
