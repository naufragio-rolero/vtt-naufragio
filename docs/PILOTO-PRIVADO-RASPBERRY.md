# Validación Windows y preparación del piloto privado

Fecha: **28 de octubre de 2026**. Rama `feat/backend-multijugador`, base `1e0f519` (Fases 1–5 conservadas). Al empezar, árbol limpio. No se implementan funciones de juego nuevas.

## Decisión y estado real

**Windows validado; piloto multijugador ARMv7 bloqueado antes de instalar o arrancar nada. No preparados para un despliegue permanente.**

La Raspberry admite comandos SSH, pero deniega forwarding al destino loopback propuesto. La comprobación `ssh -W 127.0.0.1:3400` respondió `channel 0: open failed: administratively prohibited: open failed` y `stdio forwarding failed`. No es un error de autenticación ni demuestra que el backend falle: la conexión no llega a ese destino. El preflight versionado reproduce el rechazo y termina con salida 1 y `SSH_FORWARDING_DENIED`.

Las instrucciones locales de acceso ya advertían de forwarding limitado al puerto de MariaDB. **No se reutiliza ese puerto ocupado, no se sortea la restricción mediante otro relay y no se cambia la política SSH.** Operaciones debe proporcionar una ruta SSH expresamente autorizada a un puerto loopback dedicado antes de continuar. Este trabajo no autoriza cambios de SSH, Apache, DNS, certificados, firewall ni otros servicios.

## Pruebas Windows

| Ejecución | Resultado observado |
| --- | --- |
| Las 93 pruebas existentes, Node 22.23.4 | **93/93**, 361,694 s, sin fallos, omisiones ni cancelaciones. |
| Las 93 pruebas existentes, Node 24.18.0 | **93/93**, 257,944 s, sin fallos, omisiones ni cancelaciones. |
| Tres pruebas nuevas de empaquetado, Node 22 | **3/3**, 5,025 s. |
| Tres pruebas nuevas de empaquetado, Node 24 | **3/3**, 17,764 s. |
| Integración desde fuentes, Edge y Firefox reales | **Aprobada**, raíz y `/vtt/`, tres clientes independientes. |
| Integración desde `dist/`, Node 24 | **Aprobada**, Edge/Firefox, raíz y `/vtt/`, prefijo Socket.IO `/transport` y modo local sin backend. |

Las 93 pruebas se lanzaron antes de añadir el archivo nuevo de tests. Los tres tests nuevos se ejecutaron aparte con ambos runtimes: cobertura total **96 pruebas**, no se afirma haber medido una única ejecución conjunta de 96. Los tiempos incluyen carga concurrente de Windows y no son un benchmark comparable con Fase 5.

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

**Plan pendiente, no ejecutado ni validado en Raspberry. Detenerse en el preflight actual.** Tras disponer de un túnel aprobado y confirmar servicios saludables:

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

**Limpieza de esta ejecución:** no hubo staging, runtime, SQLite ni proceso de piloto en Raspberry. Los probes SSH terminaron y no quedó listener/túnel creado. Los perfiles/servidores de las pruebas Windows se cierran en `finally`; `dist/` local permanece expresamente como resultado de construcción y no se versiona.

## Pendientes antes de un despliegue permanente

- Resolver el forwarding privado sin debilitar políticas existentes; ejecutar y documentar el piloto real de tres clientes y aceptación manual del operador.
- Obtener baseline funcional de Heaven's Gate, medidas de carga y estabilidad, cotas operativas y resultados de limpieza/recuperación verificables.
- Resolver continuidad del runtime ARMv7 y host a largo plazo; Windows Node 24 no acredita su ejecución en esta Raspberry.
- Definir usuario/directorio de servicio, supervisor y límites, backup/restauración consistente de metadatos y plan de rollback; no confundirlos con respaldo del IndexedDB del director.
- Revisar por separado exposición HTTPS/WSS, orígenes, proxy, certificados y acceso exterior antes de autorizar cualquier cambio. Mapas compartidos, imágenes, dados y herramientas adicionales siguen fuera de este trabajo.

## Versionado y publicación de código

Solo se sube `feat/backend-multijugador`; no hay merge con `main`, workflow ni despliegue de Pages. Estado remoto y commit de entrega: se registran tras comprobar el push. La referencia remota de `main` se compara antes/después sin modificarla.
