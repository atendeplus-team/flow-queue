// Simula o fluxo de chamadas do Doutor em MODO 2 (Ordem de Chegada) usando a lógica atual
const items = [
  { id: 'edca6e75-d6a4-4b9a-80f5-fb8ff65b29da', display_number: 'PR-002', priority: 'priority', status: 'waiting', created_at: '2025-12-24T03:01:40.288018Z', urgent: 1, urgent_date: '2025-12-24T03:01:28.85Z', ticket_number: 2 },
  { id: 'ef0f9656-9d90-413e-a8a9-ed5b5cab960c', display_number: 'ATD-005', priority: 'normal', status: 'waiting', created_at: '2025-12-24T03:01:45.420816Z', urgent: 1, urgent_date: '2025-12-24T03:01:31.266Z', ticket_number: 5 },
  { id: 'b8632dc0-1dba-4fb7-bf39-046b6069f206', display_number: 'ATD-001', priority: 'normal', status: 'waiting', created_at: '2025-12-24T03:01:54.047884Z', urgent: 0, ticket_number: 1 },
  { id: 'a8554f20-2385-4c13-9685-69dc0bb2e2c8', display_number: 'OC-003', priority: 'normal', status: 'waiting', created_at: '2025-12-24T03:02:00.441932Z', urgent: 0, ticket_number: 3 },
  { id: 'e906de23-55c3-4c4b-9e77-c6768e33c3f9', display_number: 'PR-004', priority: 'priority', status: 'waiting', created_at: '2025-12-24T03:02:07.299447Z', urgent: 0, ticket_number: 4 },
  { id: 'af1ad43a-62f0-402b-b777-0f38036d2620', display_number: 'OC-006', priority: 'normal', status: 'waiting', created_at: '2025-12-24T03:02:13.83984Z', urgent: 0, ticket_number: 6 },
];

const nowISO = () => new Date().toISOString();

function logState(step) {
  console.log('\n----', step, '----');
  console.table(items.map(i=>({id:i.id, display_number:i.display_number, status:i.status, ticket_number:i.ticket_number, urgent:i.urgent, created_at:i.created_at})));
}

function findLastNonUrgNum() {
  // last non-urgent called or finished by most recent time
  const nonUrg = items.filter(t => (t.priority === 'normal') && (t.urgent !== 1) && (t.status === 'called' || t.status === 'served'));
  if (!nonUrg.length) return 0;
  // use called_at or served_at times; here we simulate called as having called_at set
  nonUrg.sort((a,b)=>{
    const aTime = a.called_at ? Date.parse(a.called_at) : (a.served_at?Date.parse(a.served_at):0);
    const bTime = b.called_at ? Date.parse(b.called_at) : (b.served_at?Date.parse(b.served_at):0);
    return bTime - aTime;
  });
  const recent = nonUrg[0];
  return recent.ticket_number || parseInt((recent.display_number.match(/(\d+)/)||[])[0]||0,10) || 0;
}

function callNext() {
  // 1) urgents waiting?
  const urgentWaiting = items.filter(t => t.urgent === 1 && t.status === 'waiting').sort((a,b)=> new Date(a.urgent_date).getTime() - new Date(b.urgent_date).getTime() || new Date(a.created_at)-new Date(b.created_at));
  if (urgentWaiting.length) {
    const u = urgentWaiting[0];
    // mark called
    u.status = 'called';
    u.called_at = nowISO();
    console.log('Called urgent:', u.display_number);
    return u;
  }

  // MODE 2 numeric flow
  const lastNum = findLastNonUrgNum();
  const nextNum = lastNum + 1;
  // search waiting
  const waiting = items.filter(t => t.status === 'waiting');
  // exact next
  const exact = waiting.find(w => (w.ticket_number || parseInt((w.display_number.match(/(\d+)/)||[])[0]||0,10)) === nextNum);
  if (exact) { exact.status='called'; exact.called_at = nowISO(); console.log('Called exact nextNum:', exact.display_number); return exact; }
  // smallest > last
  const greater = waiting.map(w => ({...w, __num: w.ticket_number || parseInt((w.display_number.match(/(\d+)/)||[])[0]||0,10)})).filter(w=>w.__num>lastNum).sort((a,b)=>a.__num-b.__num||new Date(a.created_at)-new Date(b.created_at));
  if (greater.length) { const sel = items.find(i=>i.id===greater[0].id); sel.status='called'; sel.called_at = nowISO(); console.log('Called smallest > last:', sel.display_number); return sel; }
  // fallback earliest waiting
  if (waiting.length) {
    waiting.sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
    const sel = waiting[0]; sel.status='called'; sel.called_at=nowISO(); console.log('Called fallback earliest:', sel.display_number); return sel;
  }
  console.log('No tickets to call');
  return null;
}

// Simulação: call next repeatedly and optionally confirm arrival
logState('Initial state');
// call 1
callNext(); logState('After call 1');
// call 2
callNext(); logState('After call 2');
// call 3
callNext(); logState('After call 3');
// call 4
callNext(); logState('After call 4');
// call 5
callNext(); logState('After call 5');
// call 6
callNext(); logState('After call 6');
