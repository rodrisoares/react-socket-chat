-- Renomeia password -> passwordHash.
-- O conteudo passa a ser hash bcrypt; rode o seed para regravar os usuarios.
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";
