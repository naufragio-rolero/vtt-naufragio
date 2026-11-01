import qrcode from './vendor/qrcode-generator-2.0.4.js';

export function invitationLink(base, value) {
  if (!/^qr_[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('INVALID_INPUT');
  const link = new URL('./join.html', base); link.search = ''; link.hash = 'join=' + value; return link.href;
}
export function drawQr(canvas, link) {
  const code = qrcode(0, 'M'); code.addData(link); code.make();
  const count=code.getModuleCount(),scale=Math.max(4,Math.floor(480/(count+8)));
  canvas.width=canvas.height=(count+8)*scale;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
  for(let r=0;r<count;r++)for(let c=0;c<count;c++)if(code.isDark(r,c))ctx.fillRect((c+4)*scale,(r+4)*scale,scale,scale);
}
export function initQr({ api, getRoom, refreshMembers, status, notify = () => {} }) {
  const get = id => document.getElementById(id);
  let timer = null, epoch = 0, roomId = null, flight = null, seen = new Set();
  function reset() {
    epoch++; clearTimeout(timer); timer = null; roomId = null; flight = null; seen = new Set();
    get('qrLink').value = ''; get('qrRequests').replaceChildren(); get('pendingCount').textContent = '0';
    get('qrCanvas').hidden = true;
    if (get('qrDialog').open) get('qrDialog').close();
  }
  async function refresh() {
    if (!roomId || !getRoom()?.isOwner) return;
    if (flight) return flight;
    const current = epoch, id = roomId;
    clearTimeout(timer);
    flight = (async () => {
      try {
        const value = await api(`/rooms/${id}/admission`);
        if (current !== epoch) return;
        get('qrStatus').textContent = value.admission?.open ? 'Admisión abierta. Aprueba solo a quienes reconozcas.' : 'Admisión cerrada o caducada.';
        const pending = value.requests.filter(entry => entry.state === 'pending');
        get('pendingCount').textContent = String(pending.length);
        if (pending.some(entry => !seen.has(entry.id))) { const message = `${pending.length} solicitudes pendientes. Abre Jugadores para revisarlas.`; status(message); notify(message); }
        for (const entry of value.requests) seen.add(entry.id);
        get('qrRequests').replaceChildren();
        for (const entry of value.requests) {
          const row = document.createElement('div'); row.className = 'qr-request'; row.dataset.requestId = entry.id;
          const label = document.createElement('span');
          const age = entry.createdAt == null ? 'antigüedad no disponible (solicitud anterior)' : `hace ${Math.max(0, Math.floor((Date.now() - entry.createdAt) / 60000))} min`;
          label.textContent = `${entry.displayName} · ${({pending:'Esperando aprobación', approved:'Admitido; esperando conexión', claimed:'Admitido', rejected:'Rechazado'})[entry.state] || entry.state} · ${age}`;
          row.append(label);
          if (entry.state === 'pending') for (const approve of [true, false]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = approve ? 'Aprobar' : 'Rechazar';
            button.addEventListener('click', () => void run(async () => {
              button.disabled = true;
              try { await api(`/rooms/${id}/admission/${entry.id}`, { method: 'POST', body: { approve } }); }
              finally { button.disabled = false; }
              await refresh(); await refreshMembers();
            }));
            row.append(button);
          }
          get('qrRequests').append(row);
        }
      } catch {
        if (current === epoch) get('admissionNotice').textContent = 'No se pudo actualizar la admisión. Reintentando…';
      } finally {
        if (current === epoch) { flight = null; timer = setTimeout(refresh, 3000); }
      }
    })();
    return flight;
  }
  async function run(work) { try { await work(); } catch { status('No se pudo completar la admisión. Revisa la conexión y los permisos.', true); } }
  async function generate() {
    if (!getRoom()?.isOwner || !roomId) throw new Error('FORBIDDEN');
    const id = roomId, current = epoch;
    const value = await api(`/rooms/${id}/admission`, { method: 'POST', body: {} });
    if (current !== epoch) return;
    const link = invitationLink(location.href, value.admission.token);
    get('qrLink').value = link; get('qrCanvas').hidden = false; drawQr(get('qrCanvas'), link); await refresh();
  }
  get('inviteQr').addEventListener('click', () => void run(async () => {
    if (!getRoom()?.isOwner) return;
    get('multiplayerDialog').close(); get('playersPanel').hidden = true;
    get('qrDialog').showModal(); await refresh();
  }));
  get('qrNew').addEventListener('click', () => void run(generate));
  for (const [button, body] of [['qrPause', {open:false}], ['qrOpen', {open:true}], ['qrRevoke', {open:false, revoke:true}]]) {
    get(button).addEventListener('click', () => void run(async () => {
      if (!getRoom()?.isOwner || !roomId) return;
      await api(`/rooms/${roomId}/admission`, {method:'PATCH', body});
      if (body.revoke) { get('qrLink').value = ''; get('qrCanvas').hidden = true; }
      await refresh();
    }));
  }
  get('qrCopy').addEventListener('click', () => void run(async () => { if (get('qrLink').value) await navigator.clipboard.writeText(get('qrLink').value); }));
  get('qrClose').addEventListener('click', () => get('qrDialog').close());
  window.addEventListener('pagehide', reset);
  return { reset, start() { reset(); if (getRoom()?.isOwner) { roomId = getRoom().room.id; void refresh(); } }, refresh };
}
