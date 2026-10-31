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
export function initQr({ api, getRoom, refreshMembers, status }) {
  const get=id=>document.getElementById(id);let timer=null,epoch=0,roomId=null;
  const stop=()=>{epoch++;clearTimeout(timer);timer=null;};
  function reset(){stop();roomId=null;get('qrLink').value='';get('qrRequests').replaceChildren();get('qrCanvas').hidden=true;if(get('qrDialog').open)get('qrDialog').close();}
  async function refresh(){
    const current=epoch,id=roomId;if(!id||!get('qrDialog').open)return;
    try{
      const value=await api(`/rooms/${id}/admission`);
      if(current!==epoch)return;
      get('qrStatus').textContent=value.admission?.open?'Admisión abierta. Aprueba solo a quienes reconozcas.':'Admisión cerrada o caducada.';
      get('qrRequests').replaceChildren();
      for(const entry of value.requests){
        const row=document.createElement('div');row.className='qr-request';row.dataset.requestId=entry.id;
        const label=document.createElement('span');label.textContent=entry.displayName+' (#'+entry.id.slice(0,6)+') · '+({pending:'Esperando aprobación',approved:'Admitido; esperando conexión',claimed:'Admitido',rejected:'Rechazado'}[entry.state]||entry.state);row.append(label);
        if(entry.state==='pending')for(const approve of [true,false]){
          const button=document.createElement('button');button.type='button';button.textContent=approve?'Aprobar':'Rechazar';
          button.addEventListener('click',()=>void run(async()=>{await api(`/rooms/${id}/admission/${entry.id}`,{method:'POST',body:{approve}});await refresh();await refreshMembers();}));row.append(button);
        }
        get('qrRequests').append(row);
      }
    }catch{if(current===epoch)get('qrStatus').textContent='No se pudo actualizar la admisión. Comprueba la conexión.';}
    finally{if(current===epoch&&get('qrDialog').open){clearTimeout(timer);timer=setTimeout(refresh,3000);}}
  }
  async function run(work){try{await work();}catch(e){status('No se pudo completar la admisión. Revisa la conexión o vuelve a generar el QR.',true);}}
  async function generate(){
    const selected=getRoom();if(!selected?.isOwner)throw new Error('FORBIDDEN');
    roomId=selected.room.id;
    const value=await api(`/rooms/${roomId}/admission`,{method:'POST',body:{}});
    const link=invitationLink(location.href,value.admission.token);get('qrLink').value=link;get('qrCanvas').hidden=false;drawQr(get('qrCanvas'),link);await refresh();
  }
  get('inviteQr').addEventListener('click',()=>void run(async()=>{stop();get('qrDialog').showModal();if(!roomId||roomId!==getRoom()?.room.id)await generate();else await refresh();}));
  get('qrNew').addEventListener('click',()=>void run(generate));
  for(const [button,body]of [['qrPause',{open:false}],['qrOpen',{open:true}],['qrRevoke',{open:false,revoke:true}]])get(button).addEventListener('click',()=>void run(async()=>{
    await api(`/rooms/${roomId}/admission`,{method:'PATCH',body});if(body.revoke){get('qrLink').value='';get('qrCanvas').hidden=true;}await refresh();
  }));
  get('qrCopy').addEventListener('click',()=>void run(async()=>{if(get('qrLink').value)await navigator.clipboard.writeText(get('qrLink').value);}));
  get('qrClose').addEventListener('click',()=>get('qrDialog').close());get('qrDialog').addEventListener('close',stop);
  window.addEventListener('pagehide',stop);
  return {reset};
}
