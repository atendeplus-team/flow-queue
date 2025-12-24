-- Script de teste: reseta registros em doctor_tickets para o estado "enviado pelo operador"
-- Uso: execute no psql conectado ao banco do Supabase (staging/dev):
-- psql "postgres://..."

BEGIN;

UPDATE public.doctor_tickets
SET
  status = 'waiting',
  called_at = NULL,
  served_at = NULL,
  in_service = false,
  finished_at = NULL,
  counter = NULL
WHERE id IN (
  'edca6e75-d6a4-4b9a-80f5-fb8ff65b29da',
  'ef0f9656-9d90-413e-a8a9-ed5b5cab960c',
  'b8632dc0-1dba-4fb7-bf39-046b6069f206',
  'a8554f20-2385-4c13-9685-69dc0bb2e2c8',
  'e906de23-55c3-4c4b-9e77-c6768e33c3f9',
  'af1ad43a-62f0-402b-b777-0f38036d2620'
);

-- Opcional: também atualizar ticket original (tickets) para manter consistência
-- (descomente se quiser que o ticket original volte a status 'waiting')
-- UPDATE public.tickets
-- SET status = 'waiting', in_service = false, called_at = NULL, finished_at = NULL
-- WHERE id IN (
--  'cb5dbe2c-70fe-434c-ba63-50a1e639c3c9',
--  '630fa8ae-57ad-454f-ae37-3e490909fcef',
--  '51943a81-22f9-4783-9473-94fb5c793d47',
--  '76d6af50-9876-4190-8001-5f4d48ca0e2c',
--  '43412f0d-bd5d-4e88-b189-60a38c6babff',
--  '300366d3-e932-454c-b58e-f936b6ae93bb'
-- );

COMMIT;

-- Observação: ajuste a lista de IDs conforme necessário para seus testes.
-- Se preferir, você pode filtrar por doctor_id e created_at para aplicar o reset em lote.
