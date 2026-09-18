import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import './styles.scss';
import logo from 'assets/logo.png';
import { MdOutlineChat } from 'react-icons/md';
import { FiSettings, FiStar } from 'react-icons/fi';
import UserMenu from 'components/UserMenu';
import ConfirmDialog from 'components/ConfirmDialog';
import { ChatListSkeleton } from 'components/Skeleton';
import ConnectionBanner from 'components/ConnectionBanner';
import Toasts from 'components/Toasts';
import fetch from 'config/fetchInstance';
import useSession from 'hooks/session';
import useChatList from 'hooks/chatList';
import useSocketEvents from 'hooks/socketEvents';
import useAutoAway from 'hooks/idle';
import type { User, UserStatus } from '@react-chat/shared';
import useTheme from 'hooks/theme';
import useTitleBadge from 'hooks/titleBadge';
import { unreadTotal } from 'utils/unread';
import { useEffect, useMemo, useState } from 'react';

export default function Layout() {
  const { user, isLogged, isRestoring, signOut, patchUser } = useSession();
  const { chats } = useChatList();
  const { name, email, image, status } = user ?? {};
  const [isLeaving, setIsLeaving] = useState(false);
  const navigate = useNavigate();

  /**
   * Chamado pelo efeito, e não pelo retorno: quem aplica o tema no
   * `documentElement` é o próprio hook. A escolha vive em Configurações, mas
   * precisa valer em toda a casca — sem esta chamada, o tema salvo só voltaria
   * ao abrir aquela página.
   */
  useTheme();

  // A ponte entre o socket e o cache mora aqui: é a casca que só existe com
  // alguém logado, que é justamente quando há socket.
  useSocketEvents();

  /**
   * Ausência automática por inatividade — aqui pelo mesmo motivo que a ponte
   * acima: uma vez só, na casca. Montado por componente, cada tela teria o seu
   * detector, e eles disputariam o mesmo estado no servidor.
   */
  useAutoAway(isLogged);

  // No mobile a lista de conversas e uma gaveta fechada: sem isto, nada na
  // tela avisa que chegou mensagem.
  //
  // A conta é a mesma do cabeçalho da lista — eram duas contas diferentes, e os
  // dois números apareciam juntos na tela discordando um do outro.
  const unread = useMemo(() => unreadTotal(chats), [chats]);

  // O mesmo número no título da aba: é o único aviso que funciona com a
  // notificação do sistema negada e com o som desligado.
  useTitleBadge(unread);

  function changeStatus(next: UserStatus) {
    const previous = status;

    // Otimista: o ponto do avatar responde na hora, e o socket avisa os outros.
    patchUser({ status: next });

    void fetch.patch<User>('/api/me', { status: next }).catch(() => {
      // Recusado pelo servidor: sem desfazer, o avatar anunciaria para o dono
      // um status que ninguém mais vê.
      if (previous) patchUser({ status: previous });
    });
  }

  // Sessão restaurada e não há ninguém: a tela de login é o lugar.
  useEffect(() => {
    if (!isRestoring && !isLogged) void navigate('/login');
  }, [isRestoring, isLogged, navigate]);

  if (isRestoring) {
    // O esqueleto no formato da tela real: a lista à esquerda e a área da
    // conversa à direita, para nada saltar quando a sessão volta.
    return (
      <main className='container'>
        <nav className='navbar' />
        <div className='content'>
          <div className='container-restoring'>
            <div className='container-restoring-list'>
              <ChatListSkeleton />
            </div>
            <div className='container-restoring-display' />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className='container'>
      {/*
        O primeiro alvo do Tab, e invisível até receber foco.

        Sem ele, quem navega por teclado atravessa os três destinos do rail e o
        menu do avatar antes de alcançar a lista de conversas — em toda carga de
        página, e de novo a cada volta para cá. A ordem daqui para a frente é a
        da própria marcação: rail, depois lista, depois conversa.
      */}
      <a className='skip-link' href='#conteudo'>
        Pular para o conteúdo
      </a>

      <nav className='navbar' aria-label='Seções do aplicativo'>
        <div className='navbar-top'>
          {/* Marca, nao botao: navegava para "/", a mesma rota do item Chat. */}
          <span className='navbar-logo'>
            <img src={logo} alt='React Chat' />
          </span>

          {/*
            Os destinos de conversa, e não um item só que não levava a lugar
            nenhum. O `NavLink` cuida do "você está aqui" sozinho — o
            `is-active` do rail já existia no CSS, escrito para um item que
            nunca mudava de estado.

            Ajustes saiu daqui e desceu para o pé do rail: Chat e Salvas são
            onde se conversa, e Configurações é sobre a conta — o mesmo canto
            em que o avatar já estava.

            Arquivadas fica de fora de propósito: ela já tem uma linha própria
            acima da lista, e trazê-la para cá criaria duas portas para a mesma
            sala — o mesmo motivo que tirou o "Filtrar não lidas" do Home.
          */}
          <div className='navbar-nav'>
            <NavLink
              to='/'
              end
              className={({ isActive }) => `navbar-item${isActive ? ' is-active' : ''}`}
            >
              <span className='navbar-item-icon'>
                <MdOutlineChat size={20} />
                {unread > 0 && (
                  <span
                    className='navbar-item-badge'
                    aria-label={`${unread} não ${unread === 1 ? 'lida' : 'lidas'}`}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </span>
              <span>Chat</span>
            </NavLink>

            <NavLink
              to='/saved'
              className={({ isActive }) => `navbar-item${isActive ? ' is-active' : ''}`}
            >
              <span className='navbar-item-icon'>
                <FiStar size={20} />
              </span>
              <span>Salvas</span>
            </NavLink>
          </div>
        </div>

        {/*
          O pé do rail, onde mora o que é do dono da tela.

          Ajustes é um `navbar-item` igual aos de cima — mesma pílula, mesmo
          "você está aqui" — só que ancorado embaixo pelo `space-between` do
          rail. Ele continua sendo um destino, e não um item de menu: a página
          tem sete seções com endereço próprio, e esconder isso atrás de um
          popover seria devolvê-la ao modal de onde ela saiu.

          O menu do avatar encolheu: perfil, salvas, tema e notificações viraram
          destinos ou seções de Configurações. Sobra o que é do próprio avatar —
          o status — e o sair.
        */}
        <div className='navbar-bottom'>
          <NavLink
            to='/settings'
            className={({ isActive }) => `navbar-item${isActive ? ' is-active' : ''}`}
          >
            <span className='navbar-item-icon'>
              <FiSettings size={20} />
            </span>
            <span>Ajustes</span>
          </NavLink>

          <UserMenu
            {...(name !== undefined ? { name } : {})}
            {...(email !== undefined ? { email } : {})}
            image={image}
            status={status ?? 'AVAILABLE'}
            onChangeStatus={changeStatus}
            onLogout={() => setIsLeaving(true)}
          />
        </div>
      </nav>
      {/* `tabIndex={-1}` para o salto poder pousar aqui: sem ele o foco fica
          no `<a>` e a tecla seguinte volta para o começo do rail. */}
      <div className='content' id='conteudo' tabIndex={-1}>
        {/* O estado da conexão saiu do rail e virou faixa aqui: é o aviso mais
            importante da tela, e estava no lugar mais estreito dela. */}
        <ConnectionBanner />
        <Outlet />
      </div>

      {/* Os avisos passageiros, num canto só e anunciados por leitor de tela.
          Montado na casca porque quem falha pode ser qualquer tela. */}
      <Toasts />

      {isLeaving && (
        <ConfirmDialog
          title='Sair da conta'
          message='Você precisará entrar de novo para voltar às suas conversas.'
          confirmLabel='Sair'
          onConfirm={signOut}
          onCancel={() => setIsLeaving(false)}
        />
      )}
    </main>
  );
}
