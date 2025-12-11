-- Adiciona coluna para armazenar o motivo do cancelamento da senha
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(200) NULL;

-- Comentário na coluna
COMMENT ON COLUMN public.tickets.cancellation_reason IS 'Motivo do cancelamento da senha (obrigatório quando status = cancelled)';
