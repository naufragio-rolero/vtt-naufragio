# Fase 8 — instalación privada supervisada en Raspberry

Fecha: **31 de octubre de 2026**. Repositorio `naufragio-rolero/vtt-naufragio`, rama `feat/backend-multijugador`.

## Veredicto: APTO CON LIMITACIONES

**Backend privado instalado y probado en ARMv7, con unidad independiente detenida y deshabilitada al finalizar.** No hay proceso Node ni listener 3400. La instalación está preparada para el siguiente paso, con código/runtime propios, usuario bloqueado sin privilegios, configuración de producción privada y SQLite/backup en SSD.

La limitación principal sigue siendo la ausencia de contención de memoria por el kernel. Se utiliza supervisión externa con umbrales fijos, watchdog de systemd y cierre del backend ante fallo del supervisor. Se han comprobado fallo, bloqueo y cierre normal. **No se autoriza con este veredicto publicación, arranque automático, actividad indefinida ni proxy público.** La unidad tiene una ventana privada máxima de 900 s por arranque.

## 1. Git y alcance conservado

Se comprobó HEAD `a77a90970f068a56800885d2f07ee6b964d5d4d2` en la rama indicada. Se versionaron **únicamente el informe y las evidencias pendientes de Fase 7**, 41 archivos, en **`fb6b0a1d03c5ce388eeb06d6ab82f535a4ed26f2`**, mensaje `docs: record phase 7 ARMv7 pilot`. Los cambios ajenos de documentación/Fase 6 quedaron fuera. No hubo push ni merge a main.

La aplicación instalada parte de ese commit, que solo añade documentación a la aplicación validada. Los cambios nuevos F8 se limitan a las plantillas y al supervisor en `backend/deploy/`, más este informe y sus evidencias. **24 módulos de aplicación, cliente, contratos y configuración pública coinciden por hash con el commit**; no se cambió la aplicación para mejorar resultados de rendimiento. [Atestación final](evidencia-fase8/final-installation.json), [hashes](evidencia-fase8/file-hashes.json).

No se repitieron suites Windows, aceptación gráfica de F7 ni su prueba de cinco minutos. Se ejecutaron las comprobaciones nuevas que dependen de la instalación real, del aislamiento, de SSD y del supervisor. Los intentos fallidos de diagnóstico se conservan y no se mezclan con la medición funcional válida.

## 2. Antes de escribir: baseline y rollback

SSH funcionaba; sudo había caducado. Se esperó a que el propietario ejecutase `sudo -v` interactivamente y se comprobó `sudo -n true`. No se solicitó contraseña por chat ni se cambió sudoers.

[Baseline previo a toda escritura remota](evidencia-fase8/baseline.json), **16:27:57 UTC / 17:27:57 Europe/Madrid**:

- MemAvailable **520,79 MiB**, temperatura **59,07 °C**, sin listener 3400.
- SSD `/dev/sdb1`, ext4, `/mnt/ssd`, montado `rw,noatime`, con aproximadamente 82,55 GiB libres.
- Cuenta, grupo, unidad y las tres raíces nuevas ausentes. No se sobrescribió instalación previa.
- Seis sitios más API disponibles con TLS normal, códigos esperados y mismo baseline de cuatro servicios de sistema.
- Huella agregada de **298 archivos de configuración compartida** de Apache, renovaciones, SSH, UFW, resolución y arranque; huellas de las cuentas ajenas excluyendo únicamente la nueva entrada autorizada VTT.
- [Plan de rollback](evidencia-fase8/rollback-plan.json) y [script acotado](evidencia-fase8/rollback-phase8.py) preparados antes del primer staging remoto. Ante fallo, el controlador detuvo/deshabilitó exclusivamente VTT, sin actuar sobre otros servicios.

Se eligió `/mnt/ssd/naufragio-vtt` porque `/mnt/ssd/services` no existía: así no se creó ni se cambió un directorio genérico compartido. La alta del usuario/grupo utilizó la herramienta estándar del sistema, añadiendo únicamente su identidad; las entradas ajenas de passwd/group/shadow/gshadow se conservaron por hash.

## 3. Instalación exacta y recursos creados

| Recurso | Estado y permisos |
| --- | --- |
| Usuario/grupo `naufragio-vtt` | UID **997**, GID **980**; único grupo 980, contraseña bloqueada, shell `/usr/sbin/nologin`, HOME `/nonexistent` sin crearlo |
| `/opt/naufragio-vtt/runtime/bin/node` | Node **22.23.4 ARMv7**, root:root, **0555**, 107.563.500 bytes |
| `/opt/naufragio-vtt/releases/fb6b0a1-f8/backend/` | Aplicación y 21 dependencias de producción; root:root, archivos 0444 y directorios 0555 |
| `/opt/naufragio-vtt/current` | Enlace propio al release anterior, no escribible por el servicio |
| `/opt/naufragio-vtt/deployment-manifest.json` | Manifiesto root 0600 con hashes de fuentes y overlays finales |
| `/opt/naufragio-vtt/rollback-phase8.py` | Rollback propio, root 0600; no ejecutado tras la aceptación |
| `/etc/naufragio-vtt/` | Directorio propio root:grupo VTT, 0750 |
| `/etc/naufragio-vtt/backend.env` | Producción, root:root **0600**; no se conserva su contenido privado en Git |
| `/etc/naufragio-vtt/probes.json` | Sondas de seis sitios más API; root:grupo VTT, 0640 |
| `/mnt/ssd/naufragio-vtt/` | Raíz SSD propia root:grupo VTT, 0750 |
| `data/` y `backups/` bajo esa raíz | Usuario VTT, 0700 |
| `data/naufragio.sqlite` | **Vacía de cuentas y salas**, esquema 4, integridad ok, usuario VTT **0600**, 163.840 bytes |
| `backups/initial-empty.sqlite` | Backup consistente de la base vacía, integridad ok, usuario VTT **0600**, 163.840 bytes |
| `/etc/systemd/system/naufragio-vtt.service` | Unidad propia root 0644, **inactive / disabled**, sin enable |

Archivo oficial SHA-256 **`c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437`**, cotejado contra `SHASUMS256.txt` de Node y el valor previamente validado. Ejecutable cotejado también en Raspberry: **`407b390f1667066e55cb36c8622e79d6d488aed417d072487bfbe92f47829d6b`**. Paquete recibido y verificado antes de extraer: 40,091,657 bytes, SHA-256 `49761cef5b4ed585f671c2971e5dc006fd37e4d481597470caa879d2da0f957c`. [Artefactos](evidencia-fase8/artifacts.json).

Las dependencias se prepararon en Windows con `npm ci --omit=dev --ignore-scripts`; no hubo npm, compilación ni instalación global remota. Los diagnósticos usaron nueve dependencias de cliente aparte, eliminadas con su directorio de validación. Los cambios posteriores al paquete afectan solo al diagnóstico y al cierre del supervisor; los hashes finales se atestan separadamente en el manifiesto.

Configuración pública del perfil privado: `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3400`, origen permitido `https://naufragio-rolero.github.io`, SQLite en la ruta anterior, máximo Socket.IO 65536 bytes, JSON 16384, HTTP 600/minuto/IP y límites de invitados originales. **`TRUST_PROXY_LOOPBACK=false`** durante esta preparación; hay un secreto reservado privado, sin activar su uso ni incluirlo en evidencias.

Se reutilizaron y ajustaron [unidad](../backend/deploy/naufragio-vtt.service) y [entorno de ejemplo](../backend/deploy/backend.env.example). **`systemd-analyze verify --man=no` pasó con exit 0**, con ejecutable y rutas reales presentes. [Instalación](evidencia-fase8/installation.json).

## 4. Protección provisional y fallo seguro

El [supervisor externo](../backend/deploy/supervisor.py) es el proceso principal de la unidad y crea el proceso Node. No necesita sudo y no escribe ni reinicia servicios ajenos.

- Parada si **RSS Node + supervisor >160 MiB**, **MemAvailable <192 MiB**, **temperatura ≥75 °C**, salida del backend, fallo de sondeo o cambio de estado/PID de servicios. Se exige MemAvailable inicial ≥384 MiB. El umbral RSS mantiene 160 MiB e incluye además Python; no se elevó para superar pruebas.
- Sondas HTTPS con validación de certificado/hostname, una por iteración rotando entre seis sitios más API; cada `curl` tiene límite de 2 s y cada subproceso timeout de 3 s. Parada por latencia superior a `max(1 s, 5 × baseline propio de esa sonda)`. Se comprueban los cuatro servicios cada cinco iteraciones.
- `Type=notify`, `NotifyAccess=main`, **WatchdogSec=10**, **WatchdogSignal=SIGKILL**, **KillMode=control-group**, **Restart=no**. Node no recibe el socket de notificación: solo Python puede mantener el latido.
- Node configura señal de muerte al padre mediante `prctl(PR_SET_PDEATHSIG, SIGKILL)` y comprueba la carrera de muerte previa al exec. Si Python muere, el hijo no queda huérfano ejecutándose; si Python se bloquea, systemd fuerza la terminación del grupo.
- Heap 64 MiB, `UV_THREADPOOL_SIZE=1`, CPUQuota 100 % de un núcleo, Nice 10, TasksMax 32, LimitNOFILE 1024, core dumps deshabilitados. Ventana privada máxima 900 s por arranque; después VTT se detiene. No se dejó actividad indefinida.
- NoNewPrivileges, capacidades vacías, ProtectSystem=strict, ProtectHome, PrivateTmp y restricciones de familias de direcciones de la plantilla. Escritura del servicio limitada a `data/`; backups se hacen como operación separada del mismo usuario.

[Fallo seguro real](evidencia-fase8/fail-safe.json): matar el supervisor con SIGKILL dejó la unidad failed/signal, sin listener en **1,841 s** observados; bloquearlo con SIGSTOP produjo failed/watchdog, sin listener en **12,079 s** observados. Los tiempos incluyen envío y comprobaciones SSH; watchdog configurado a 10 s, no una promesa de detección instantánea. No se reinició automáticamente. Se observaron cierres del backend; la configuración de systemd y la señal de muerte al padre son defensas complementarias, no mediciones aisladas de cada mecanismo.

Después de corregir una carrera de cierre se comprobaron **dos paradas normales con Result=success**, MainPID=0 y ausencia de listener. [Cierre normal](evidencia-fase8/normal-shutdown.json). No se provocó presión de memoria/temperatura ni se ensayó esperar al deadline completo.

**No hay límite duro de memoria del kernel:** se verificó `MemoryHigh=infinity` y `MemoryMax=infinity`. El supervisor solo mide RSS de Node y Python, no toda la memoria imputable a un cgroup ni los picos instantáneos de cada helper. El muestreo y la parada ordenada tienen una ventana de reacción; watchdog limita el bloqueo del monitor. Esta protección provisional requiere supervisión operativa y no equivale a memcg.

## 5. Pruebas privadas ejecutadas

Se ejecutaron **cuatro clientes lógicos Socket.IO en Raspberry**, cada uno autenticado por separado: director y tres invitados, con un invitado por polling y los demás por WebSocket. Todos accedieron directamente a loopback. **No se creó túnel ni se cambió SSH**; los comandos de diagnóstico se ejecutaron por SSH normal. No se atribuye esta prueba a navegadores o móviles físicos: la aceptación gráfica de F7 ya estaba superada y no se repitió.

[Resultado funcional válido](evidencia-fase8/acceptance.json): **pass**.

| Comprobación | Resultado real |
| --- | --- |
| Identidad y aislamiento | UID de Node = 997, CapEff=0 y NoNewPrivs=1; listener exclusivamente `127.0.0.1:3400` |
| Filesystem efectivo dentro del namespace | Datos escribibles; código, configuración y backups no escribibles por el proceso de servicio |
| Autenticación y QR | Login sintético, tres solicitudes/aprobaciones/claims; claim previo a aprobación rechazado; invitados sin crear salas |
| Permisos y movimiento | Asignar token no concede movimiento; denegación por defecto, concesión, convergencia y denegación tras revocar |
| SQLite | Creación esquema 0→4 en datos; fixture separada 3→4 en SSD; reapertura y autoridad persistente tras restart |
| PNG 12 MiB a tres jugadores | **72.715,02 ms**, 12.582.912 bytes y SHA-256 correcto en los tres receptores |
| Reconexión de receptor | Recurso vuelto a recibir y hash correcto |
| Reinicio exclusivo de VTT | Cuatro clientes recuperan autoridad/revisión; mapa redistribuido con integridad correcta |
| Revocación | QR revocado devuelve 410; retirar acceso desconecta e invalida sesión, `/auth/me` 401 |
| Backup consistente en vivo | Integridad **ok**, claves foráneas 0, esquema 4, cuatro salas sintéticas incluidas |
| Restauración de ensayo | Nueva copia privada en SSD, apertura con código real y login del director restaurado; sin exponer otro puerto |

PNG SHA-256 `be2c53c7c34f609ec6d1a59a2e3f7627f336b1504220c59f12cd83ec25f1d7e6`, generado con el diagnóstico existente, RGBA de 1740 × 1740 y bloque auxiliar para alcanzar exactamente 12 MiB. Se verificaron bytes/hashes con clientes de protocolo; **la decodificación visual no se volvió a medir en F8**. [Diagnóstico](evidencia-fase8/validate-installed.mjs), [backup/restauración](evidencia-fase8/backup-restore.json), [migración](evidencia-fase8/provision-migration.json), [aislamiento](evidencia-fase8/isolation.json).

El backup probado no se obtuvo copiando la SQLite viva: se utilizó la API online `node:sqlite.backup` del script existente. La restauración se ensayó **offline** contra el servicio de autenticación real, sin sustituir la base activa ni abrir un backend paralelo.

## 6. Recursos y disponibilidad

[Métricas](evidencia-fase8/metrics-summary.json), [muestras](evidencia-fase8/samples.jsonl). La ventana funcional válida comprende las generaciones **7 y 8**, identificadas antes de las comprobaciones finales de cierre. Se conservan por separado los intentos incompletos y las pruebas de fallo seguro; no se presentan como aceptaciones superadas.

| Medida funcional | Resultado |
| --- | --- |
| Muestras / suma de ventanas muestreadas | 153 / **201,14 s** |
| RSS máximo de Node | **96,49 MiB** |
| RSS máximo de Python | **18,76 MiB** |
| RSS máximo simultáneo Node + Python | **115,20 MiB**, por debajo de 160 MiB |
| MemAvailable mínimo del host | **332,23 MiB**, por encima de 192 MiB |
| Temperatura máxima | **68,76 °C**, por debajo de 75 °C |
| CPU Node usuario / sistema | 48,41 / 3,34 s |
| CPU Node media sobre las ventanas muestreadas | **25,73 % de un núcleo** |
| Vigilancia de cuatro servicios | 31 comprobaciones, todas sin cambios |
| Cliente diagnóstico local, pico RSS | **254,48 MiB**, fuera del proceso backend y de la suma Node-servidor + Python |
| `/health` local durante el recorrido | 84 muestras; mediana 87,38 ms, máximo 183,47 ms |

La CPU anterior corresponde a **Node servidor**, no incluye la CPU de Python, curl ni los clientes locales. La media divide contadores máximos muestreados por generación entre la suma de sus ventanas; no incluye el intervalo sin backend durante restart ni es utilización global del host. Los clientes de aceptación también consumieron RAM/CPU de la Raspberry; F7 los ejecutó en Windows. Por ello **72,72 s aquí frente a 49,92 s en F7 no es una comparación A/B**: cambian ubicación de clientes, polling, cuota CPU y coste de sondas TLS.

| Sonda HTTPS normal dentro de la unidad | Muestras | Código | Mediana / p95 / máximo |
| --- | ---: | --- | --- |
| api | 21 | 403 | 209,28 / 247,41 / 265,50 ms |
| bibprof | 22 | 200 | 263,40 / 327,66 / 328,85 ms |
| forum | 22 | 200 | 251,33 / 406,27 / 471,18 ms |
| gallery | 22 | 200 | 149,99 / 217,02 / 278,93 ms |
| heavensgate | 22 | 200 | 251,55 / 325,19 / 332,93 ms |
| ordenanthia | 22 | 200 | 159,59 / 206,57 / 242,04 ms |
| proxy | 22 | 404 | 155,53 / 198,78 / 236,70 ms |

No hubo cambio de código, timeout ni parada por guardas durante el recorrido válido. **No se afirma ausencia absoluta de aumento de latencia**: Heaven's Gate pasó de 186,102 ms en la sonda inicial externa a la unidad a mediana 251,547 ms en el monitor durante carga; su máximo fue 332,934 ms. Las sondas bajo cuota CPU y carga local tienen costes distintos. No se superó el criterio de regresión configurado. Las comprobaciones son anónimas y no cubren todos los flujos internos de las otras aplicaciones.

[Ronda final](evidencia-fase8/final-host.json): seis sitios más API con TLS válido y códigos esperados; Apache, MariaDB, SSH y SMB activos con los mismos PIDs principales. **Las 298 configuraciones compartidas, entradas de cuentas ajenas y conjunto completo de listeners coinciden por hash con el baseline.** No se modificaron sus archivos ni permisos. Solo se añadió la identidad VTT autorizada y sus recursos.

## 7. Argumento de memoria: origen investigado solo en lectura

Se confirma `CONFIG_MEMCG=y` pero `/proc/cmdline` contiene **`cgroup_disable=memory`** y los controladores disponibles siguen siendo `cpuset cpu io pids`. El argumento también figura en `/sys/firmware/devicetree/base/chosen/bootargs`. El kernel indica `CONFIG_CMDLINE_FROM_BOOTLOADER=y`; la cadena compilada `CONFIG_CMDLINE` **no contiene** esa opción, y ni FORCE ni EXTEND están habilitados.

Esto identifica la **fuente inmediata entregada al kernel: los argumentos de arranque de firmware/bootloader reflejados en el árbol de dispositivo**, no la cadena compilada del kernel. **No se ha demostrado qué archivo persistente, configuración anterior o paso concreto del arranque añadió `cgroup_disable=memory`.** Los `cmdline.txt` y `config.txt` actuales consultados en `/boot` y `/boot/firmware` no lo contienen ni seleccionan un cmdline alternativo; las otras fuentes estándar consultadas se enumeran en `bootInvestigation` del baseline. No se atribuye origen exacto a un archivo que no lo muestra.

No se modificaron firmware, kernel, arranque ni controladores de memoria. No se reinició Raspberry. La [investigación y alternativas de F7](PILOTO-FASE7-RASPBERRY.md) conservan sus límites: habilitar memcg requiere identificar el origen efectivo y una futura ventana autorizada de reinicio; `LimitRSS` no limita RSS en Linux y `LimitAS` limita espacio virtual, con riesgo de romper V8. La supervisión aquí validada es provisional y no convierte `MemoryMax`/`MemoryHigh` en efectivos.

## 8. Incidencias y correcciones

1. **Controlador:** `reset-failed` sobre una unidad nueva descargada por systemd devolvió «unit not loaded»; el trabajo se reanudó iniciando directamente la unidad. No fue fallo de aplicación ni se reinstaló el usuario/base.
2. **Diagnóstico de procesos:** este entorno no ofreció el archivo `/proc/PID/task/PID/children` esperado; se identificó el hijo por PPid en `/proc/PID/stat`, conservando verificación de UID/capacidades/namespace. La unidad se había detenido en finally.
3. **Cliente de aceptación:** las peticiones prohibidas desconectan deliberadamente el socket. El primer diagnóstico lo reutilizaba; otro intento reconectaba antes de recibir el cierre efectivo. Se corrigió esperando la desconexión y el vaciado de la cola antes de reconectar. Una transferencia incompleta por ese cliente fuera de sesión agotó su espera; no fue presión de recursos. [Intentos 1](evidencia-fase8/acceptance-attempt-1.json), [2](evidencia-fase8/acceptance-attempt-2.json) y [3](evidencia-fase8/acceptance-attempt-3.json) conservados; después pasó el recorrido completo. No se cambió la política del backend ni los umbrales.
4. **Supervisor nuevo, corregido:** en un stop explícito, KillMode también terminó una sonda activa y su CalledProcessError marcó failed pese a cerrar Node. Ahora solo se trata como cierre normal la sonda terminada por SIGTERM/SIGKILL, la desaparición esperada del hijo o BACKEND_EXITED durante stop. Fallos de red, recursos, estado o latencia siguen siendo errores. Se verificaron dos cierres normales tras la corrección; no se repitieron mapas ni suites por este cambio de cierre.
5. **Limpieza conservadora:** primero se rechazó limpiar en estado failed; tras corregir el cierre y verificar inactive se continuó. Otro guard encontró WAL/SHM auxiliares del backup sintético. Se comprobaron nombres exactos, propietario y ausencia de procesos, y se retiraron únicamente esos archivos y el resto de fixtures VTT. No se eliminaron datos ajenos.

[Journal de la unidad](evidencia-fase8/unit-journal.txt), con el aviso experimental esperado de SQLite en Node 22. Las métricas guardan generaciones en lugar de PIDs; no se incluyen contraseñas, sesiones, capacidades QR ni el secreto de proxy.

## 9. Estado final y recuperación

**Unidad `inactive`, `disabled`; cero procesos VTT/Node; cero listener 3400; directorios temporales remotos y PrivateTmp propios eliminados.** [Estado de instalación](evidencia-fase8/final-installation.json).

Se eliminaron directorio de validación, dependencias de cliente, credenciales sintéticas, clave del director de ensayo, bases de migración/restauración, backup con cuentas de prueba y SQLite de prueba. **Solo se conservan base vacía esquema 4 y su backup inicial**, más runtime, release, configuración privada, unidad y manifiesto necesarios para el siguiente paso. Ambas bases tienen integridad ok y cero cuentas/salas. [Retención](evidencia-fase8/data-retention.json).

No se creó una cuenta de administrador real ni se conserva una contraseña de ensayo para entrar. El propietario deberá provisionar su administrador interactivamente antes del uso privado real, con la unidad parada; por ejemplo, desde terminal SSH con TTY:

```bash
sudo runuser -u naufragio-vtt -- env \
  NODE_ENV=production ALLOWED_ORIGINS=https://naufragio-rolero.github.io \
  DATABASE_PATH=/mnt/ssd/naufragio-vtt/data/naufragio.sqlite UV_THREADPOOL_SIZE=1 \
  /opt/naufragio-vtt/runtime/bin/node \
  /opt/naufragio-vtt/current/backend/scripts/bootstrap-admin.js
```

Las credenciales se introducen solo en esa terminal, nunca por chat ni por variables de entorno. Se usa el usuario del servicio para no crear SQLite/WAL con propietario root. La CLI no requiere leer el `backend.env` privado para esta operación offline: se indican únicamente las variables no secretas necesarias.

Para una sesión privada posterior autorizada: `sudo systemctl start naufragio-vtt`; comprobar `systemctl status`, journal y loopback; detener con `sudo systemctl stop naufragio-vtt`. No usar `enable`. Si un arranque falla, corregir su causa antes de reintentar; no subir los umbrales ni reiniciar otros servicios.

Backup manual consistente: ejecutar como usuario VTT el script `backend/scripts/database-backup.js` del release, con origen actual y **destino nuevo** bajo backups. Para recuperar: parar solo VTT, verificar que no quedan procesos/listener, validar integridad/claves foráneas del backup y restaurar a una ubicación privada nueva evitando mezclar WAL/SHM antiguos. Conservar el conjunto anterior para diagnóstico y cambiar solo la configuración VTT hacia la copia verificada. No copiar la SQLite viva como sustituto de la API de backup.

Rollback completo propio: `sudo python3 /opt/naufragio-vtt/rollback-phase8.py`. Detiene/deshabilita únicamente VTT, verifica puerto cerrado, retira su unidad, recarga las definiciones de systemd y elimina sus tres raíces y usuario/grupo exclusivos. **Elimina los datos VTT:** si en el futuro contienen partidas/identidades reales, preservar antes sus backups y obtener la autorización pertinente. No revierte ni toca Apache/SSH/certificados. No se ejecutó tras esta aceptación porque la meta era conservar la instalación privada.

La copia local con runtime, paquete, dependencias y caché se eliminó tras verificar su ruta y ausencia de procesos propios. [Limpieza local](evidencia-fase8/windows-cleanup.json). No se cerró la terminal del propietario ni sesiones ajenas.

## 10. Autorizaciones posteriores para HTTPS/WSS público

1. Decidir operación y contención de memoria permanentes, política de reinicios, ventana de supervisión y backups. Activar memcg o cambiar arranque/kernel/reiniciar Raspberry requiere autorización nueva; no se ha hecho.
2. Autorizar cambios concretos en el vhost HTTPS API y su include secreto; conservar HTTP-01, certificados y otros vhosts. Preparar copia/rollback, configtest y únicamente reload de Apache. No se necesita publicar 3400.
3. Cambiar solo el perfil VTT a `TRUST_PROXY_LOOPBACK=true` y coordinar el secreto con Apache; validar saneamiento de cabeceras y atribución de IP reales. El perfil directo actual no equivale a una validación de proxy.
4. Autorizar la publicación del frontend/configuración HTTPS en Pages u otro alojamiento, por separado. Verificar desde red externa HTTPS, WSS y polling, QR y móviles físicos; no atribuir estos resultados a los clientes loopback de esta fase.
5. Autorizar por separado `enable` y automatización de backups cuando se acepte la operación permanente. **Ninguno está habilitado.**

No se modificaron Apache, certificados/Certbot, DNS, SSH, firewall, router, firmware, kernel o arranque; no hubo reinicio Raspberry, publicación Pages ni servicios adicionales fuera del VTT. La instalación privada queda preparada, detenida y pendiente de esas decisiones.
