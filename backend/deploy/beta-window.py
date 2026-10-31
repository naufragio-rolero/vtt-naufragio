"""Private root controller for this authorized beta window; no persistent unit."""
import pathlib,subprocess,json,hashlib,os,signal,time,ctypes
P=pathlib.Path
root=P('/opt/naufragio-vtt/phase9');api=P('/etc/apache2/sites-available/api-naufragio-ssl.conf')
manifest=json.loads((root/'manifest.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(a):return subprocess.run(a,capture_output=True,text=True,check=True,timeout=50)
def finish(*_):raise KeyboardInterrupt()
def restore():
 run(['systemctl','stop','naufragio-vtt'])
 assert not run(['ss','-H','-ltn','sport','=',':3400']).stdout.strip()
 current=digest(api)
 if current==manifest['apiProxySha256']:
  api.write_bytes((root/'api-naufragio-ssl.conf').read_bytes());os.chmod(api,0o644)
  run(['apache2ctl','configtest']);run(['systemctl','reload','apache2'])
 elif current!=manifest['apiOriginalSha256']:raise RuntimeError('API_CONCURRENT_CHANGE_REQUIRES_OPERATOR')
 print(json.dumps({'state':'closed','apiOriginal':digest(api)==manifest['apiOriginalSha256'],'unit':run(['systemctl','show','naufragio-vtt','-p','ActiveState','-p','UnitFileState']).stdout.strip()}),flush=True)
if __name__=='__main__':
 assert os.geteuid()==0
 for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,finish)
 parent=os.getppid();assert ctypes.CDLL(None).prctl(1,signal.SIGTERM,0,0,0)==0
 if os.getppid()!=parent:raise SystemExit('CONTROLLER_PARENT_LOST')
 if len(__import__('sys').argv)>1 and __import__('sys').argv[1]=='close':restore();raise SystemExit()
 assert digest(api)==manifest['apiOriginalSha256']
 try:
  run(['systemctl','start','naufragio-vtt'])
  api.write_bytes((root/'api-proxy.conf').read_bytes());os.chmod(api,0o644)
  run(['apache2ctl','configtest']);run(['systemctl','reload','apache2'])
  print(json.dumps({'state':'open','pid':os.getpid(),'limitSeconds':15000}),flush=True)
  began=time.monotonic()
  while time.monotonic()-began<15000:
   if run(['systemctl','show','naufragio-vtt','-p','ActiveState','--value']).stdout.strip()!='active':break
   time.sleep(5)
 except KeyboardInterrupt:pass
 finally:restore()
