-- Status escolhido pelo usuario. Ortogonal ao isOnline, que continua vindo do
-- socket: offline ignora o status e pinta cinza.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'AVAILABLE';
