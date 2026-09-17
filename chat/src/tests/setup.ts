import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// jsdom não implementa matchMedia, que o useTheme consulta.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom não implementa ResizeObserver, de que o virtualizador da lista de
// mensagens depende para remedir os balões.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});

// jsdom não implementa IntersectionObserver, e dois caminhos dependem dele: o
// sentinela do topo da lista, que pede o histórico ao entrar na tela, e o
// seletor de emojis, que observa as categorias ao abrir. Sem o stub eles viram
// rejeição não tratada — testes passando e a suíte saindo com erro.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverStub,
});

// jsdom também não implementa a API de rolagem: o virtualizador chama scrollTo
// ao reancorar, e o seletor de reação chama scrollIntoView ao abrir.
Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
});
