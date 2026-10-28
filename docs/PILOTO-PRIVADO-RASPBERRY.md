# Validación Windows y piloto privado ARMv7

Fecha: **28 de octubre de 2026**. Rama `feat/backend-multijugador`. Primer intento desde `1e0f519`; piloto posterior sobre `1cd4dd6`, conservando los cambios documentales del diagnóstico y las Fases 1–5. No se implementan funciones de juego nuevas.

## Decisión y estado real

**Piloto privado real satisfactorio tras autorización expresa del ajuste SSH; limpieza y rollback completados. Viable para continuar pruebas privadas pequeñas, todavía no preparado para despliegue permanente.** Véanse [resultados ARMv7](#resultado-real-del-piloto-armv7-autorizado), evidencias y límites más abajo.

**Historial del primer intento:**

La Raspberry admite comandos SSH, pero deniega forwarding al destino loopback propuesto. La comprobación `ssh -W 127.0.0.1:3400` respondió `channel 0: open failed: administratively prohibited: open failed` y `stdio forwarding failed`. No es un error de autenticación ni demuestra que el backend falle: la conexión no llega a ese destino. El preflight versionado reproduce el rechazo y termina con salida 1 y `SSH_FORWARDING_DENIED`.

**Diagnóstico posterior, 28 de octubre:** se confirmó que el rechazo procede del `PermitOpen` global de `10-naufragio-hardening.conf`; la clave correspondiente no impone restricciones adicionales. Se validó en memoria una excepción `Match User` que conserva MariaDB y añade únicamente loopback:3400 para la cuenta del piloto, sin cambiar otras cuentas. [Candidato, evidencia, impacto y rollback](DIAGNOSTICO-SSH-PILOTO.md). En ese punto se solicitó autorización sin escribir configuración ni recargar SSH; posteriormente fue concedida y se completó el piloto descrito más abajo.

Las instrucciones locales de acceso advertían de forwarding limitado a MariaDB. En ese primer intento no se reutilizó el puerto ocupado ni se sorteó la restricción. Posteriormente el usuario autorizó expresamente una excepción temporal para la cuenta comprobada, su reload y rollback, y el piloto aislado. Esa autorización no se extiende a Apache, DNS, certificados, firewall u otros servicios.

## Pruebas Windows

| Ejecución | Resultado observado |
| --- | --- |
| Las 93 pruebas existentes, Node 22.23.4 | **93/93**, 361,694 s, sin fallos, omisiones ni cancelaciones. |
| Las 93 pruebas existentes, Node 24.18.0 | **93/93**, 257,944 s, sin fallos, omisiones ni cancelaciones. |
| Tres pruebas nuevas de empaquetado, Node 22 | **3/3**, 5,025 s. |
| Tres pruebas nuevas de empaquetado, Node 24 | **3/3**, 17,764 s. |
| Integración desde fuentes, Edge y Firefox reales | **Aprobada**, raíz y `/vtt/`, tres clientes independientes. |
| Integración desde `dist/`, Node 24 | **Aprobada**, Edge/Firefox, raíz y `/vtt/`, prefijo Socket.IO `/transport` y modo local sin backend. |

Esos primeros resultados corresponden a las 93 pruebas y tres nuevas ejecutadas por separado. **Tras completar y limpiar el piloto se repitió la suite conjunta: 96/96 con Node 22.23.4 (117,557 s) y 96/96 con Node 24.18.0 (91,219 s), sin fallos, omisiones ni cancelaciones.** Los tiempos incluyen carga concurrente de Windows y no son un benchmark comparable con Fase 5.

Edge **156.0.4314.42** y Firefox **142.0.1**, con perfiles temporales de Playwright 1.56.1. Director Edge y jugadores Firefox/Edge en raíz; director Firefox y jugadores Edge/Edge en subruta. Se verifican configuración, login, alta por invitación/rechazo de reutilización, provisión de dirección, creación, invitaciones nominativas y código, asignaciones, movimiento de A y convergencia, rechazo de B incluso saltándose la interfaz, movimiento del director, espera tras logout y recuperación tras login/recarga. Web Locks y otro perfil sin clave/estado mantienen los límites de autoridad. Modo local sin backend y mapa legado conservados.

**Distinción de método:** los controles de las pantallas se accionan con automatización en navegadores reales; no se presenta esto como una sesión manual humana. Se inspeccionaron visualmente las capturas sintéticas de [raíz](evidencia-piloto-windows/dist-root.png) y [subruta](evidencia-piloto-windows/dist-subdirectory.png): Canvas original, dos tokens y sala conectada. El recorrido manual reproducible está en [Fase 5](FASE5-FRONTEND.md#3-recorrido-de-tres-navegadores); queda pendiente la aceptación manual por el operador. No hay credenciales reales, trazas de autorización ni cuentas personales en las evidencias.

## Artefacto público reproducible

Desde `backend/`, Node 22 o 24:

```powershell
npm ci --ignore-scripts
npm run build:frontend
npm run serve:dist
```

Abrir `http://127.0.0.1:8080/`. Iniciar el backend local por separado según [Fase 5](FASE5-FRONTEND.md), configurar el destino y efectuar el recorrido de tres perfiles. Para servir bajo `/vtt/`:

```powershell
$env:FRONTEND_BASE_PATH = '/vtt/'
npm run serve:dist
```

El comando genera **`dist/` en la raíz del repositorio**, ignorado por Git. Lista explícita de 16 archivos públicos, más `manifest.json` con tamaño y SHA-256, sin timestamp. Dos construcciones con los mismos inputs producen el mismo manifiesto. No lee automáticamente `.env` ni `site.config.json` del repositorio. Solo incluye configuración al indicarla expresamente:

```powershell
npm run build:frontend -- --config C:\ruta\publica\site.config.json
```

El JSON debe satisfacer el esquema exacto existente; rechaza campos extra, credenciales embebidas y consultas en URLs. HTTP/WS solo para loopback. **No pasar un archivo de secretos.**

Contenido: HTML/CSS/Canvas, módulos `frontend/`, Socket.IO vendorizado con licencia, cliente de navegador en `client/`, contrato público en `shared/` y ajustes públicos en `settings/`. Los módulos de navegador antes ubicados bajo `backend/client`, `backend/shared` y `backend/public` se copian y sus imports se adaptan en el artefacto; no son el servicio backend. No hay directorio `backend/`, `src/`, dependencias de servidor, scripts, tests, cuentas, SQLite, `.env`, Git ni instrucciones SSH.

La construcción rechaza un `dist/` existente ajeno al generador o un enlace/junction. Un JSON inválido no destruye el artefacto previo. El servidor de revisión escucha solo en loopback y sirve exclusivamente el manifiesto público; no es un servidor de producción. No se modifica el frontend fuente para acomodar estas rutas y no se publica Pages.

Repetir la aceptación sobre el artefacto con las herramientas temporales indicadas en Fase 5:

```powershell
$env:BROWSER_TOOLS_DIR = Join-Path $env:TEMP 'naufragio-vtt-browser-tools'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'naufragio-vtt-browser-binaries'
$env:BROWSER_USE_DIST = '1'
npm run test:browser
Remove-Item Env:BROWSER_USE_DIST
```

## Preflight Raspberry reproducible

Desde la raíz del repositorio, completar los valores privados localmente; nunca guardarlos en documentación pública:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/scripts/pilot-preflight.ps1 `
  -SshTarget '<usuario>@<host>' -IdentityFile '<ruta-a-clave-SSH>' -RemotePort 3400
```

No solicita sudo ni contraseñas, no modifica el host y limita el probe a 15 segundos. Rechaza los puertos de servicios existentes conocidos. Una conexión rechazada por destino vacío demuestra que forwarding llegó al puerto; una denegación administrativa aborta. Un puerto que acepta conexiones no se considera libre. Incluso con resultado favorable hay que revisar otra vez RAM, temperatura y listeners antes de transferir.

### Observaciones reales del host, sin carga de piloto

| Medida | Observación |
| --- | --- |
| Arquitectura | ARMv7, usuario de 32 bits. |
| RAM | Total 920 MiB; disponible 485 MiB inicialmente y 488 MiB en el segundo preflight. |
| Swap | Total 919 MiB; usados 297 MiB. |
| Disco de `/var/tmp` | 53 274 MiB disponibles en raíz; no se usó SSD ni tmpfs. |
| Temperatura | **57,996 °C** en ambas muestras. |
| Carga del host (1/5/15 min) | Inicial 0,10 / 0,10 / 0,09; posterior 0,09 / 0,11 / 0,09. No son porcentajes de CPU. |
| Servicios | Apache, MariaDB y SSH activos; PIDs principales idénticos antes/después. |
| HTTP anónimo | `/hg/` por loopback: 403; servicio existente en su raíz: 404; HTTPS por vhost por defecto: 403. Esto no valida funcionalmente Heaven's Gate ni sus rutas privadas. |
| Node del piloto | No arrancado; `pgrep -x node` sin coincidencias al comprobar. |
| RAM/CPU del backend, RTT, estabilidad de tres clientes | **No medidos**: el gate SSH impidió iniciar el piloto. |

No se atribuyen las mediciones históricas de [Fase 2 ARMv7](VALIDACION-ARMV7.md) a este piloto multijugador. No se leen archivos de Heaven's Gate ni se imprimen cuerpos HTTP, configuraciones sensibles o direcciones privadas en este informe. El primer intento de formatear códigos curl tuvo un problema de comillas de PowerShell; se repitió con formato simple y los códigos de la tabla son de la ejecución corregida.

## Plan de instalación temporal, medición y recuperación

**Guía base para una repetición controlada.** La ejecución autorizada descrita más abajo ya está terminada; la excepción SSH se revirtió. Repetirla exige autorizar de nuevo el ajuste temporal, no ampliar permanentemente la política. Tras disponer del túnel aprobado y confirmar servicios saludables:

1. Registrar baseline funcional de Heaven's Gate mediante su vhost/ruta anónima autorizada y los demás servicios; un 403 del vhost por defecto no lo sustituye. Verificar puerto libre, al menos 384 MiB de RAM disponible, temperatura inferior a 70 °C y carga baja. Si no se cumple, posponer.
2. Crear con `umask 077` y `mktemp -d /var/tmp/naufragio-pilot.XXXXXX` una raíz nueva; registrar ruta absoluta y propietario. Mantener runtime, backend, dependencias JS, HOME, TMPDIR, SQLITE_TMPDIR, SQLite sintética, logs y métricas dentro de ella. No usar `/mnt/ssd`, `/tmp` en RAM ni rutas de aplicaciones.
3. Usar Node **22.23.4 ARMv7** del artefacto oficial fijado y SHA-256 de [la validación anterior](VALIDACION-ARMV7.md). Descargar y verificar en Windows; extraer solo el ejecutable bajo la raíz privada. No actualizar el runtime global ni compilar en Raspberry. Preparar dependencias de producción desde el lockfile mediante `npm ci --omit=dev --ignore-scripts` en un staging nuevo de Windows, sin `.env` ni bases reales; transferir solo runtime/código/dependencias aprobados. Registrar hashes del paquete y commit exacto.
4. `HOST=127.0.0.1`, puerto dedicado aprobado, `NODE_ENV=development` por HTTP loopback cifrado dentro de SSH, `ALLOWED_ORIGINS=http://127.0.0.1:8080`, `DATABASE_PATH` absoluto dentro de la raíz privada, sin diagnósticos públicos. Configurar HOME/TMPDIR/SQLITE_TMPDIR, `UV_THREADPOOL_SIZE=1`, `--max-old-space-size=64`, `ulimit -c 0`, `nice -n 19` y timeout externo de **10 minutos**. No crear unidad ni tarea de arranque. Conservar parámetros scrypt y límites de seguridad; espaciar las pruebas para respetarlos.
5. Bootstrap local por terminal SSH interactiva con el comando Node existente y contraseña oculta, únicamente en esa SQLite nueva. Cuentas y secretos aleatorios exclusivamente sintéticos; no pasarlos por argumentos, URLs, logs, capturas ni Git. Provisionar dirección y dos usuarios con los flujos existentes. No guardar credenciales de piloto en el artefacto público.
6. Abrir `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<puerto-Windows>:127.0.0.1:<puerto-remoto> <destino-autorizado>` en proceso controlado. Servir `dist/` **en Windows**, con API/Socket.IO apuntando al loopback del túnel. No `-g`, listeners LAN, proxy, reglas nuevas ni acceso público. Confirmar con `ss` que Node solo escucha en loopback.
7. Vigilar cada segundo: RSS y CPU acumulada del PID, MemAvailable, swap, temperatura, conexiones y servicios. Abortar si RSS >160 MiB, MemAvailable <192 MiB, temperatura ≥75 °C, presión sostenida o degradación de otro servicio. La vigilancia debe ser externa al proceso Node y matar solo su PID/grupo verificado; `nice` y el límite de heap no limitan por sí solos toda la RAM.
8. Ejecutar el recorrido de tres clientes de Fase 5, revocar y restituir permisos, y mantenerlos al menos **5 minutos** con movimientos espaciados y confirmados. Medir mínimo/mediana/p95/máximo de login, `/health` y solicitud→confirmación; indicar número de muestras y separar RTT a través del túnel del tiempo de scrypt. Registrar CPU usuario/sistema y pared; no confundir un núcleo con el porcentaje total de cuatro núcleos. Comprobar desconexión y reconexión del director con su mismo IndexedDB, rechazos y aislamiento. Comparar servicios con baseline durante y después.
9. Repetir cierre/reapertura de SQLite y reinicio **solo del proceso de piloto** antes del timeout, recuperando autoridad desde el mismo navegador. El backend no respalda posiciones; pérdida del diario/clave local sigue sin recuperación ni transferencia entre dispositivos. Conservar el navegador/origen durante la prueba y eliminar su perfil sintético al finalizar.

### Limpieza obligatoria

El controlador debe instalar `trap`/`finally` **antes de arrancar**: SIGTERM al PID/grupo propio, esperar, SIGKILL solo si no termina; cerrar túnel; recoger exclusivamente métricas saneadas; validar que la ruta real coincide con `/var/tmp/naufragio-pilot.*`, propietario y raíz registrados, y borrar únicamente ese árbol. No usar `pkill node`, reinicios globales, `sudo rm` ni comodines de directorios. Un timeout remoto debe cubrir también la pérdida del controlador SSH. Ante pérdida de conexión, reconectar y verificar PID/ruta antes de limpiar; no declarar limpieza basándose solo en el cierre del cliente Windows.

Verificar después que no queda listener, proceso ni archivo de ese piloto, que el árbol privado no existe y que los servicios mantienen estado/respuestas. Revisar escrituras con traza de archivos si se ejecuta la prueba; no asumir confinamiento únicamente por configurar TMPDIR.

**Limpieza del primer intento bloqueado:** no hubo staging, runtime, SQLite ni proceso de piloto. La limpieza del piloto posterior autorizado se detalla a continuación. Los perfiles/servidores de Windows se cierran en `finally`; los artefactos de frontend generados no se versionan.

## Resultado real del piloto ARMv7 autorizado

### Alcance y artefactos

El usuario autorizó expresamente la excepción temporal, el piloto y su rollback. Se conservó la sesión administrativa durante toda la prueba. El controlador [`pilot-ssh-policy.py`](../backend/scripts/pilot-ssh-policy.py) guardó copia privada, validó el candidato, añadió el `Match User` acordado al final de `sshd_config` y realizó **reload**, sin restart. El preflight devolvió `FORWARDING_PERMITTED_DESTINATION_REFUSED` para el puerto vacío. MariaDB continuó permitida —saludo recibido sin autenticación SQL— y 3401 permaneció denegado.

Runtime **Node 22.23.4 oficial ARMv7**, extraído en Windows tras verificar el SHA-256 ya fijado en VALIDACION-ARMV7. Paquete mínimo de prueba de **39 508 548 bytes**, SHA-256 `d1161b04b6550df769cdbc7767df0ee3c6732d4832f07cb66ebee4b5c46e1bbf`: ejecutable Node, backend ESM, contratos, ajustes públicos, 21 paquetes de producción del lockfile y supervisor. No npm remoto, addons compilados ni instalación global. El paquete incluye los scripts nuevos de este incremento sobre la base versionada `1cd4dd6`; el commit final de este informe versiona esos scripts. No se presenta la prueba como un checkout remoto idéntico a la base sin ellos.

Todo se alojó en una raíz nueva privada `/var/tmp/naufragio-pilot.*`, fuera del SSD de aplicaciones y del tmpfs. Backend ligado **solo a 127.0.0.1:3400**; acceso desde Windows exclusivamente por un túnel SSH ligado a loopback. El frontend `dist/` se sirvió en Windows. SQLite nueva, cuentas y contraseñas sintéticas aleatorias; la fixture privada 0600 estuvo dentro del árbol temporal y nunca se sirvió por HTTP ni se imprimió. No se añadieron endpoints de control al backend: el reinicio se pidió con un marcador dentro del árbol privado por SSH.

[`pilot-server.js`](../backend/scripts/pilot-server.js) utiliza los servicios de autenticación ya existentes para bootstrap y provisión sintética. [`pilot-supervisor.py`](../backend/scripts/pilot-supervisor.py) ejecuta sin privilegios, `nice 19`, heap 64 MiB, `UV_THREADPOOL_SIZE=1`, cores deshabilitados, límite de CPU y deadline de 720 s; vigila externamente RSS, MemAvailable, temperatura, PIDs y respuestas HTTP. Conserva los límites de aplicación predeterminados y los parámetros scrypt. El supervisor se detuvo por petición de limpieza, sin alcanzar el timeout ni disparar guardas.

### Tres clientes y comprobaciones

[`pilot-browser.js`](../backend/scripts/pilot-browser.js) accionó el frontend real con **Edge 156.0.4314.42 / Firefox 142.0.1 / Edge**, en tres contextos independientes, contra Raspberry. No fue una simulación del backend en Windows. Se verificó:

- Login de las tres cuentas; usuario ordinario sin creación de salas ni subida de recursos.
- Invitación de alta, registro ordinario y rechazo de reutilización. Invitaciones nominativas de partida y código independientes.
- Sala del director, asignación de tokens a ambos jugadores, convergencia y rechazo de movimiento de token ajeno.
- Revocación de permiso y rechazo **por el backend** al enviar con otro socket desde el navegador; restitución posterior del permiso. Ese socket de comprobación fue transitorio y se cerró antes de la fase estable.
- Movimiento del director, logout y espera de jugadores, nuevo login y recuperación con IndexedDB, recarga real del director y estado coincidente.
- Reinicio controlado **solo del backend de piloto**, reapertura de la misma SQLite y reconexión automática con prueba criptográfica del director. No se reinició Raspberry ni otro servicio.
- **305,963 s con los tres clientes**, 30 movimientos adicionales espaciados, comprobando igualdad en los tres tras cada confirmación. Versiones finales `[21,11,0,0]` para los cuatro tokens públicos; cero errores de página.

Capturas revisadas visualmente: [director Edge](evidencia-armv7/director-edge.png), [jugador A Firefox](evidencia-armv7/jugador-firefox.png), [jugador B Edge](evidencia-armv7/jugador-edge.png). Son cuentas sintéticas; no contienen invitaciones, contraseñas, sesiones ni claves. Las aserciones de igualdad están en el script y el [resultado JSON](evidencia-armv7/browser-report.json). La interacción está automatizada en motores reales, no se atribuye a una persona una sesión manual que no hizo.

### Latencia por SSH, datos reales

| Operación | Muestras | Mínimo | Mediana | p95 | Máximo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Login HTTP | 7 | 1511,43 ms | **1636,29 ms** | 1724,40 ms | 1724,40 ms |
| `/health` por túnel | 60 | 6,61 ms | **8,23 ms** | 13,88 ms | 15,66 ms |
| Solicitud → primera confirmación observada | 32 | 26,95 ms | **38,11 ms** | 44,29 ms | 67,67 ms |

Login combina tiempos de red del navegador y solicitudes HTTP de comprobación. Movimiento se mide entre frame Socket.IO saliente y la primera confirmación recibida por cualquiera de los tres clientes, después de la aceptación durable del director; no es duración del arrastre ni RTT TCP puro. p95 es rango más próximo sobre estas muestras pequeñas. No se presenta como latencia por Internet, garantía de producción ni benchmark con conexiones masivas.

### Recursos y convivencia

**395 muestras externas durante 445,382 s**, incluyendo bootstrap, comprobaciones, dos generaciones del proceso y fase estable. [Resumen numérico](evidencia-armv7/metrics-summary.json) y [muestras saneadas](evidencia-armv7/samples.jsonl), con generaciones en lugar de PIDs. Reproducir el resumen con `node backend/scripts/pilot-metrics.js docs/evidencia-armv7/samples.jsonl`.

| Medida | Resultado |
| --- | --- |
| Pico RSS del backend | **95,17 MiB** |
| Última RSS muestreada | **68,25 MiB** |
| Mínimo MemAvailable | **458,91 MiB** |
| Temperatura mínima / máxima | **56,920 / 60,686 °C** |
| CPU usuario / sistema, suma de máximos muestreados por PID | **30,72 / 1,11 s** |
| CPU media del backend | **7,15 % de un núcleo**, aproximadamente 1,79 % de capacidad de cuatro núcleos durante la ventana; no utilización global del host. |
| Guardas RSS >160 MiB / MemAvailable <192 MiB / temperatura ≥75 °C | Ninguna activada |
| Estado y PID principal de Apache, MariaDB, SSH y SMB | Idénticos en las **79 comprobaciones**, y al cerrar. |

Las muestras son periódicas, no picos continuos garantizados ni CPU medida después del último muestreo. El muestreo deja de contar procesos al reiniciar y suma cada generación por separado; no suma contadores reiniciados como si fueran monotonales.

| Sonda HTTP local con vhost correcto | Comprobaciones | Código estable | Mediana | p95 | Máximo |
| --- | ---: | --- | ---: | ---: | ---: |
| Heaven's Gate | 79 | **200** | 118,80 ms | 142,49 ms | 156,42 ms |
| Foro | 79 | **200** | 124,84 ms | 154,80 ms | 172,08 ms |
| Servicio proxy existente, raíz | 79 | **404**, igual al baseline | 41,63 ms | 50,38 ms | 57,57 ms |

Se usó HTTPS local con SNI/Host correcto y `curl -k` exclusivamente para disponibilidad, no para validar certificados externos. Heaven's Gate y foro devolvieron 200 también antes/después. El 404 del proxy era su respuesta previa, no prueba funcional completa de esa aplicación. No hubo login ni escritura en estas aplicaciones, no se leyeron sus archivos ni se alteró Apache. Esto acredita disponibilidad anónima y estabilidad de procesos, no todos los flujos internos de las aplicaciones.

### Limpieza y recuperación comprobadas

1. Backend detenido por marcador del supervisor; salida 0, `controller_stop`, servicios sin cambios. Túnel cerrado únicamente por su PID Windows propietario del listener creado.
2. SQLite cerrada/reabierta: `PRAGMA integrity_check` → **ok**, cinco cuentas sintéticas y una sala. Columnas de `rooms`, `room_authority` y `token_assignments` verificadas como metadatos; sin posiciones ni mapas persistidos.
3. Rollback SSH por la sesión conservada: archivo restaurado **byte a byte**, SHA-256 idéntico al original; `sshd -t` válido y reload. Copia privada y controlador eliminados/terminados.
4. Nueva conexión: política efectiva vuelve a `PermitOpen 127.0.0.1:3306`, `AllowTcpForwarding local`, `DisableForwarding no`, `GatewayPorts no`; 3400 vuelve a `administratively prohibited`. Forwarding a MariaDB probado de nuevo sin autenticación SQL.
5. Antes de borrar se comprobó ausencia de listener y procesos de esa raíz. Se eliminó exclusivamente el árbol privado verificado por ruta real, prefijo y propietario. Verificación posterior: raíz y backup SSH inexistentes, ningún Node del piloto ni supervisor/controlador pendiente. Sin listeners Windows 13400/8080. La fixture Windows fue eliminada por `finally`; después de copiar exclusivamente evidencias saneadas se borró el staging Windows completo, incluido runtime, paquete, dependencias, caché y sondas privadas.

No hubo instalación persistente, apertura de puertos, servicios de arranque, cambios en Apache, DNS, UFW, certificados o aplicaciones existentes. La autorización temporal ya está consumida y revertida; no queda abierto el acceso al piloto para futuras sesiones.

### Incidencias y reproducción

- El `tar` POSIX encontrado en PATH interpretó `C:` como un host remoto. Se corrigió usando el `tar.exe` nativo de Windows antes de transferir; el paquete recibido coincidió con su SHA-256.
- Reemplazar el `dist/` existente devolvió `EPERM` al intentar eliminar `app.js` en este entorno Windows. No se cambiaron ACL ni se borró a la fuerza. Se comprobó que sus **16 archivos seguían coincidiendo con el manifiesto** y se generó un `dist/` nuevo en TEMP con la misma lista pública. Ese fue el artefacto utilizado por los tres clientes. No se atribuye una causa de permisos/bloqueo no demostrada.
- Al reiniciar/detener el backend, el túnel registró rechazos TCP transitorios esperables; la recuperación automática pasó y el túnel terminó al limpiar. No se confundieron estos mensajes con un fallo de autorización SSH.
- El cambio fue temporal: un preflight ejecutado ahora volverá a detenerse hasta una nueva autorización, lo cual es el resultado deseado del rollback.

Los cinco scripts están versionados y no contienen destinos privados. Preparar como en la guía anterior un staging nuevo con `src`, `shared`, `public`, `pilot-server.js`, dependencias `npm ci --omit=dev --ignore-scripts`, runtime verificado y `pilot-supervisor.py`. Crear un `probes.json` privado con los campos `label`, `host`, `path`, `expected` de servicios autorizados; no publicarlo. El controlador SSH debe mantenerse abierto mientras dure la excepción, con su timeout y marcador `stop` privado.

Para generar un artefacto nuevo sin reemplazar el anterior, desde la raíz de Windows:

```powershell
$env:PILOT_ARTIFACT_ROOT = Join-Path $env:TEMP 'naufragio-pilot-artefacto-nuevo'
New-Item -ItemType Directory -Path $env:PILOT_ARTIFACT_ROOT -ErrorAction Stop | Out-Null
node --input-type=module -e "import {buildFrontend} from './backend/scripts/build-frontend.js'; await buildFrontend({outputRoot:process.env.PILOT_ARTIFACT_ROOT})"
```

Tras preflight aprobado, staging, arranque del supervisor, túnel y transferencia privada de la fixture, configurar **solo en el proceso local**:

```powershell
$env:PILOT_API = 'http://127.0.0.1:13400'
$env:PILOT_REMOTE_ROOT = '<raíz privada creada en Raspberry>'
$env:PILOT_FIXTURE = '<fixture sintética transferida a TEMP>'
$env:PILOT_DIST_DIR = Join-Path $env:PILOT_ARTIFACT_ROOT 'dist'
$env:PILOT_SSH_TARGET = '<usuario>@<host>'
$env:PILOT_SSH_KEY = '<ruta a la clave local existente>'
$env:BROWSER_TOOLS_DIR = Join-Path $env:TEMP 'naufragio-vtt-browser-tools'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'naufragio-vtt-browser-binaries'
node backend/scripts/pilot-browser.js
```

El cliente usa puerto frontend 8080 y presupone el Origin exacto configurado en el backend. `PILOT_EVIDENCE_DIR` y `PILOT_REPORT` permiten guardar capturas/resultado saneado; no trazas de credenciales. Los marcadores de reinicio/parada se crean mediante la misma identidad SSH. El cliente borra la fixture al finalizar; la limpieza remota y rollback son obligatorios incluso si falla. La guía no es una orden de aplicar otra excepción sin revisión/autorización.

## Pendientes antes de un despliegue permanente

- Acordar cómo habilitar futuros accesos privados por identidad; la excepción temporal ya está revertida. Completar aceptación manual por el operador y pruebas más largas, incluyendo la capacidad objetivo de participantes.
- Ampliar las comprobaciones anónimas de disponibilidad a recorridos funcionales autorizados de Heaven's Gate y otros servicios; fijar cotas operativas a partir de carga sostenida.
- Resolver continuidad del runtime ARMv7 y host a largo plazo; Windows Node 24 no acredita su ejecución en esta Raspberry.
- Definir usuario/directorio de servicio, supervisor y límites, backup/restauración consistente de metadatos y plan de rollback; no confundirlos con respaldo del IndexedDB del director.
- Revisar por separado exposición HTTPS/WSS, orígenes, proxy, certificados y acceso exterior antes de autorizar cualquier cambio. Mapas compartidos, imágenes, dados y herramientas adicionales siguen fuera de este trabajo.

## Versionado y publicación de código

El primer incremento de empaquetado, anterior al piloto ARMv7, se publicó como **`ddd6faf`**, con cierre documental **`1cd4dd6`**. El incremento posterior que contiene este informe incorpora diagnóstico SSH, controladores y evidencias reales; conserva esas bases y las Fases 1–5. Solo se sube `feat/backend-multijugador`: no hay merge con `main`, workflow ni despliegue de Pages. La referencia remota de `main` se compara con la base previa **`37edf0d`** al cerrar la entrega. No se versionan `dist/`, staging, bases, claves, fixtures ni datos privados de conexión.
