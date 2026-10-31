# Fase 9 — partida privada y activación HTTPS/WSS

Fecha: 2026-10-31. Rama: `feat/backend-multijugador`.

> Plan histórico. La autorización posterior A+B+C y el requisito de tres horas consecutivas sustituyen los bloques de 50 minutos de este documento. La ejecución y sus resultados se registran en [Fase 9 — beta remota](FASE9-BETA-REMOTA-RASPBERRY.md). La intervención M sigue sin autorizarse.

**Recomendación: beta privada supervisada, APTO CON LIMITACIONES.** La instalación y aceptación de [Fase 8](FASE8-DESPLIEGUE-RASPBERRY.md) quedan cerradas; no se repitieron suites. La operación permanente con contención de memoria es viable como intervención propuesta, pero **no está validada ni autorizada**. Ninguna autorización de este plan se considera concedida por su publicación.

## 1. Estado y hallazgo de arranque

Lectura actual por SSH: unidad `inactive/dead`, `disabled`, sin listener 3400. No se arrancó VTT ni se cambiaron servicios, SSH, Apache, DNS, certificados, kernel, arranque o Pages. Sudo no estaba disponible; no se cambiaron privilegios para investigar. Evidencias: [lectura](evidencia-fase9/boot-readonly.json) y [corroboración independiente con dtc](evidencia-fase9/boot-corroboration.json).

| Elemento | Resultado observado |
| --- | --- |
| Equipo | Raspberry Pi 3 B+, ARMv7; kernel `6.18.50+rpt-rpi-v7` |
| Raíz efectiva | microSD `/dev/mmcblk0p2`, PARTUUID `c8bcfc97-02`, coincide con `root=` |
| FAT de arranque montada | microSD `/dev/mmcblk0p1`, PARTUUID `c8bcfc97-01`, `/boot/firmware`; única partición FAT de esa tarjeta |
| Bootloader, árbol vivo | `boot-mode=1` (SD), `partition=0` (selección predeterminada), `tryboot=0`; `os_prefix` vacío |
| Firmware activo | `a86983925695a7e63166327d7c002d64040ed31d`, 2026-09-14; opciones activas consultadas con `vcgencmd` |
| Configuración actual | `config.txt` sin selección alternativa de cmdline/DTB ni includes; audio y overlay KMS; `/boot/config.txt` y `/boot/cmdline.txt` son avisos de traslado |
| Memoria | `CONFIG_MEMCG=y`, v1 deshabilitado; controladores efectivos `cpuset cpu io pids`, sin `memory` |

**Fuente persistente localizada:** `/boot/firmware/bcm2710-rpi-3-b-plus.dtb`, propiedad `/chosen/bootargs`, contiene `cgroup_disable=memory`. SHA-256: `d41256bdc25b09dbba0bcdb27592560561d39752ebb09c64e82a449e3271807d`. La decodificación binaria y `dtc` coinciden. Una copia bajo `/usr/lib/linux-image-6.18.50+rpt-rpi-v8/broadcom/` tiene idéntico hash; `dpkg-query -S` no identifica propietario para esas rutas: no se atribuye su instalación a un paquete concreto.

Esto explica que el argumento exista en el árbol vivo y `/proc/cmdline`, pero no en el `cmdline.txt` actual: los argumentos también proceden del DTB base. La fuente oficial [bcm270x.dtsi](https://raw.githubusercontent.com/raspberrypi/linux/rpi-6.18.y/arch/arm/boot/dts/broadcom/bcm270x.dtsi) define esa opción. La [documentación del cargador](https://www.raspberrypi.com/documentation/computers/configuration.html#using-device-trees-on-raspberry-pi) describe la selección automática del DTB según placa; la [configuración de arranque](https://www.raspberrypi.com/documentation/computers/config_txt.html#boot_partition) describe la selección predeterminada de FAT.

**Límite de la demostración:** SD, FAT predeterminada, modelo y configuración son coherentes con ese DTB. No hay registro accesible que certifique el nombre y bytes exactos cargados en el último arranque: `vclog --msg` denegó acceso. No se certifica que todos los archivos actuales sean idénticos a los de entonces, ni se identifica quién instaló el DTB. Sí queda demostrada una fuente persistente actual del argumento; no se atribuye a una edición oculta de `cmdline.txt` ni a otra configuración sin evidencia. Esta limitación no bloquea la beta ni abre otra cadena de auditorías.

## 2. Alternativa A: beta supervisada por bloques

**Autorización A — recursos VTT y partidas reales, sin reinicio ni arranque automático.** Preparar credenciales reales y permitir arranques manuales exclusivamente durante ventanas atendidas. Para participantes remotos requiere también B y un frontend compatible de C; el loopback actual no es accesible desde sus navegadores y el forwarding SSH 3400 sigue denegado.

1. Con VTT parado, copia consistente nueva de SQLite, conservar configuración privada y provisionar administrador mediante la CLI interactiva de F8; crear director y participantes autorizados. Contraseñas solo en terminal/UI. Base actual vacía: no hay credenciales de ensayo reutilizables.
2. En configuración exclusivamente VTT: `SUPERVISOR_MAX_SECONDS=3600`, `SESSION_TTL_SECONDS=3600`, `GUEST_SESSION_TTL_SECONDS=3600`. Supervisor actual admite **como máximo 3600 s**, con valor instalado de 900 s: una partida continua de varias horas necesitaría otro cambio autorizado. No se modifican las guardas de seguridad.
3. Política: bloques de **50 minutos de juego**; aviso al minuto 45, guardar al 50, cierre manual antes del 55; parada automática como máximo a los 60 minutos desde inicio del supervisor. Antes de cada bloque: operador presente, login nuevo y accesos QR nuevos/aprobados. Revocar invitados al terminar. Para una tarde larga, pausas y reautenticación entre bloques, sin bucle de reinicios.
4. Antes de abrir: MemAvailable ≥384 MiB y servicios/sondas sanos. Mantener parada por RSS conjunto Node+Python >160 MiB, MemAvailable <192 MiB, temperatura ≥75 °C, fallo de servicios/HTTPS o regresión de latencia >máximo(1 s, 5×baseline). Mantener heap 64 MiB, cuota CPU, `Restart=no`, watchdog 10 s, señal de muerte del padre y `KillMode=control-group` ya probados. Si hay alarma, detener solo VTT y diagnosticar antes de autorizar otro bloque; no elevar umbrales.
5. Operador observa journal/métricas y puede ejecutar `sudo systemctl stop naufragio-vtt`; al ausentarse detiene la sesión. Cerrar verificando unidad inactiva, deshabilitada y puerto vacío; backup consistente nuevo. No usar `enable`.

No hay contención dura: un pico entre muestras todavía puede afectar al host. F8 midió RSS conjunto máximo **115,20 MiB**, MemAvailable mínimo **332,23 MiB** y **68,76 °C**, con transferencia de 12 MiB a tres jugadores en **72,72 s**. Son evidencia de aceptación, no garantía para cualquier duración/carga.

**Conservación de partida:** SQLite conserva identidades/permisos; no sustituye la persistencia del tablero/mapas del director en IndexedDB. Usar perfil persistente del navegador, guardar la mesa y conservar/exportar sus recursos antes de cerrar; tras reiniciar servidor, el director debe reconectar y republicar el estado. No prometer recuperación completa solo con backup SQLite.

## 3. Alternativa B de operación: servicio permanente con memcg

**Autorización M independiente — cambio de arranque y reinicio de toda Raspberry en ventana acordada.** No es requisito para la alternativa A ni está ejecutada.

La capacidad está compilada. El [código Raspberry Pi de cgroup](https://raw.githubusercontent.com/raspberrypi/linux/rpi-6.18.y/kernel/cgroup/cgroup.c) admite `cgroup_enable=memory`; propuesta mínima: añadirlo al final de la línea única de `/boot/firmware/cmdline.txt`, después de los argumentos base del DTB, sin editar DTB, kernel ni firmware. Es una vía técnicamente sustentada; su efecto en este binario concreto debe confirmarse después del reinicio. La presencia residual de `cgroup_disable=memory` no basta para decidir el resultado: comprobar controlador y archivos efectivos.

1. Copia byte a byte y hash del cmdline; backup VTT; operador con recuperación local y acceso físico a la microSD. Acordar interrupción de Heaven's Gate y los demás servicios. VTT permanece deshabilitado.
2. Cambio mínimo autorizado y un reinicio controlado. Comprobar `memory` en cgroup v2 y salud de los servicios. Si falta, no declarar protección ni seguir arrancando VTT como permanente.
3. Proponer un drop-in exclusivo VTT: `MemoryAccounting=yes`, `MemoryHigh=160M`, `MemoryMax=192M`, `MemorySwapMax=0`, `OOMPolicy=stop`. Conservar la guarda RSS de 160 MiB y watchdog; no son magnitudes equivalentes: memcg también contabiliza otras páginas y auxiliares de la unidad. Verificar archivos `memory.high`, `memory.max`, `memory.swap.max` del cgroup real y una prueba pequeña en un cgroup de ensayo exclusivo, sin forzar OOM global. No repetir suites completas ni aumentar límites para superar fallos.
4. Para 24/7, el supervisor necesita un modo continuo explícito, distinto del límite actual de una hora, y pruebas focalizadas de parada segura. Autorizar por separado ese cambio, retención de métricas/backups, alertas y finalmente `enable`; mantener reinicio manual inicialmente. No basta quitar el plazo mediante una variable que el código rechaza.

Ventajas: límite del kernel y contabilidad de toda la unidad. Riesgos: sobrecoste global de memcg en una Pi de 1 GiB, presión/OOM dentro de VTT y caída de partida, además de la interrupción común del reinicio. Rollback: restaurar el cmdline exacto desde terminal o microSD, retirar solo el drop-in VTT y reiniciar otra vez con autorización; conservar datos. No usar `LimitRSS` (sin contención RSS en Linux), `LimitAS` ni solo el heap de V8 como sustitutos de memcg.

## 4. HTTPS/WSS: ejecución posterior en dos autorizaciones

**Autorización B — activar exclusivamente proxy del vhost HTTPS `api.naufragio.net` y perfil privado VTT.** Hace accesible el endpoint por Internet; la beta será privada por autenticación/invitación, no por aislamiento de red. No requiere esperar a M.

1. Preparar copia privada con hash/propietario/permisos del vhost API, env y sondas VTT. Reutilizar [plantilla Apache](../backend/deploy/apache-proxy.conf.example); verificar módulos ya disponibles `proxy`, `proxy_http`, `headers`, `ssl`. Si falta alguno, pedir alcance explícito antes de habilitarlo. Conservar HTTP-01, certificados y todos los otros vhosts.
2. **Antes de arrancar**, configurar las sondas VTT para los seis sitios independientes existentes; retirar la sonda API estática 403 de la lista previa al arranque. La API proxificada depende de Node: incluirla en ese baseline causaría fallo/circularidad. Adaptar además `health()` del supervisor: actualmente no envía cabeceras y, con proxy de confianza activo, incluso `/health` exige token, `X-Forwarded-Proto: https` y una IP única válida. La sonda local deberá enviarlos desde su entorno privado, sin registrarlos ni eximir `/health` de la política. Validar solo este cambio con una prueba focalizada de ambos perfiles. HTTPS API se comprueba externamente después del proxy.
3. Establecer `TRUST_PROXY_LOOPBACK=true`, `HOST=127.0.0.1`, origen frontend explícito. Coordinar un secreto aleatorio de 32 bytes hex entre env privado e include Apache nuevo root:root 0600. No mostrarlo, versionarlo ni enviarlo al frontend. Crear únicamente la ruta secreta autorizada, sin alterar permisos compartidos existentes.
4. Aplicar saneamiento de todas las cabeceras de identidad y del token entrante según plantilla; Apache fija IP desde `CONN_REMOTE_ADDR`, protocolo HTTPS y token privado. `ProxyAddHeaders Off`, `ProxyRequests Off`; Socket.IO antes de `/`, ambos a loopback 3400. Apache actual admite upgrade en `mod_proxy_http` ([referencia oficial](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#protoupgrade)). No abrir 3400 ni tocar SSH/firewall/router/DNS.
5. Arranque manual supervisado y salud local; `apache2ctl configtest` y únicamente `reload` si es correcto. Desde una red externa: TLS/SNI y cadena válidos, `/health`, login y permiso denegado, cabeceras suplantadas, upgrade WSS 101 y fallback polling. Un recorrido focalizado con director y tres jugadores, QR/aprobación/revocación, mapa 12 MiB y reconexión cubre **el nuevo transporte público**; no repetir las suites F7/F8. Comprobar seis sitios y ruta ACME conservados. No registrar tokens, QR ni contraseñas en evidencias.

**Rollback B:** detener solo VTT; restaurar vhost API original (403) y env/sondas VTT si sus hashes no muestran cambios concurrentes; configtest antes de reload; retirar include secreto nuevo solo cuando no quede referenciado. Conservar datos/backup. Si configtest falla, no recargar. No modificar certificados ni DNS. Deshabilitada y parada al cerrar la ventana, incluso tras aceptación.

**Autorización C — frontend, separada de B y sin merge a main implícito.** Preparar un artefacto estático de esta rama con `apiBaseUrl` y `realtimeBaseUrl` = `https://api.naufragio.net`, `socketPath=/socket.io`, sin secretos. La documentación actual describe Pages como prototipo local; no se asume que ya incluya este cliente. Elegir publicación separada del artefacto/release en Pages, o alojamiento HTTPS privado expresamente autorizado; ajustar `ALLOWED_ORIGINS` solo al origen elegido. Verificar rutas/QR desde móvil real y guardar artefacto/configuración anterior para rollback. B puede aceptarse con cliente diagnóstico externo antes de C; la partida real requiere cliente compatible accesible.

## 5. Orden mínimo y cierre

| Para la primera partida remota | Decisión/autoridad necesaria |
| --- | --- |
| Credenciales reales, backup, conservación del tablero y bloques atendidos | A |
| Corregir lista de sondas VTT y activar HTTPS/WSS API | B |
| Entregar frontend compatible y probar QR en móvil | C, publicación independiente |
| Arranque manual durante la partida y cierre verificado | A; sin enable |
| Contención dura y reinicio de Raspberry | M; posterior, no bloquea A+B+C |
| Sesiones continuas largas, alertas, backups programados y autoarranque | Opcionales para primera partida; cambios y autorización propios de 24/7 |

No queda pendiente otra auditoría general. Siguiente paso propuesto: autorizar **A+B+C para una primera partida de 50 minutos**. M permanece como decisión posterior. El estado actual sigue siendo backend privado instalado, detenido y deshabilitado, con veredicto **APTO CON LIMITACIONES**.
