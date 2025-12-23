-- Adiciona coluna password_setting na tabela company_settings
-- 1 = Modo 2 para 1 (a cada 2 normais, chama 1 preferencial)
-- 2 = Modo Ordem de Chegada (senhas são chamadas por ordem de chegada, numeração contínua)

ALTER TABLE company_settings
ADD COLUMN IF NOT EXISTS password_setting INTEGER DEFAULT 1;

-- Atualiza registros existentes para o modo padrão (2 para 1)
UPDATE company_settings SET password_setting = 1 WHERE password_setting IS NULL;

-- Adiciona comentário explicativo
COMMENT ON COLUMN company_settings.password_setting IS 'Configuração de chamada de senhas: 1 = Modo 2 para 1 (intercala normal/preferencial), 2 = Ordem de Chegada (sequencial)';
