// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { doctor_ticket_id, cancellation_reason } = await req
      .json()
      .catch(() => ({}));

    if (!doctor_ticket_id) {
      throw new Error('doctor_ticket_id is required');
    }

    if (!cancellation_reason || !cancellation_reason.trim()) {
      throw new Error('cancellation_reason is required');
    }

    // Usa service_role para bypassar RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date().toISOString();

    // 1) Busca o ticket_id do doctor_tickets
    const { data: doctorTicket, error: fetchError } = await supabase
      .from('doctor_tickets')
      .select('id, ticket_id, display_number')
      .eq('id', doctor_ticket_id)
      .single();

    if (fetchError || !doctorTicket) {
      console.error('[doctor-cancel-ticket] Fetch error:', fetchError);
      throw new Error('Não foi possível encontrar a senha do médico.');
    }

    const ticketId = doctorTicket.ticket_id;

    if (!ticketId) {
      throw new Error('ticket_id não encontrado no registro do médico.');
    }

    // 2) Atualiza a tabela tickets (senha original)
    const { data: ticketUpdate, error: ticketError } = await supabase
      .from('tickets')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        finished_at: now,
        in_service: false,
        cancellation_reason: cancellation_reason.trim(),
      })
      .eq('id', ticketId)
      .select();

    if (ticketError) {
      console.error('[doctor-cancel-ticket] Ticket update error:', ticketError);
      throw new Error(
        'Erro ao atualizar a senha original: ' + ticketError.message
      );
    }

    console.log('[doctor-cancel-ticket] Ticket atualizado:', ticketUpdate);

    // 3) Atualiza a tabela doctor_tickets
    const { data: doctorUpdate, error: doctorError } = await supabase
      .from('doctor_tickets')
      .update({
        status: 'cancelled',
        finished_at: now,
        in_service: false,
      })
      .eq('id', doctor_ticket_id)
      .select();

    if (doctorError) {
      console.error(
        '[doctor-cancel-ticket] Doctor ticket update error:',
        doctorError
      );
      throw new Error(
        'Erro ao atualizar a senha do médico: ' + doctorError.message
      );
    }

    console.log(
      '[doctor-cancel-ticket] Doctor ticket atualizado:',
      doctorUpdate
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Senha ${doctorTicket.display_number} cancelada com sucesso.`,
        ticket: ticketUpdate?.[0] || null,
        doctorTicket: doctorUpdate?.[0] || null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[doctor-cancel-ticket] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro desconhecido',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
