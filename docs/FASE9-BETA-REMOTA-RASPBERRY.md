# Fase 9 — beta remota supervisada de tres horas

Fecha: 2026-10-31. Rama de aplicación: `feat/backend-multijugador`.

**Veredicto: APTO CON LIMITACIONES para beta supervisada de tres horas.** Ensayo real superado durante **10.807,17 s (3 h 00 min 07 s)**, director y tres jugadores, sin renovar sus sesiones durante ese intervalo. Backend detenido y deshabilitado al terminar; API restaurada a 403. Sigue sin contención dura de memoria y no se valida operación 24/7. Este informe sustituye para la beta la propuesta histórica de bloques de 50 minutos. Se autorizó A+B+C; no se autorizó ni realizó la intervención M sobre el arranque/memcg.

## Cambios y publicación

- Backend y pruebas: `e91327c5c4f54fe4d108b8a509ac86be11edf855`; frontend aislado y diagnóstico de transporte: `c629de47e0bd0d75971dbe1b788bce313b5473fa`, publicados en la rama de aplicación. El informe y sus evidencias se incorporan en el commit de cierre, posterior a esos dos; su identificador lo proporciona `git log -- docs/FASE9-BETA-REMOTA-RASPBERRY.md`.
- Artefacto estático final: `4a6ba2c10fbb0bd0a0dd660ad165b152e9ca0000`, rama `deploy/phase9-beta`, basada en `main` `37edf0d691cc807335f3020eb12182b643634312`. Publicaciones anteriores: `84f065b` y `df52196`. Solo añade los 27 archivos de `beta/`; la raíz del prototipo coincide con main. No hubo merge ni escritura en main.
- GitHub Pages usa ahora esa rama y `/`; compilación `built`. Beta: **https://naufragio-rolero.github.io/vtt-naufragio/beta/**. Volver a la fuente `main` + `/` y solicitar build revierte la publicación sin borrar el prototipo.
- Build mediante lista explícita de recursos públicos; incluye `join.html`, QR, clientes y configuración HTTPS. Excluye backend ejecutable, despliegue, scripts administrativos, `.env`, SQLite y secretos. `site.config.json`: API y realtime `https://api.naufragio.net`, Socket.IO `/socket.io`.
- El artefacto se genera con `buildFrontend({storageNamespace:'phase9-beta', ...})`: añade ese sufijo a las claves del tablero y de imágenes locales, sin modificar el código ni los datos del prototipo. Prueba real en Edge: mover una ficha en la beta conserva una entrada preexistente del prototipo y guarda en otra clave. [Evidencia](evidencia-fase9/beta-browser-storage-isolation.json).
- `beta/network-check.html` comprueba los tres transportes sin login ni credenciales, abre solo conexiones Engine.IO transitorias y las cierra; no muestra SIDs ni equivale a una partida autenticada.

## Configuración efectiva y seguridad

Release `/opt/naufragio-vtt/releases/phase9-beta`, enlace `current`, runtime Node 22.23.4 ARMv7 previo verificado por SHA-256: ejecutable `407b390f1667066e55cb36c8622e79d6d488aed417d072487bfbe92f47829d6b`, archivo original `c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437`. Usuario VTT sin privilegios y unidad F8 conservados. No se cambian heap 64 MiB, cuota CPU, límites de conexiones/peticiones, permisos de escritura de systemd, `Restart=no`, watchdog 10 s ni cierre del hijo al morir el supervisor. Sin arranque automático. El supervisor corregido instalado tiene SHA-256 `66493462bcadc49f7c0e994a076724e3f45c86fa22245ddd298bd91a69fa6c51`.

| Valor | Beta |
| --- | --- |
| Plazo máximo del supervisor | 16.200 s, 4 h 30 min desde su inicio; validación finita 1–16.200 |
| Sesión de cuentas, incluido director | 16.200 s desde login; rango 60–16.200, default general 1800 conservado |
| Sesión de invitado admitido | 14.400 s desde incorporación; máximo anterior de cuatro horas conservado |
| QR / petición pendiente | 3600 / 300 s; caducar o revocar QR no revoca sesiones ya admitidas |
| RSS conjunto Node + Python | Parada por >160 MiB |
| MemAvailable | Inicio ≥384 MiB; parada por <192 MiB |
| Temperatura | Parada por ≥75 °C |
| Métricas | `monitor.jsonl` y tres segmentos, máximo 2 MiB cada uno; historial acotado a unos 8 MiB |

Seis sondas independientes: Heaven's Gate, foro, proxy, Bibprof, Ordenanthia y galería; cuatro unidades/PIDs vigilados como en F8. Se retiró únicamente la antigua sonda API/403 del baseline anterior al arranque. `/health` local usa cabeceras de confianza y secreto desde el entorno privado; no depende del proxy público, no usa proxy de entorno, no sigue redirecciones y comprueba identidad/protocolo del JSON. Se comprueba también durante el funcionamiento, cada cinco iteraciones.

`cgroup_disable=memory` sigue activo: no se añadieron MemoryHigh/MemoryMax ni se presentan como efectivos. La supervisión no contiene picos instantáneos y sigue requiriendo operador. No se reinició Raspberry ni se modificaron kernel, firmware, arranque, SSH, firewall, DNS o Certbot.

## Apache y rollback de ventana

[Baseline](evidencia-fase9/beta-baseline.json), copia privada y hashes antes de escribir. Módulos necesarios ya cargados; no se habilitaron módulos ni otros vhosts. Solo se modifica `/etc/apache2/sites-available/api-naufragio-ssl.conf` durante la ventana, conservando certificados y vhost HTTP/ACME.

La plantilla sanea Forwarded, X-Real-IP, cabeceras X-Forwarded y token entrante; fija IP desde `CONN_REMOTE_ADDR`, protocolo HTTPS y token privado. ProxyRequests/ProxyAddHeaders desactivados; Socket.IO precede al proxy `/`, con polling y upgrade WebSocket hacia `127.0.0.1:3400`. Se ejecutaron configtest y **reload**, nunca restart. Sin apertura de 3400.

Secreto aleatorio de 32 bytes hex coordinado en env e include `/etc/naufragio-vtt/apache-proxy-secret.conf`, root 0600; no se registra ni publica. Copias y manifiesto root 0600/0700 bajo `/opt/naufragio-vtt/phase9/`. El [controlador de ventana](../backend/deploy/beta-window.py), instalado allí como `window.py`, detiene solo VTT y restaura el vhost 403 al finalizar, al salir la unidad o al recibir señal de cierre; comprueba hashes para evitar sobrescribir cambios concurrentes. Tiene un plazo adicional de 15.000 s, algo inferior al límite del supervisor, y no instala otra unidad ni autoarranque. No sustituye la protección de systemd del proceso VTT.

## Pruebas ejecutadas y procedencia

| Prueba | Resultado / alcance |
| --- | --- |
| Configuración, proxy y sesiones largas | 9 pruebas JS focalizadas; reloj acelerado identificado como tal |
| Invitados y build/subcarpeta | 8 pruebas afectadas; no se repitieron suites completas |
| Supervisor final | 6 pruebas Python: plazos, guardas, cabeceras privadas, seis sondas, cliente reutilizado y rotación |
| Plazo real corto | 12 s; unidad termina `success`, inactiva y deshabilitada |
| Fallo del supervisor | SIGSTOP con configuración larga; watchdog cierra backend, sin listener, observado tras 14,112 s |
| API por nombre público desde Windows | TLS válido, WSS y polling, autenticación, permisos, director + tres invitados, reconexión y revocación |
| Mapa 12 MiB | SHA-256 correcto en los tres receptores; primer recorrido 52,36 s |
| Cabeceras falsas | Apache sanea cabeceras/token falsos y responde 200; acceso directo sin cabeceras privadas devuelve 403 |
| QR rechazado | Claim denegado por el recorrido HTTPS real, en sala sintética independiente |
| Beta publicada en Edge | QR decodificado, rutas `/beta/join.html` e `index.html`, tres invitados, recarga de invitado y recuperación de autoridad del director |

Evidencias: [funcional](evidencia-fase9/beta-public-hostname-functional.json), [navegador](evidencia-fase9/beta-public-pages-browser.json), [rechazo](evidencia-fase9/beta-qr-rejection.json), [supervisor](evidencia-fase9/beta-supervisor-real.json), [versión corregida instalada](evidencia-fase9/beta-revised-supervisor-installed.json). Los intentos fallidos del diagnóstico de navegador se conservan: faltaba contemplar el login del director tras recarga y esperar a que el tablero estuviera listo; otro intento coincidió con el cierre de seguridad. No se modificó el frontend para esconder esos resultados.

**Windows está en la LAN de Raspberry.** Acceder al nombre público y atravesar Apache no acredita por sí solo una red externa independiente. Edge con tres contextos táctiles es emulación, no tres teléfonos físicos. La herramienta web externa no obtuvo una respuesta utilizable de la API; eso no se declara validación externa ni prueba concluyente de fallo. **El propietario confirmó desde un móvil físico con Wi-Fi desactivado que `/health` responde correctamente por datos móviles y sin aviso de certificado; después confirmó HTTPS, WebSocket y polling en OK desde `/beta/network-check.html`.** Es validación externa de los transportes comunicada por el propietario, no una partida externa autenticada de tres horas. [Confirmaciones del propietario](evidencia-fase9/beta-external-mobile-user-report.json) y [diagnóstico automático en Windows](evidencia-fase9/beta-network-check-windows.json).

La recarga deliberada del director requiere login nuevo porque la sesión normal vive en memoria de página; después recupera la autoridad desde IndexedDB del mismo perfil/origen. Los invitados sí recuperan su sesión desde sessionStorage tras recargar. Esto es distinto de una reautenticación ordinaria por vencimiento durante una partida continua. SQLite no contiene todos los mapas/estado local: conservar también el perfil y los recursos del director.

## Incidente real y corrección

El primer ensayo prolongado **falló**: comenzó a las 19:23:53 UTC y la guarda cerró VTT a las 19:27:24 UTC. El último progreso confirmado tenía 181,10 s y los cuatro participantes conectados. El controlador restauró automáticamente el 403 original; no hubo bucle de reinicio ni subida de límites.

Muestras anteriores a la parada: RSS conjunto máximo **159,49 MiB**, Node **116,52 MiB**, Python **46,22 MiB**, MemAvailable mínimo **453,63 MiB**, temperatura máxima **63,91 °C**. La versión inicial descartaba la muestra que disparaba la excepción; por ello no se afirma el valor exacto ni cuál de las tres condiciones se cruzó. [Métricas y journal](evidencia-fase9/beta-resource-stop.json).

Se detectó y corrigió una regresión introducida por la nueva sonda: reconstruía `urllib` y un contexto TLS en cada comprobación. Comparación **aislada ARMv7**, con respuestas HTTP simuladas y constructores reales, 400 comprobaciones: versión anterior **54,83 MiB**, versión corregida **18,22 MiB**, cuatro descriptores en ambos casos. Se reutiliza un único opener y se registran los valores si salta otra guarda. [Comparación](evidencia-fase9/beta-isolated-opener-rss.json). Esta prueba no equivale al ensayo real de tres horas. Después se instaló la corrección y volvió a pasar el plazo real corto; se conserva el fallo anterior como parte del resultado.

Otra incidencia de preparación: la base sintética se ubicó inicialmente fuera de `ReadWritePaths` y no pudo arrancar. Se movió al directorio de datos permitido; no se ampliaron permisos. Para diagnóstico local se aisló la dependencia QR tras un EPERM en node_modules, sin instalar dependencias en Raspberry.

## Ensayo prolongado final

**Superado:** inicio 2026-10-31 **19:36:50,936 UTC / 20:36:50,936 Madrid**; final **22:36:58,109 UTC / 23:36:58,109 Madrid**. Duración monotónica **10.807,17 s**; 180 movimientos confirmados, los cuatro clientes conectados al terminar y ninguna incidencia en el resultado. Director y tres invitados, uno mediante polling y dos mediante WebSocket; movimientos confirmados periódicos y salud API durante todo el intervalo. Mapa de **12 MiB** validado por SHA-256 a los tres antes del inicio de este intervalo, en **61,88 s** bajo carga adicional del diagnóstico de navegador. La diferencia entre intentos no es una comparación A/B. Reconexión de jugador y permisos superados; revocación final superada después de las tres horas.

[Resultado completo](evidencia-fase9/beta-soak-pass.json), [inicio](evidencia-fase9/beta-soak-final-start.json) y [último progreso](evidencia-fase9/beta-soak-final-progress.json). Los archivos `beta-soak-failed`, `beta-soak-start` y `beta-soak-last-progress` corresponden al primer intento fallido y se conservan separados. No se suman sus minutos. Este recorrido usa cuentas y tráfico sintéticos desde Windows, por nombre público y Apache; las comprobaciones móviles externas son las confirmaciones del propietario descritas antes. Queda sin ejecutar una partida humana de tres horas con tres teléfonos físicos externos.

## Mediciones y servicios existentes

Se conservaron **8.486 muestras** del proceso corregido, durante **10.939,23 s**, incluida preparación y transferencia anterior al intervalo continuo. [Datos íntegros](evidencia-fase9/beta-final-host.json) y [resumen calculado](evidencia-fase9/beta-metrics-summary.json).

| Medida | Resultado real |
| --- | --- |
| RSS conjunto máximo Node + Python | **128,89 MiB** frente a parada >160 MiB |
| RSS máximo Node / supervisor | **109,97 / 19,36 MiB**; máximos individuales, no suma necesariamente simultánea |
| MemAvailable mínimo | **480,93 MiB**, frente a parada <192 MiB |
| Temperatura máxima | **63,38 °C**, frente a parada ≥75 °C |
| CPU acumulada Node | Usuario 210,29 s + sistema 9,66 s; media **2,01 % de un núcleo** durante la vida del proceso, sin incluir Python/Apache/auxiliares |
| Salud HTTPS de API desde Windows | 1.074 muestras; mediana **32,44 ms**, máximo **607,23 ms** |
| PIDs/estado de cuatro unidades existentes | **1.698 comprobaciones**, todas sin cambios; campo registrado cada cinco iteraciones |

Python permaneció en 19,36 MiB entre las capturas de dos horas y el final. La corrección no eleva límites ni elimina las sondas. Las métricas son muestras, no garantía de captura de todo pico instantáneo. El RSS del cliente Windows, **317,17 MiB** de máximo, no pertenece a Raspberry ni se usa como RSS del backend.

| Sitio | Respuestas observadas | Mediana / p95 / máximo |
| --- | --- | --- |
| Heaven's Gate | 1.415 × 200 | 229,65 / 247,27 / 449,49 ms |
| Foro | 1.415 × 200 | 227,03 / 248,05 / 357,22 ms |
| Proxy | 1.414 × 404 esperado | 133,27 / 150,69 / 293,59 ms |
| Bibprof | 1.414 × 200 | 241,49 / 262,24 / 430,00 ms |
| Ordenanthia | 1.414 × 200 | 152,10 / 170,39 / 368,77 ms |
| Galería | 1.414 × 200 | 138,57 / 156,11 / 257,40 ms |

Sin respuestas inesperadas ni reinicios de las cuatro unidades vigiladas; certificados validados en las sondas. La muestra inicial de Heaven's Gate fue 184,30 ms y la final 212,95 ms. Son observaciones de disponibilidad y latencia de sondas, no una prueba exhaustiva de carga de las aplicaciones ni un baseline estadístico que permita atribuir variaciones pequeñas a VTT. Frente a F8: RSS conjunto 115,20 → 128,89 MiB, MemAvailable mínimo 332,23 → 480,93 MiB, temperatura máxima 68,76 → 63,38 °C y mapa 72,72 → 61,88 s; cambian carga y condiciones, por lo que no se afirma una mejora causal de rendimiento.

## Cuentas, datos y operación posterior

El propietario creó el administrador real interactivamente; no facilitó sus credenciales al agente. La aceptación usa exclusivamente otra SQLite sintética en `data/phase9-validation/`; ninguna contraseña real se usó en automatización. La preparación de una partida legítima se hace desde el navegador: entrar como administrador, crear director, entrar como ese director, crear sala y mostrar QR; aprobar tres solicitudes reconocidas y conceder permisos/asignaciones.

Para abrir posteriormente una ventana autorizada, con configuración apuntando a la base real y un operador presente:

```bash
sudo python3 /opt/naufragio-vtt/phase9/window.py
```

Mantener esa terminal abierta; no usar `enable`. Entrar en la URL `/beta/`, verificar el destino antes de introducir credenciales y guardar el tablero en un perfil persistente. La ventana tiene límite de 4 h 10 min; el supervisor, de 4 h 30 min. Preparar y empezar la partida con margen para tres horas completas y cierre. Las guardas pueden detenerla antes por seguridad.

Para cerrar: Ctrl+C en el controlador, o desde otra terminal:

```bash
sudo python3 /opt/naufragio-vtt/phase9/window.py close
```

Verificar unidad inactiva/deshabilitada, sin procesos/listener 3400, API en 403 y seis sitios disponibles. Hacer backup consistente nuevo mediante el script F8 como usuario VTT y guardar también los recursos del director. **No ejecutar el rollback destructivo de F8:** ahora existe una identidad legítima que debe conservarse.

## Estado final y recursos conservados

Cierre **2026-10-31 22:37 UTC / 23:37 Madrid**, [verificación final](evidencia-fase9/beta-final-host.json) y [ausencia de procesos](evidencia-fase9/beta-final-processes.json):

- Unidad `MainPID=0`, `Result=success`, `inactive`, `disabled`; sin procesos VTT ni listener 3400. Controlador de ventana y sesión administrativa de recuperación cerrados; no se usaron túneles SSH.
- Vhost API SSL restaurado byte a byte al original, SHA-256 `2bb7a45c31f59fda96c6ddaa6035830328be43e74822ad071fe96b8a0b652d1d`; respuesta HTTPS **403**. HTTP/ACME y certificados conservados. **738 archivos compartidos comparados, cero cambios** al terminar. Apache 31389, MariaDB 868, SSH 803 y SMB 1029 mantienen PIDs y estado activo.
- Entorno privado restaurado a la base **real** `/mnt/ssd/naufragio-vtt/data/naufragio.sqlite`, sin arrancarla. Integridad `ok`, un usuario administrador y cero salas; sin publicar nombre ni contraseña. Copia consistente nueva `/mnt/ssd/naufragio-vtt/backups/phase9-real-admin.sqlite`. La base no contiene el tráfico de prueba.
- Eliminado exclusivamente `data/phase9-validation/`, incluida su SQLite, WAL/SHM y fixtures; eliminado el export temporal de `/tmp` tras recoger las métricas. Conservados release, runtime, configuración privada, secreto 0600, métricas acotadas, copias de recuperación y controlador bajo `/opt/naufragio-vtt/phase9/`, necesarios para una próxima ventana.
- Frontend estático `/beta/` sigue publicado, separado del prototipo de raíz; sus conexiones a la API cerrada no funcionan hasta abrir una nueva ventana. La publicación no deja el backend funcionando ni implica autorización 24/7.

**Indispensable para la primera partida real:** abrir una ventana atendida mediante el controlador, verificar salud/margen temporal, entrar con el administrador propio, provisionar director y aprobar los jugadores; conservar el perfil/tablero del director y cerrar verificando 403. No hace falta repetir las suites superadas. **Requiere autorización posterior:** intervención M sobre memoria/arranque y reinicio, operación continua, autoarranque y cambios de límites/alertas o servicios. Ninguna de esas operaciones se ha realizado.
