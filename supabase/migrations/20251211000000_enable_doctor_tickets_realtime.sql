-- Enable Realtime for doctor_tickets table with REPLICA IDENTITY FULL
-- This ensures that the old values are sent in UPDATE events for realtime subscriptions

ALTER TABLE public.doctor_tickets REPLICA IDENTITY FULL;

-- Enable realtime publication for doctor_tickets if not already enabled
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_tickets;
