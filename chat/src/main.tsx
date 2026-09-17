import './config/_variables.scss';
import 'normalize.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import Router from './router';
import { queryClient } from './config/queryClient';

/**
 * Um provider só: o estado que vem do servidor mora no cache do Query, e o que
 * é da tela mora no store (ver `store/ui`). Eram dois providers, um deles com
 * 730 linhas de estado e efeitos de socket.
 */
const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado no index.html');

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <Router />
  </QueryClientProvider>,
);
