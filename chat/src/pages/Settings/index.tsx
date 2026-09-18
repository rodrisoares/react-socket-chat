import './styles.scss';
import { lazy, Suspense, useId, useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FiBell, FiBellOff, FiChevronRight, FiEdit2, FiMoon, FiSlash, FiSun } from 'react-icons/fi';

import Avatar from 'components/Avatar';
import Input from 'components/Input';
import PasswordChecklist from 'components/PasswordChecklist';
import SessionList from 'components/SessionList';
import Switch from 'components/Switch';
import fetch from 'config/fetchInstance';
import useNotifications from 'hooks/notifications';
import useBlocks from 'hooks/blocks';
import useSession from 'hooks/session';
import useTheme from 'hooks/theme';
import { STATUS_TEXT_MAX_LENGTH, type User } from '@react-chat/shared';

// Carrega as 16 miniaturas só quando o diálogo abre.
const AvatarPicker = lazy(() => import('components/AvatarPicker'));

/** Quanto o servidor aceita em PATCH /api/me — vale espelhar aqui. */
const BIO_MAX = 200;

/**
 * As sete seções, cada uma um endereço.
 *
 * Eram sete numa rolagem só, sem nada que dissesse o que havia mais abaixo:
 * "Dispositivos" e "Bloqueados" ficavam a dois giros de roda do topo e não
 * apareciam em lugar nenhum antes disso. Em endereço próprio elas viram
 * destino — o link é compartilhável, o botão voltar volta uma seção, e o F5
 * cai onde estava.
 *
 * O `hint` substitui a linha única que a página tinha no cabeçalho: com uma
 * seção por vez, um resumo das sete não descreve o que está na tela.
 */
const SECTIONS = [
  { id: 'perfil', label: 'Perfil', hint: 'Como você aparece para quem conversa com você.' },
  { id: 'privacidade', label: 'Privacidade', hint: 'O que os seus contatos veem sobre você.' },
  { id: 'notificacoes', label: 'Notificações', hint: 'Avisos deste navegador, não da conta.' },
  { id: 'aparencia', label: 'Aparência', hint: 'O tema vale só neste aparelho.' },
  { id: 'seguranca', label: 'Segurança', hint: 'A senha da conta.' },
  { id: 'dispositivos', label: 'Dispositivos', hint: 'Onde a sua conta está aberta agora.' },
  { id: 'bloqueados', label: 'Bloqueados', hint: 'Quem não alcança você.' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const DEFAULT_SECTION: SectionId = 'perfil';

/**
 * Configurações.
 *
 * Era um modal chamado "Meu perfil" que foi acumulando perfil, privacidade,
 * segurança e dispositivos — quatro assuntos numa caixa que nasceu para um. Em
 * página eles cabem lado a lado, com endereço próprio e sem competir com a
 * conversa por espaço.
 *
 * Nem tudo aqui vai ao servidor: aparência e notificações são preferências
 * desta máquina e valem no clique; dispositivos e bloqueados são ações
 * imediatas. Só perfil, privacidade e segurança passam pelo Salvar — e é por
 * isso que a barra dele só aparece quando há o que salvar.
 */
export default function Settings() {
  // A seção vem do endereço. Quem não reconhece — `/settings` puro ou um link
  // velho — cai no Perfil pelo `Navigate` lá embaixo, depois dos hooks.
  const { section: raw } = useParams<{ section?: string }>();
  const current = SECTIONS.find((item) => item.id === raw);

  const { user, patchUser } = useSession();
  const { theme, toggle: toggleTheme } = useTheme();
  const { enabled: notificationsOn, setEnabled, permission, request } = useNotifications();

  const {
    name: currentName,
    email,
    image,
    bio: currentBio,
    statusText: currentStatusText,
    showLastSeen: currentShowLastSeen,
    showReadReceipts: currentShowReceipts,
  } = user ?? ({} as NonNullable<typeof user>);

  const bioId = useId();
  const statusTextId = useId();
  // '' representa "sem foto" tanto aqui quanto no PATCH — o servidor grava null.
  const currentImage = image ?? '';
  const [name, setName] = useState(currentName ?? '');
  const [bio, setBio] = useState(currentBio ?? '');
  const [statusText, setStatusText] = useState(currentStatusText ?? '');
  const [preview, setPreview] = useState(currentImage);
  // Undefined só antes do /me responder; o servidor manda true por padrão.
  const [showLastSeen, setShowLastSeen] = useState(currentShowLastSeen !== false);
  const [showReceipts, setShowReceipts] = useState(currentShowReceipts !== false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isPickingAvatar, setIsPickingAvatar] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Quem eu bloqueei, com nome e foto — o servidor devolve as pessoas.
   *
   * Do mesmo hook que o painel de detalhes usa. Eram duas cópias da lista, uma
   * em cada tela, e elas divergiam: bloquear alguém dentro da conversa não
   * aparecia aqui até um F5, e desbloquear aqui deixava o painel oferecendo
   * "Desbloquear" de novo.
   *
   * O desfazer no erro mora no hook, como mutação otimista — antes era um
   * `setBlocked` de ida e outro de volta, escritos à mão.
   */
  const { blocked, setBlocked } = useBlocks();

  async function unblock(person: User) {
    try {
      await setBlocked(person.id, false);
    } catch {
      setError('Não foi possível desbloquear.');
    }
  }

  /** Recolher descarta o que foi digitado: senão o Salvar levaria sobra. */
  function togglePassword() {
    setIsChangingPassword((open) => {
      if (open) {
        setCurrentPassword('');
        setNewPassword('');
      }
      return !open;
    });
  }

  function toggleNotifications() {
    // Permissão ainda não pedida: o clique é o pedido, e não um "desligar".
    if (permission === 'default') {
      void request();
      setEnabled(true);
      return;
    }
    setEnabled(!notificationsOn);
  }

  /** O que difere do que está salvo — e, portanto, o que o Salvar leva. */
  const changes: Record<string, string | boolean> = {};
  if (name && name !== currentName) changes['name'] = name;
  // Sem `preview &&`: string vazia é uma alteração válida (remover a foto).
  if (preview !== currentImage) changes['image'] = preview;
  // Comparado com '' para que apagar a bio conte como alteração.
  if (bio !== (currentBio ?? '')) changes['bio'] = bio;
  // Idem para o recado: string vazia é como ele se limpa.
  if (statusText !== (currentStatusText ?? '')) changes['statusText'] = statusText;
  if (showLastSeen !== (currentShowLastSeen !== false)) changes['showLastSeen'] = showLastSeen;
  if (showReceipts !== (currentShowReceipts !== false)) {
    changes['showReadReceipts'] = showReceipts;
  }
  if (newPassword) {
    changes['currentPassword'] = currentPassword;
    changes['newPassword'] = newPassword;
  }

  const hasChanges = Object.keys(changes).length > 0;

  function discard() {
    setName(currentName ?? '');
    setBio(currentBio ?? '');
    setStatusText(currentStatusText ?? '');
    setPreview(currentImage);
    setShowLastSeen(currentShowLastSeen !== false);
    setShowReceipts(currentShowReceipts !== false);
    setCurrentPassword('');
    setNewPassword('');
    setIsChangingPassword(false);
    setError('');
  }

  async function save() {
    setError('');
    setFeedback('');
    setIsSubmitting(true);

    try {
      const response = await fetch.patch<User>('/api/me', changes);
      patchUser(response.data);
      setCurrentPassword('');
      setNewPassword('');
      setIsChangingPassword(false);
      setFeedback('Configurações salvas.');
    } catch (err) {
      const data = (
        err as { response?: { data?: { error?: string; issues?: { mensagem: string }[] } } }
      ).response?.data;
      setError(data?.issues?.[0]?.mensagem ?? data?.error ?? 'Não foi possível salvar.');
    } finally {
      setIsSubmitting(false);
    }
  }

  /*
   * `/settings` e `/settings/qualquercoisa` viram `/settings/perfil`.
   *
   * Depois dos hooks de propósito: sair antes deles mudaria a quantidade de
   * hooks entre um render e outro. `replace` para o botão voltar não devolver
   * a pessoa ao endereço de onde ela acabou de ser tirada.
   */
  if (!current) return <Navigate to={`/settings/${DEFAULT_SECTION}`} replace />;

  const section: SectionId = current.id;

  return (
    <div className='settings'>
      <div className='settings-body'>
        {/*
          Links de verdade, e não botões com estado interno: é o que dá endereço
          a cada seção — o link é compartilhável, o voltar volta uma seção e o
          F5 cai onde estava. O `NavLink` cuida do "você está aqui" sozinho.
        */}
        <nav className='settings-nav' aria-label='Seções das configurações'>
          <span className='settings-nav-title'>Configurações</span>
          {SECTIONS.map((item) => (
            <NavLink
              key={item.id}
              to={`/settings/${item.id}`}
              className={({ isActive }) =>
                `settings-nav-item${isActive ? ' is-active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className='settings-scroll'>
          <header className='settings-head'>
            <h1>{current.label}</h1>
            <p>{current.hint}</p>
          </header>

          {section === 'perfil' && (
            <section className='profile-section'>
              <div className='profile-identity'>
                <div className='profile-identity-avatar'>
                  <Avatar image={preview || undefined} isLogged />
                  <button
                    type='button'
                    className='profile-identity-edit'
                    onClick={() => setIsPickingAvatar(true)}
                    aria-label={preview ? 'Trocar avatar' : 'Escolher avatar'}
                    title={preview ? 'Trocar avatar' : 'Escolher avatar'}
                  >
                    <FiEdit2 size={14} />
                  </button>
                </div>
                {/* Segue o campo enquanto você digita: é um preview, não um rótulo. */}
                <strong className='profile-identity-name'>{name || 'Sem nome'}</strong>
                <span className='profile-identity-email'>{email}</span>
              </div>

              <Input label='Nome' value={name} onChange={setName} />

              <div className='field'>
                <div className='profile-bio-label'>
                  <label className='field-label' htmlFor={bioId}>
                    Bio
                  </label>
                  <span className='field-hint'>
                    {bio.length}/{BIO_MAX}
                  </span>
                </div>
                <div className='field-box'>
                  <textarea
                    id={bioId}
                    className='field-input profile-bio-input'
                    rows={3}
                    maxLength={BIO_MAX}
                    placeholder='Conte algo sobre você'
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                  />
                </div>
              </div>

              {/*
                O recado fica com os campos digitados, ao lado da bio. A *escolha*
                do status continua só no menu do avatar: duplicá-la aqui seria duas
                portas para a mesma sala, que foi o motivo de aquele menu encolher.
              */}
              <div className='field'>
                <div className='profile-bio-label'>
                  <label className='field-label' htmlFor={statusTextId}>
                    Recado de status
                  </label>
                  <span className='field-hint'>
                    {statusText.length}/{STATUS_TEXT_MAX_LENGTH}
                  </span>
                </div>
                <div className='field-box'>
                  <input
                    id={statusTextId}
                    className='field-input'
                    maxLength={STATUS_TEXT_MAX_LENGTH}
                    placeholder='Em reunião até as 15h'
                    value={statusText}
                    onChange={(event) => setStatusText(event.target.value)}
                  />
                </div>
                <p className='profile-hint'>
                  Aparece ao lado do seu status para quem conversa com você. Escolher
                  entre Disponível, Ocupado, Ausente e Não perturbe continua no menu
                  do seu avatar.
                </p>
              </div>
            </section>
          )}

          {section === 'privacidade' && (
            <section className='profile-section'>
              {/* O interruptor vale para os dois lados no servidor: desligado, o
                  horário deixa de sair daqui — não é só a sua tela que muda. */}
              <Switch
                checked={showLastSeen}
                onChange={setShowLastSeen}
                label='Mostrar meu “visto por último”'
                hint={
                  showLastSeen
                    ? 'Seus contatos veem o horário em que você saiu.'
                    : 'Seus contatos só veem se você está online agora.'
                }
              />

              {/* Vale nos dois sentidos, como no WhatsApp: sem a reciprocidade o
                  ajuste seria uma forma de ver sem ser visto. */}
              <Switch
                checked={showReceipts}
                onChange={setShowReceipts}
                label='Enviar confirmação de leitura'
                hint={
                  showReceipts
                    ? 'O ✓✓ aparece para quem te escreve — e para você.'
                    : 'Ninguém vê quando você lê. Você também deixa de ver o ✓✓ dos outros.'
                }
              />
            </section>
          )}

          {section === 'notificacoes' && (
            <section className='profile-section'>
              {/* Vale no clique: é preferência deste navegador, não do servidor. */}
              <button
                type='button'
                className='settings-row'
                aria-pressed={notificationsOn}
                onClick={toggleNotifications}
              >
                <span className='settings-row-icon'>
                  {notificationsOn ? <FiBell size={18} /> : <FiBellOff size={18} />}
                </span>
                <span className='settings-row-text'>
                  <strong>Avisos de mensagem nova</strong>
                  <small>
                    {!notificationsOn
                      ? 'Desligados: sem som e sem avisos do navegador.'
                      : permission === 'granted'
                        ? 'Ligados: som e aviso do navegador quando a aba está atrás.'
                        : permission === 'default'
                          ? 'Falta a permissão do navegador. Clique para pedir.'
                          : 'O navegador bloqueou os avisos deste site; o som continua.'}
                  </small>
                </span>
              </button>
            </section>
          )}

          {section === 'aparencia' && (
            <section className='profile-section'>
              <button type='button' className='settings-row' onClick={toggleTheme}>
                <span className='settings-row-icon'>
                  {theme === 'dark' ? <FiMoon size={18} /> : <FiSun size={18} />}
                </span>
                <span className='settings-row-text'>
                  <strong>Tema {theme === 'dark' ? 'escuro' : 'claro'}</strong>
                  <small>Clique para usar o tema {theme === 'dark' ? 'claro' : 'escuro'}.</small>
                </span>
              </button>
            </section>
          )}

          {section === 'seguranca' && (
            <section className='profile-section'>
              <button
                type='button'
                className={`profile-disclosure${isChangingPassword ? ' is-open' : ''}`}
                aria-expanded={isChangingPassword}
                onClick={togglePassword}
              >
                <FiChevronRight size={16} className='profile-disclosure-icon' />
                Alterar senha
              </button>

              {isChangingPassword && (
                <div className='profile-password'>
                  <Input
                    label='Senha atual'
                    type='password'
                    value={currentPassword}
                    onChange={setCurrentPassword}
                  />
                  <div>
                    <Input
                      label='Nova senha'
                      type='password'
                      autoComplete='new-password'
                      value={newPassword}
                      onChange={setNewPassword}
                    />
                    {newPassword && <PasswordChecklist value={newPassword} />}
                  </div>
                  <p className='profile-hint'>
                    Ao trocar a senha, as sessões nos outros dispositivos são encerradas.
                  </p>
                </div>
              )}
            </section>
          )}

          {section === 'dispositivos' && (
            <SessionList />
          )}

          {section === 'bloqueados' && (
            <section className='profile-section'>
              {blocked.length === 0 ? (
                <p className='profile-hint'>
                  Ninguém bloqueado. Bloquear fica nos detalhes do contato, dentro da
                  conversa.
                </p>
              ) : (
                <ul className='settings-blocked'>
                  {blocked.map((contact) => (
                    <li key={contact.id}>
                      <Avatar image={contact.image} isLogged={false} />
                      <span className='settings-blocked-name'>{contact.name}</span>
                      <button
                        type='button'
                        className='settings-blocked-undo'
                        onClick={() => void unblock(contact)}
                      >
                        <FiSlash size={14} /> Desbloquear
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {feedback && (
            <p className='profile-message profile-message--ok' role='status'>
              {feedback}
            </p>
          )}
        </div>
      </div>

      {/*
        Fora do `settings-body`, e por isso fora das seções: a alteração
        pendente é da página, e não da aba onde ela foi feita. Alguém que muda o
        nome e vai até Aparência continua vendo que tem algo por salvar — e o
        Descartar continua alcançando aquilo.

        Só aparece havendo o que salvar, porque quatro das sete seções nem
        passam por ele: aparência e notificações valem no clique, dispositivos e
        bloqueados são ações imediatas.
      */}
      {(hasChanges || error) && (
        <div className='settings-save' role='region' aria-label='Alterações não salvas'>
          {error ? (
            <p className='profile-message profile-message--error' role='alert'>
              {error}
            </p>
          ) : (
            <span className='settings-save-hint'>Você tem alterações não salvas.</span>
          )}

          <div className='settings-save-actions'>
            <button
              type='button'
              className='profile-actions-cancel'
              onClick={discard}
              disabled={isSubmitting}
            >
              Descartar
            </button>
            <button
              type='button'
              className='profile-actions-save'
              onClick={() => void save()}
              disabled={isSubmitting || !hasChanges}
            >
              {isSubmitting ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {isPickingAvatar && (
        <Suspense fallback={null}>
          <AvatarPicker
            current={preview}
            onSelect={setPreview}
            onClose={() => setIsPickingAvatar(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
