import './styles.scss';
import { lazy, Suspense, useId, useState } from 'react';
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

  return (
    <div className='settings'>
      <div className='settings-scroll'>
        <header className='settings-head'>
          <h1>Configurações</h1>
          <p>Seu perfil, sua privacidade e como este aparelho se comporta.</p>
        </header>

        <section className='profile-section'>
          <h2 className='profile-section-title'>Perfil</h2>

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

        <section className='profile-section'>
          <h2 className='profile-section-title'>Privacidade</h2>

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

        <section className='profile-section'>
          <h2 className='profile-section-title'>Notificações</h2>

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

        <section className='profile-section'>
          <h2 className='profile-section-title'>Aparência</h2>

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

        <section className='profile-section'>
          <h2 className='profile-section-title'>Segurança</h2>

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

        <SessionList />

        <section className='profile-section'>
          <h2 className='profile-section-title'>Bloqueados</h2>

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

        {feedback && (
          <p className='profile-message profile-message--ok' role='status'>
            {feedback}
          </p>
        )}
      </div>

      {/*
        Barra fixa, e só quando há o que salvar. Numa página com sete seções um
        botão solto no fim não diz a que se refere — e três das seções nem
        passam por ele.
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
