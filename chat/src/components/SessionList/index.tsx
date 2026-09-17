import './styles.scss';
import { useEffect, useState } from 'react';
import { FiLogOut, FiMonitor, FiSmartphone } from 'react-icons/fi';

import fetch from 'config/fetchInstance';
import { getSessionId } from 'config/auth';
import { lastSeenLabel } from 'utils/lastSeen';
import type { Session } from '@react-chat/shared';

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
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const currentId = getSessionId();

  useEffect(() => {
    let cancelled = false;

    fetch
      .get<Session[]>('/api/me/sessions')
      .then((response) => {
        if (!cancelled) setSessions(response.data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os dispositivos.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function close(id: string) {
    setError('');
    setBusy(id);

    try {
      await fetch.delete(`/api/me/sessions/${id}`);
      setSessions((old) => old?.filter((session) => session.id !== id) ?? null);
    } catch {
      setError('Não foi possível encerrar a sessão.');
    } finally {
      setBusy('');
    }
  }

  async function closeOthers() {
    if (!currentId) return;
    setError('');
    setBusy('others');

    try {
      await fetch.delete(`/api/me/sessions?keep=${encodeURIComponent(currentId)}`);
      setSessions((old) => old?.filter((session) => session.id === currentId) ?? null);
    } catch {
      setError('Não foi possível encerrar as outras sessões.');
    } finally {
      setBusy('');
    }
  }

  const others = sessions?.filter((session) => session.id !== currentId) ?? [];

  return (
    <section className='profile-section'>
      <h3 className='profile-section-title'>Dispositivos conectados</h3>

      {error && <p className='session-list-error'>{error}</p>}
      {!sessions && !error && <p className='session-list-empty'>Carregando…</p>}

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
                    disabled={busy === session.id}
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
          disabled={busy === 'others'}
        >
          {busy === 'others'
            ? 'Encerrando…'
            : `Encerrar as outras ${others.length === 1 ? 'sessão' : `${others.length} sessões`}`}
        </button>
      )}
    </section>
  );
}
