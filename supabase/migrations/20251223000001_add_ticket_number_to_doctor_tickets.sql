-- Add ticket_number column to doctor_tickets and populate from display_number
BEGIN;

ALTER TABLE IF EXISTS doctor_tickets
  ADD COLUMN IF NOT EXISTS ticket_number integer;

-- Populate ticket_number extracting digits from display_number when possible
UPDATE doctor_tickets
SET ticket_number = NULLIF(regexp_replace(display_number, '\\D', '', 'g'), '')::int
WHERE ticket_number IS NULL;

-- Create index to optimize queries by ticket_number
CREATE INDEX IF NOT EXISTS idx_doctor_tickets_ticket_number ON doctor_tickets(ticket_number);

COMMIT;