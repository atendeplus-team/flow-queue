// Simulação com os dados que você enviou para validar seleção
const items = [
  { display_number: 'PR-002', priority: 'priority', status: 'served', ticket_number: 2, called_at: '2025-12-24T03:02:16.197Z', finished_at: '2025-12-24T03:02:20.178Z', urgent:1, urgent_date: '2025-12-24T03:01:28.85Z' },
  { display_number: 'ATD-005', priority: 'normal', status: 'served', ticket_number: 5, called_at: '2025-12-24T03:02:22.144Z', finished_at: '2025-12-24T03:02:24.058Z', urgent:1, urgent_date: '2025-12-24T03:01:31.266Z' },
  { display_number: 'ATD-001', priority: 'normal', status: 'waiting', ticket_number: 1, created_at: '2025-12-24T03:01:54.047884Z' },
  { display_number: 'OC-003', priority: 'normal', status: 'waiting', ticket_number: 3, created_at: '2025-12-24T03:02:00.441932Z' },
  { display_number: 'PR-004', priority: 'priority', status: 'waiting', ticket_number: 4, created_at: '2025-12-24T03:02:07.299447Z' },
  { display_number: 'OC-006', priority: 'normal', status: 'called', ticket_number: 6, created_at: '2025-12-24T03:02:13.83984Z', called_at: '2025-12-24T03:02:26.221Z' },
];

const parseNum = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };

// 1) urgentes waiting?
const urgentWaiting = items.filter(t => t.urgent === 1 && t.status === 'waiting').sort((a,b)=> (new Date(a.urgent_date||0)) - (new Date(b.urgent_date||0)));
console.log('urgentWaiting:', urgentWaiting.map(t=>t.display_number));

if (urgentWaiting.length) {
  console.log('Next should be urgent:', urgentWaiting[0].display_number);
} else {
  // find last non-urgent called or finished
  const nonUrgCandidates = items.filter(t => t.priority === 'normal' && (t.called_at || t.finished_at));
  const mostRecent = nonUrgCandidates.map(t=>({row:t, time: Math.max(new Date(t.called_at||0).getTime(), new Date(t.finished_at||0).getTime())})).sort((a,b)=>b.time-a.time)[0];
  const recentRow = mostRecent ? mostRecent.row : null;
  const lastNormalNum = recentRow ? (recentRow.ticket_number || parseNum(recentRow.display_number)) : 0;
  console.log('most recent non-urgent:', recentRow ? recentRow.display_number : null, 'lastNormalNum=', lastNormalNum);

  const nextNum = lastNormalNum + 1;
  const waiting = items.filter(t => t.status === 'waiting');
  // exact
  const exact = waiting.find(w => (w.ticket_number || parseNum(w.display_number)) === nextNum);
  if (exact) console.log('Selected by exact next number:', exact.display_number);
  else {
    const greater = waiting.map(w=>({...w, __num: w.ticket_number || parseNum(w.display_number)})).filter(w=>w.__num > lastNormalNum).sort((a,b)=>a.__num-b.__num||new Date(a.created_at||0)-new Date(b.created_at||0));
    if (greater.length) console.log('Selected by smallest > last:', greater[0].display_number);
    else {
      if (waiting.length) {
        const earliest = waiting.sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))[0];
        console.log('Fallback earliest waiting:', earliest.display_number);
      } else console.log('No waiting tickets');
    }
  }
}
