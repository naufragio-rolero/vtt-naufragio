import { validateSiteConfig } from '../backend/public/site-config.js';

const value=new URLSearchParams(location.hash.slice(1)).get('join');
history.replaceState(null,'',location.pathname+location.search);
// Scanning again in the same tab can be a fragment-only navigation.
window.addEventListener('hashchange',()=>{if(location.hash)location.reload();});
const get=id=>document.getElementById(id);let config,requestToken,timer,controller,stopped=false;
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const message=text=>{get('joinStatus').textContent=text;};
function stop(){stopped=true;clearTimeout(timer);controller?.abort();}
async function api(path,body){
  controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(config.apiBaseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
    const data=await r.json();if(!r.ok)throw new Error(data?.error?.code||'CONNECTION');return data;
  }finally{clearTimeout(deadline);}
}
async function poll(){
  if(stopped)return;
  try{
    const result=await api('/guest-requests/status',{requestToken});
    if(stopped)return;
    if(result.state==='approved'){
      const claimed=await api('/guest-requests/claim',{requestToken});if(stopped)return;
      sessionStorage.setItem('naufragio-guest-session-v1',JSON.stringify({token:claimed.token,expiresAt:claimed.expiresAt,apiBaseUrl:config.apiBaseUrl}));
      stop();message('Admitido. Abriendo la mesa…');location.replace(new URL('./index.html',location.href));return;
    }
    if(result.state==='rejected'||result.state==='claimed'){stop();message(result.state==='rejected'?'El director ha rechazado la solicitud.':'Esta solicitud ya se ha utilizado. Escanea un nuevo QR para volver a solicitar acceso.');return;}
    message('Esperando la aprobación del director…');timer=setTimeout(poll,3000);
  }catch(error){
    if(stopped)return;
    if(error.message==='ADMISSION_EXPIRED'){stop();message('La invitación ha caducado o se ha cerrado. Pide al director un QR nuevo.');}
    else{message('Desconectado. Intentando recuperar la solicitud…');timer=setTimeout(poll,5000);}
  }
}
get('guestJoin').addEventListener('submit',async e=>{
  e.preventDefault();get('requestJoin').disabled=true;get('guestName').disabled=true;message('Solicitando acceso…');
  try{
    const pending=await api('/guest-requests',{admissionToken:value,displayName:get('guestName').value});
    requestToken=pending.requestToken;
    sessionStorage.setItem('naufragio-guest-pending-v1',JSON.stringify({requestToken,apiBaseUrl:config.apiBaseUrl,expiresAt:pending.expiresAt}));await poll();
  }catch{message('No se pudo solicitar acceso. El QR puede estar cerrado, caducado o haber alcanzado su límite. Pide ayuda al director.');}
});
window.addEventListener('pagehide',stop);
try{
  const r=await fetch(new URL('../site.config.json',import.meta.url),{credentials:'omit',redirect:'error',cache:'no-store'});
  config=validateSiteConfig(await r.json(),{development:local});
  get('joinDestination').textContent='Mesa alojada en '+new URL(config.apiBaseUrl).host;
  const pending=JSON.parse(sessionStorage.getItem('naufragio-guest-pending-v1')||'null');
  if(/^qr_[A-Za-z0-9_-]{43}$/.test(value)){
    sessionStorage.removeItem('naufragio-guest-pending-v1');get('guestName').disabled=false;get('requestJoin').disabled=false;message('Introduce tu nombre para solicitar acceso.');
  }else if(pending&&pending.apiBaseUrl===config.apiBaseUrl&&pending.expiresAt>Date.now()&&/^request_[A-Za-z0-9_-]{43}$/.test(pending.requestToken)){
    requestToken=pending.requestToken;await poll();
  }else message('El enlace de invitación no es válido. Escanea el QR que muestre el director.');
}catch{message('No se pudo conectar con esta mesa. Pide al director que compruebe la conexión y la configuración del sitio.');}
