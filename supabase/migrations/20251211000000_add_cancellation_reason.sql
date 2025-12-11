-- Add cancellation_reason column to doctor_tickets table
ALTER TABLE doctor_tickets
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Add comment to the column
COMMENT ON COLUMN doctor_tickets.cancellation_reason IS 'Reason for ticket cancellation when patient did not arrive';
