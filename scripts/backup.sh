#!/bin/bash
# Backup do banco para dados/backups/ (fora do git).
#
# Uso:
#   scripts/backup.sh              # faz o dump
#   scripts/backup.sh --testar     # faz o dump e restaura num banco temporário para conferir
#
# Banco: variável DATABASE_URL (padrão: Supabase local).
# Para o banco de produção, exporte DATABASE_URL com a string de conexão do painel do Supabase.
set -euo pipefail

export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
cd "$(dirname "$0")/.."
mkdir -p dados/backups
ARQ="dados/backups/hub-$(date +%Y%m%d-%H%M%S).dump"

# Só o schema public: é onde estão os dados do hub. Auth e o resto são do Supabase.
pg_dump "$DB" --schema=public --format=custom --no-owner --no-privileges --file="$ARQ"
echo "Backup salvo em $ARQ ($(du -h "$ARQ" | cut -f1))"

if [[ "${1:-}" == "--testar" ]]; then
  TESTE="${DB%/*}/hub_teste_restauracao"
  psql "$DB" -qc "drop database if exists hub_teste_restauracao" -c "create database hub_teste_restauracao"
  # O dump referencia objetos que só existem no Supabase (extensão unaccent em
  # 'extensions', auth.users, papel authenticated); cria o mínimo no banco de teste.
  psql "$TESTE" -q <<'SQL'
drop schema public cascade;  -- o dump recria
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
SQL
  pg_restore --dbname="$TESTE" --no-owner --no-privileges --single-transaction "$ARQ"
  for T in lancamento transferencia item categoria; do
    A=$(psql "$DB" -Atc "select count(*) from public.$T")
    B=$(psql "$TESTE" -Atc "select count(*) from public.$T")
    echo "$T: original=$A restaurado=$B $([[ "$A" == "$B" ]] && echo OK || echo DIFERENTE)"
  done
  psql "$DB" -qc "drop database hub_teste_restauracao"
fi
