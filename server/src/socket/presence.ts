/**
 * Uma pessoa pode estar conectada em mais de um lugar: duas abas, o celular e
 * o desktop. A presenca e do usuario, e nao do socket.
 *
 * Funcao pura de proposito — quem consulta as conexoes vivas e o index.ts, que
 * so depende do socket.io; a regra em si fica testavel sem subir servidor.
 */
export function keepsPresence(connectedIds: string[], leavingId: string): boolean {
  return connectedIds.some((id) => id !== leavingId);
}
