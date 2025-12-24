// Simulação local da lógica MODO 2 com ticket_number
const items = [
  { display_number: 'ATD-002', priority: 'normal', status: 'served', urgent: 1, urgent_date: '2025-12-24 02:29:54.505+00' },
  { display_number: 'OC-005', priority: 'normal', status: 'served', urgent: 1, urgent_date: '2025-12-24 02:30:18.082+00' },
  { display_number: 'ATD-001', priority: 'normal', status: 'served', urgent: 0 },
  { display_number: 'OC-006', priority: 'normal', status: 'called', urgent: 0 },
  { display_number: 'PR-003', priority: 'priority', status: 'waiting', urgent: 0 },
  { display_number: 'PR-004', priority: 'priority', status: 'waiting', urgent: 0 },
];

const parseNum = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };

const startOfDay = true; // assume filtered by day

// 1) urgentes? (status waiting)
const urgentWaiting = items.filter((t) => t.urgent === 1 && t.status === 'waiting')
  .sort((a,b) => (new Date(a.urgent_date||0)) - (new Date(b.urgent_date||0)));
if (urgentWaiting.length) {
  console.log('Urgent selected:', urgentWaiting[0].display_number);
} else {
  // Find last non-urgent called/finished: simulate items served/called
  const lastNonUrgCandidates = items.filter(t => t.priority === 'normal' && (t.status === 'served' || t.status === 'called'));
  let last = null;
  if (lastNonUrgCandidates.length) {
    // pick most recent by served_at / called_at not available in sample, pick by array order
    last = lastNonUrgCandidates.reverse().find(()=>true);
  }
  const lastNumber = last ? (last.ticket_number || parseNum(last.display_number)) : 0;
  console.log('lastNumber', lastNumber);
  // pick waiting with ticket_number > lastNumber
  const waiting = items.filter(t => t.status === 'waiting');
  const waitingWithNum = waiting.map(t => ({...t, __num: (t.ticket_number || parseNum(t.display_number)) || 0})).filter(w=>w.__num>lastNumber).sort((a,b)=>a.__num-b.__num);
  if (waitingWithNum.length) {
    console.log('Selected by number:', waitingWithNum[0].display_number);
  } else {
    // fallback earliest waiting
    if (waiting.length) console.log('Fallback earliest waiting:', waiting[0].display_number);
    else console.log('No waiting tickets');
  }
}
