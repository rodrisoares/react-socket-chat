import './styles.scss';
import logo from 'assets/logo.png';

interface ShowcaseMessage {
  from: string;
  text: string;
  time: string;
  side: 'them' | 'me';
  /** Só na última mensagem própria, para mostrar o recibo de leitura. */
  read?: boolean;
}

interface Scene {
  messages: ShowcaseMessage[];
  /** Quem aparece digitando ao final da cena. */
  typing: string;
  caption: string;
}

/**
 * A conversa é o hero: em vez de ilustração genérica, a tela de entrada mostra
 * o próprio produto — mesmos balões, mesmo recibo, mesmo "digitando…" do chat.
 */
const scenes: Record<'login' | 'signup', Scene> = {
  login: {
    caption: 'Suas conversas continuam de onde pararam.',
    messages: [
      { from: 'Marcia', text: 'Conseguiu subir o servidor?', time: '09:12', side: 'them' },
      { from: 'Você', text: 'Subiu, está tudo online', time: '09:13', side: 'me', read: true },
    ],
    typing: 'Marcia',
  },
  signup: {
    caption: 'Crie sua conta e entre na conversa.',
    messages: [
      { from: 'Luiz', text: 'Chamei o time todo pro grupo', time: '14:02', side: 'them' },
      { from: 'Marcia', text: 'Boa. Só falta mais uma pessoa', time: '14:03', side: 'them' },
    ],
    typing: 'Luiz',
  },
};

export default function AuthShowcase({ variant }: { variant: 'login' | 'signup' }) {
  const scene = scenes[variant];

  return (
    <aside className='auth-showcase' aria-hidden='true'>
      <div className='auth-showcase-brand'>
        <img src={logo} alt='' />
        <span>React Chat</span>
      </div>

      <div className='auth-showcase-thread'>
        {scene.messages.map((message, index) => (
          <div
            key={message.text}
            className={`auth-bubble auth-bubble--${message.side}`}
            style={{ animationDelay: `${120 + index * 220}ms` }}
          >
            <span className='auth-bubble-who'>{message.from}</span>
            <p>{message.text}</p>
            <span className='auth-bubble-meta'>
              {message.time}
              {message.read && <span className='auth-bubble-read'>✓✓</span>}
            </span>
          </div>
        ))}

        <div
          className='auth-typing'
          style={{ animationDelay: `${120 + scene.messages.length * 220}ms` }}
        >
          <span className='auth-typing-dots'>
            <i />
            <i />
            <i />
          </span>
          {scene.typing} está digitando…
        </div>
      </div>

      <p className='auth-showcase-caption'>{scene.caption}</p>
    </aside>
  );
}
