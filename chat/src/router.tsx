import './index.scss';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import Layout from 'components/Layout';
import Loading from 'components/Loading';
import { registerNavigator } from 'utils/chatRoute';

/**
 * Empresta o `navigate` para quem não é componente.
 *
 * Quem precisa dele é o módulo de eventos do socket, no clique da notificação:
 * ele roda dentro de um callback, onde não há como chamar um hook.
 *
 * Montado uma vez só, aqui, e não dentro do `useOpenChat` — aquele hook é usado
 * por dois componentes ao mesmo tempo, e os dois registros disputariam a mesma
 * variável: o cleanup de um zeraria o navegador com o outro ainda vivo, e a
 * notificação deixaria de abrir conversa dependendo de quem desmontasse antes.
 */
function NavigatorBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    registerNavigator(navigate);
    return () => registerNavigator(null);
  }, [navigate]);

  return null;
}

// Cada rota vira um chunk próprio: quem abre o login não baixa o chat inteiro.
const Login = lazy(() => import('pages/Login'));
const Signup = lazy(() => import('pages/Signup'));
const Home = lazy(() => import('pages/Home'));
const Saved = lazy(() => import('pages/Saved'));
const Settings = lazy(() => import('pages/Settings'));

/**
 * As duas bandeiras do v7 ficam ligadas desde já: sem elas o React Router v6
 * avisa no console a cada carga, e o aviso vira ruído no meio de erro de
 * verdade.
 *
 * `v7_startTransition` envolve a navegação numa transição do React — com as
 * rotas em `lazy`, trocar de tela passa a segurar a anterior em vez de piscar o
 * fallback. `v7_relativeSplatPath` muda a resolução de caminho relativo dentro
 * de rota splat; o único splat daqui navega para um caminho absoluto, então
 * nada muda de comportamento.
 */
const Router = () => (
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <NavigatorBridge />
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path='/signup' element={<Signup />} />
        <Route path='/login' element={<Login />} />
        {/*
          Salvas e Configurações são filhas do Layout, e não rotas soltas: é o
          que mantém o rail e a lista de conversas no lugar enquanto se navega
          entre elas.
        */}
        <Route path='/' element={<Layout />}>
          <Route index element={<Home />} />
          {/*
            A conversa aberta virou endereço. É o que faz o F5 manter a conversa
            no lugar, o link da notificação levar até ela, e o botão voltar do
            Android voltar para a lista em vez de sair do app — antes não havia
            o que voltar, porque abrir uma conversa não mudava a URL.
          */}
          <Route path='c/:chatId' element={<Home />} />
          <Route path='saved' element={<Saved />} />
          <Route path='settings' element={<Settings />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
    </Suspense>
  </BrowserRouter>
);

export default Router;
