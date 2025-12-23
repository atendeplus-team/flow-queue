-- Adiciona colunas de urgência na tabela tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgent INTEGER DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgent_date TIMESTAMPTZ;

-- Adiciona colunas de urgência na tabela ticket_history
ALTER TABLE ticket_history ADD COLUMN IF NOT EXISTS urgent INTEGER DEFAULT 0;
ALTER TABLE ticket_history ADD COLUMN IF NOT EXISTS urgent_date TIMESTAMPTZ;

-- Adiciona colunas de urgência na tabela doctor_tickets
ALTER TABLE doctor_tickets ADD COLUMN IF NOT EXISTS urgent INTEGER DEFAULT 0;
ALTER TABLE doctor_tickets ADD COLUMN IF NOT EXISTS urgent_date TIMESTAMPTZ;

-- Evento de histórico para urgência
-- (A trigger já existente pode ser adaptada para registrar o evento de urgência)
