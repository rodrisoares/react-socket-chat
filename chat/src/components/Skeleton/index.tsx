import './styles.scss';

/**
 * Blocos cinza no lugar do "Carregando…".
 *
 * A troca não é cosmética: o texto não reserva espaço nenhum, então a tela
 * saltava quando o conteúdo real chegava. O esqueleto ocupa desde já o mesmo
 * lugar que as conversas e os balões vão ocupar.
 */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden='true' />;
}

/** Um card da lista de conversas: avatar, nome e prévia. */
export function ChatCardSkeleton() {
  return (
    <div className='skeleton-card'>
      <Skeleton className='skeleton-avatar' />
      <div className='skeleton-card-text'>
        <Skeleton className='skeleton-line skeleton-line--title' />
        <Skeleton className='skeleton-line skeleton-line--preview' />
      </div>
    </div>
  );
}

export function ChatListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className='skeleton-list' role='status' aria-label='Carregando conversas'>
      {Array.from({ length: count }, (_, index) => (
        <ChatCardSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * Balões alternados entre os dois lados, com larguras diferentes: um bloco só,
 * sempre do mesmo tamanho, parece um erro de layout, não um carregamento.
 */
export function MessagesSkeleton({ count = 6 }: { count?: number }) {
  const widths = ['62%', '44%', '73%', '38%', '56%', '48%'];

  return (
    <div className='skeleton-messages' role='status' aria-label='Carregando mensagens'>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className='skeleton-messages-row'
          style={{ width: widths[index % widths.length] }}
        >
          <Skeleton
            className={`skeleton-bubble skeleton-bubble--${
              index % 2 === 0 ? 'foreign' : 'owner'
            }`}
          />
        </div>
      ))}
    </div>
  );
}
