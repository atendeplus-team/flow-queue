// scripts/doctor_call_sim.js
// Simula o fluxo: chamar próxima (marca 'called') e depois confirmar (muda para 'in_service')

const items = [
  { id: '1', display_number: 'ATD-001', priority: 'normal', status: 'waiting' },
  { id: '2', display_number: 'OC-001', priority: 'normal', status: 'waiting' },
  { id: '3', display_number: 'OC-002', priority: 'normal', status: 'waiting' },
  { id: '4', display_number: 'PR-001', priority: 'priority', status: 'waiting' },
  { id: '5', display_number: 'ATD-002', priority: 'normal', status: 'waiting' },
];

function callNextMock(list) {
  // pick first urgent or per 2-para-1; here assume no urgents and 2-para-1
  const normals = list.filter(l => l.priority === 'normal' && l.status === 'waiting');
  const prefs = list.filter(l => l.priority !== 'normal' && l.status === 'waiting');
  let toCall = null;
  if (prefs.length > 0) {
    // simulate pattern counter 0 => call 2 normals then pref
    toCall = normals[0] || prefs[0];
  } else {
    toCall = list.find(l => l.status === 'waiting');
  }
  if (!toCall) return null;
  toCall.status = 'called';
  return toCall;
}

function confirmArrivalMock(ticket) {
  if (!ticket) return null;
  ticket.status = 'in_service';
  return ticket;
}

console.log('Before call:', items.map(i=>`${i.display_number}:${i.status}`).join(', '));
const called = callNextMock(items);
console.log('Called:', called.display_number, 'status now', called.status);
console.log('After call:', items.map(i=>`${i.display_number}:${i.status}`).join(', '));
const confirmed = confirmArrivalMock(called);
console.log('After confirm:', items.map(i=>`${i.display_number}:${i.status}`).join(', '));
