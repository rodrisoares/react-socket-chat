import './styles.scss';

/** Fallback dos chunks carregados sob demanda. */
export default function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className='loading' role='status' aria-live='polite'>
      <span className='loading-spinner' aria-hidden='true' />
      <span>{label}</span>
    </div>
  );
}
