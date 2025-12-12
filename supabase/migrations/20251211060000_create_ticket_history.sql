-- Tabela para armazenar o histórico completo de cada senha
CREATE TABLE IF NOT EXISTS ticket_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Referências às tabelas principais
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  doctor_ticket_id UUID REFERENCES doctor_tickets(id) ON DELETE SET NULL,
  
  -- Identificação da senha
  display_number VARCHAR(20) NOT NULL,
  
  -- Tipo do evento
  event_type VARCHAR(50) NOT NULL,
  -- Tipos possíveis:
  -- 'emitido' - Senha emitida no totem
  -- 'chamado_operador' - Chamada pelo operador
  -- 'repetido_operador' - Chamada repetida pelo operador
  -- 'encaminhado' - Encaminhado para médico pelo operador
  -- 'cancelado_operador' - Cancelado pelo operador
  -- 'chamado_medico' - Chamada pelo médico
  -- 'repetido_medico' - Chamada repetida pelo médico
  -- 'confirmado_chegada' - Paciente confirmou chegada (médico)
  -- 'cancelado_medico' - Cancelado pelo médico
  -- 'finalizado_medico' - Consulta finalizada pelo médico
  -- 'atendido_operador' - Atendido pelo operador (sem encaminhamento)
  
  -- Descrição amigável do evento
  event_description TEXT,
  
  -- Dados do operador (quando aplicável)
  operator_id UUID,
  operator_name VARCHAR(255),
  counter VARCHAR(50),
  
  -- Dados do médico (quando aplicável)
  doctor_id UUID,
  doctor_name VARCHAR(255),
  consultorio VARCHAR(50),
  
  -- Dados do paciente (quando aplicável)
  patient_name VARCHAR(255),
  
  -- Contadores de chamadas
  operator_call_count INTEGER DEFAULT 0,
  doctor_call_count INTEGER DEFAULT 0,
  
  -- Motivo de cancelamento (quando aplicável)
  cancellation_reason TEXT,
  
  -- Dados adicionais em JSON para flexibilidade futura
  metadata JSONB DEFAULT '{}',
  
  -- Timestamp do evento
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices para consultas rápidas
CREATE INDEX idx_ticket_history_ticket_id ON ticket_history(ticket_id);
CREATE INDEX idx_ticket_history_doctor_ticket_id ON ticket_history(doctor_ticket_id);
CREATE INDEX idx_ticket_history_display_number ON ticket_history(display_number);
CREATE INDEX idx_ticket_history_event_type ON ticket_history(event_type);
CREATE INDEX idx_ticket_history_created_at ON ticket_history(created_at DESC);

-- RLS para a tabela de histórico
ALTER TABLE ticket_history ENABLE ROW LEVEL SECURITY;

-- Política de leitura: todos podem ler
CREATE POLICY "Permite leitura do histórico para todos"
  ON ticket_history FOR SELECT
  USING (true);

-- Política de inserção: apenas service role ou triggers
CREATE POLICY "Permite inserção do histórico"
  ON ticket_history FOR INSERT
  WITH CHECK (true);

-- ============================================
-- FUNÇÕES E TRIGGERS PARA CAPTURAR EVENTOS
-- ============================================

-- Função para registrar evento no histórico
CREATE OR REPLACE FUNCTION log_ticket_event(
  p_ticket_id UUID,
  p_doctor_ticket_id UUID,
  p_display_number VARCHAR(20),
  p_event_type VARCHAR(50),
  p_event_description TEXT,
  p_operator_id UUID DEFAULT NULL,
  p_operator_name VARCHAR(255) DEFAULT NULL,
  p_counter VARCHAR(50) DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL,
  p_doctor_name VARCHAR(255) DEFAULT NULL,
  p_consultorio VARCHAR(50) DEFAULT NULL,
  p_patient_name VARCHAR(255) DEFAULT NULL,
  p_operator_call_count INTEGER DEFAULT 0,
  p_doctor_call_count INTEGER DEFAULT 0,
  p_cancellation_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_history_id UUID;
BEGIN
  INSERT INTO ticket_history (
    ticket_id, doctor_ticket_id, display_number, event_type, event_description,
    operator_id, operator_name, counter,
    doctor_id, doctor_name, consultorio,
    patient_name, operator_call_count, doctor_call_count,
    cancellation_reason, metadata
  ) VALUES (
    p_ticket_id, p_doctor_ticket_id, p_display_number, p_event_type, p_event_description,
    p_operator_id, p_operator_name, p_counter,
    p_doctor_id, p_doctor_name, p_consultorio,
    p_patient_name, p_operator_call_count, p_doctor_call_count,
    p_cancellation_reason, p_metadata
  ) RETURNING id INTO v_history_id;
  
  RETURN v_history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGER PARA TABELA TICKETS
-- ============================================

CREATE OR REPLACE FUNCTION trigger_ticket_history()
RETURNS TRIGGER AS $$
DECLARE
  v_event_type VARCHAR(50);
  v_event_description TEXT;
  v_call_count INTEGER;
BEGIN
  -- INSERT: Senha emitida no totem
  IF TG_OP = 'INSERT' THEN
    PERFORM log_ticket_event(
      NEW.id,
      NULL,
      NEW.display_number,
      'emitido',
      'Senha emitida no totem',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      0,
      0,
      NULL,
      jsonb_build_object('priority', NEW.priority, 'queue_id', NEW.queue_id)
    );
    RETURN NEW;
  END IF;
  
  -- UPDATE: Verificar o que mudou
  IF TG_OP = 'UPDATE' THEN
    
    -- Senha chamada pelo operador (called_at foi preenchido pela primeira vez ou atualizado)
    IF (OLD.called_at IS NULL AND NEW.called_at IS NOT NULL) OR 
       (OLD.called_at IS NOT NULL AND NEW.called_at IS NOT NULL AND OLD.called_at < NEW.called_at) THEN
      
      -- Contar quantas vezes foi chamada
      SELECT COUNT(*) + 1 INTO v_call_count
      FROM ticket_history
      WHERE ticket_id = NEW.id AND event_type IN ('chamado_operador', 'repetido_operador');
      
      IF v_call_count = 1 THEN
        v_event_type := 'chamado_operador';
        v_event_description := 'Senha chamada pelo operador';
      ELSE
        v_event_type := 'repetido_operador';
        v_event_description := 'Chamada repetida pelo operador (' || v_call_count || 'ª vez)';
      END IF;
      
      PERFORM log_ticket_event(
        NEW.id,
        NULL,
        NEW.display_number,
        v_event_type,
        v_event_description,
        NULL, -- tickets não tem operator_id
        NEW.operator_name,
        NEW.counter,
        NULL,
        NULL,
        NULL,
        NULL, -- tickets não tem patient_name
        v_call_count,
        0,
        NULL,
        jsonb_build_object('counter', NEW.counter)
      );
    END IF;
    
    -- Senha served pelo operador: não registra aqui
    -- O encaminhamento será registrado no INSERT de doctor_tickets com as informações do médico
    
    -- Senha cancelada pelo operador
    IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL THEN
      -- Verificar se foi cancelado pelo operador (não tem doctor_ticket associado ainda ou foi cancelado direto)
      PERFORM log_ticket_event(
        NEW.id,
        NULL,
        NEW.display_number,
        'cancelado_operador',
        'Senha cancelada pelo operador',
        NULL, -- tickets não tem operator_id
        NEW.operator_name,
        NEW.counter,
        NULL,
        NULL,
        NULL,
        NULL, -- tickets não tem patient_name
        0,
        0,
        NEW.cancellation_reason,
        NULL
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger na tabela tickets
DROP TRIGGER IF EXISTS ticket_history_trigger ON tickets;
CREATE TRIGGER ticket_history_trigger
  AFTER INSERT OR UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_ticket_history();

-- ============================================
-- TRIGGER PARA TABELA DOCTOR_TICKETS
-- ============================================

CREATE OR REPLACE FUNCTION trigger_doctor_ticket_history()
RETURNS TRIGGER AS $$
DECLARE
  v_event_type VARCHAR(50);
  v_event_description TEXT;
  v_call_count INTEGER;
  v_ticket_id UUID;
  v_display_number VARCHAR(20);
BEGIN
  -- Obter dados do ticket original
  v_ticket_id := NEW.ticket_id;
  v_display_number := NEW.display_number;
  
  -- INSERT: Registrar encaminhamento com dados do médico
  IF TG_OP = 'INSERT' THEN
    -- Buscar especialidade do médico
    DECLARE
      v_specialty_name TEXT;
    BEGIN
      IF NEW.doctor_id IS NOT NULL THEN
        SELECT ms.name INTO v_specialty_name
        FROM profiles p
        LEFT JOIN medical_specialties ms ON p.specialty_id = ms.id
        WHERE p.id = NEW.doctor_id;
      END IF;
      
      -- Criar descrição detalhada do encaminhamento
      DECLARE
        v_desc TEXT;
      BEGIN
        v_desc := 'Senha encaminhada para consulta com ';
        
        IF NEW.doctor_name IS NOT NULL THEN
          v_desc := v_desc || NEW.doctor_name;
        ELSE
          v_desc := v_desc || 'o médico';
        END IF;
        
        IF v_specialty_name IS NOT NULL THEN
          v_desc := v_desc || ' (' || v_specialty_name || ')';
        END IF;
        
        IF NEW.counter IS NOT NULL THEN
          v_desc := v_desc || ', Sala ' || NEW.counter;
        END IF;
        
        -- Registrar encaminhamento
        PERFORM log_ticket_event(
          v_ticket_id,
          NEW.id,
          v_display_number,
          'encaminhado',
          v_desc,
          NULL,
          NULL,
          NULL,
          NEW.doctor_id,
          NEW.doctor_name,
          NEW.counter,
          NEW.patient_name,
          0,
          0,
          NULL,
          jsonb_build_object('specialty', v_specialty_name, 'consultorio', NEW.counter)
        );
      END;
    END;
    
    RETURN NEW;
  END IF;
  
  -- UPDATE: Verificar o que mudou
  IF TG_OP = 'UPDATE' THEN
    
    -- Senha chamada pelo médico (called_at foi preenchido ou atualizado)
    IF (OLD.called_at IS NULL AND NEW.called_at IS NOT NULL) OR 
       (OLD.called_at IS NOT NULL AND NEW.called_at IS NOT NULL AND OLD.called_at < NEW.called_at) THEN
      
      -- Contar quantas vezes foi chamada pelo médico
      SELECT COUNT(*) + 1 INTO v_call_count
      FROM ticket_history
      WHERE (ticket_id = v_ticket_id OR doctor_ticket_id = NEW.id) 
        AND event_type IN ('chamado_medico', 'repetido_medico');
      
      IF v_call_count = 1 THEN
        v_event_type := 'chamado_medico';
        v_event_description := 'Senha chamada pelo médico';
      ELSE
        v_event_type := 'repetido_medico';
        v_event_description := 'Chamada repetida pelo médico (' || v_call_count || 'ª vez)';
      END IF;
      
      PERFORM log_ticket_event(
        v_ticket_id,
        NEW.id,
        v_display_number,
        v_event_type,
        v_event_description,
        NULL,
        NULL,
        NULL,
        NEW.doctor_id,
        NEW.doctor_name,
        NEW.counter,
        NEW.patient_name,
        0,
        v_call_count,
        NULL,
        jsonb_build_object('consultorio', NEW.counter)
      );
    END IF;
    
    -- Paciente confirmou chegada (status mudou para 'in_service')
    IF OLD.status != 'in_service' AND NEW.status = 'in_service' THEN
      PERFORM log_ticket_event(
        v_ticket_id,
        NEW.id,
        v_display_number,
        'confirmado_chegada',
        'Médico confirmou chegada do paciente',
        NULL,
        NULL,
        NULL,
        NEW.doctor_id,
        NEW.doctor_name,
        NEW.counter,
        NEW.patient_name,
        0,
        0,
        NULL,
        NULL
      );
    END IF;
    
    -- Consulta finalizada pelo médico (status mudou para 'served')
    IF OLD.status != 'served' AND NEW.status = 'served' THEN
      PERFORM log_ticket_event(
        v_ticket_id,
        NEW.id,
        v_display_number,
        'finalizado_medico',
        'Consulta finalizada pelo médico',
        NULL,
        NULL,
        NULL,
        NEW.doctor_id,
        NEW.doctor_name,
        NEW.counter,
        NEW.patient_name,
        0,
        0,
        NULL,
        NULL
      );
    END IF;
    
    -- Senha cancelada pelo médico
    IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' THEN
      PERFORM log_ticket_event(
        v_ticket_id,
        NEW.id,
        v_display_number,
        'cancelado_medico',
        'Senha cancelada pelo médico',
        NULL,
        NULL,
        NULL,
        NEW.doctor_id,
        NEW.doctor_name,
        NEW.counter,
        NEW.patient_name,
        0,
        0,
        NULL, -- O motivo está na tabela tickets
        NULL
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger na tabela doctor_tickets
DROP TRIGGER IF EXISTS doctor_ticket_history_trigger ON doctor_tickets;
CREATE TRIGGER doctor_ticket_history_trigger
  AFTER INSERT OR UPDATE ON doctor_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_doctor_ticket_history();

-- ============================================
-- VIEW PARA CONSULTA FACILITADA DO HISTÓRICO
-- ============================================

CREATE OR REPLACE VIEW ticket_history_view AS
SELECT 
  th.*,
  t.priority,
  t.queue_id,
  q.name as queue_name,
  t.status as current_status
FROM ticket_history th
LEFT JOIN tickets t ON th.ticket_id = t.id
LEFT JOIN queues q ON t.queue_id = q.id
ORDER BY th.created_at DESC;

-- Permissão para a view
GRANT SELECT ON ticket_history_view TO authenticated;
GRANT SELECT ON ticket_history_view TO anon;
