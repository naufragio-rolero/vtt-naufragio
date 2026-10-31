# Fase 7 — piloto real ARMv7 en Raspberry

Fecha: **31 de octubre de 2026**. Repositorio `naufragio-rolero/vtt-naufragio`, rama `feat/backend-multijugador`, commit **`a77a90970f068a56800885d2f07ee6b964d5d4d2`**, comprobado antes del ensayo. Código de aplicación conservado.

## Veredicto: APTO CON LIMITACIONES

**Fase 7 funciona en esta Raspberry ARMv7 para una beta privada pequeña con supervisión externa y los límites ensayados.** Se han probado un director y **tres invitados QR**, cuatro contextos de navegador reales, mapas de 12 MiB, permisos, revocación, interrupción, recuperación tras reinicio exclusivo del backend, más de cinco minutos de actividad estable y caducidades reales. SSH está restaurado byte a byte y el piloto temporal está eliminado.

**Para instalación permanente: APTO CON LIMITACIONES, condicionado a decidir y validar la protección de memoria y la operación del servicio.** La plantilla actual no proporciona `MemoryHigh`/`MemoryMax` efectivos con el arranque observado. El piloto no valida una instalación permanente sin supervisión, carga prolongada, ni acceso público por Apache. La instalación definitiva, publicación y cualquier cambio de arranque siguen pendientes de decisiones y autorizaciones independientes; no se han realizado.

El bloqueo inicial por forwarding se resolvió únicamente después de la nueva autorización expresa del propietario para repetir la excepción SSH y su rollback. La ausencia de memcg no se trató como impedimento para este ensayo temporal supervisado, siguiendo esa autorización. Se conservan la [auditoría inicial](evidencia-piloto-fase7/audit.json), el [preflight inicialmente denegado](evidencia-piloto-fase7/preflight.json) y los resultados posteriores, sin atribuirles el mismo alcance.

## Aislamiento, runtime y recursos de partida

- Node **22.23.4 oficial Linux ARMv7**, `process.arch=arm`; archivo de 26,362,452 bytes descargado de nuevo y verificado tanto contra `SHASUMS256.txt` oficial como contra el SHA-256 validado en Fase 6: `c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437`.
- Ejecutable SHA-256 `407b390f1667066e55cb36c8622e79d6d488aed417d072487bfbe92f47829d6b`, comprobado también en Raspberry. Paquete de **39,412,428 bytes**, SHA-256 `5c44217c931446f7fde82080cbc5e427ed617b57a53f937b3e7b97de43e3b6e2`, validado al recibirlo y antes de extraerlo. [Artefactos](evidencia-piloto-fase7/artifacts.json).
- Fuentes de un `git archive` del commit exacto; 21 dependencias de producción preparadas en Windows mediante `npm ci --omit=dev --ignore-scripts`. Sin npm, compilación, actualización de paquetes ni instalación global remota. [Auditoría de fuentes/dist](evidencia-piloto-fase7/dist-and-source-audit.json): 19 módulos de aplicación/contratos coinciden con el workspace; dist temporal de 24 archivos públicos, 252.939 bytes, hashes verificados.
- Raíz privada nueva `/var/tmp/naufragio-pilot.*`, propietario y ruta real comprobados, miembros de tar validados antes de extraer. HOME, TMPDIR, SQLITE_TMPDIR, SQLite, fixture y logs confinados a ese árbol; no se usaron directorios ni bases reales de aplicaciones. `/var/tmp` está en microSD, **no en SSD**: el piloto no mide rendimiento de SQLite sobre SSD.
- Listener comprobado con `ss`: **exclusivamente `127.0.0.1:3400`**. Frontend Windows solo en loopback 8080; túnel propio solo en loopback 13400. [Aislamiento real](evidencia-piloto-fase7/runtime-isolation.json).
- Heap 64 MiB, `UV_THREADPOOL_SIZE=1`, nice 19, cores deshabilitados y presupuesto CPU por proceso del supervisor existente (180/185 s). Guardas exteriores: RSS >160 MiB, MemAvailable <192 MiB, temperatura ≥75 °C o cambio de servicios/respuestas. Deadline de supervisor 720 s; controlador SSH 1200 s. No se provocó deliberadamente una guarda de presión.

La única copia instrumentada del backend es el [bootstrap sintético](evidencia-piloto-fase7/pilot-server-f7.js): fija/verifica mediante su estado de arranque `MAX_MESSAGE_BYTES=65536`, usa el perfil HTTP 600/minuto/IP ya propuesto en `deploy/backend.env.example`, reduce solicitud de invitado a 30 s para ensayar su caducidad y permite una segunda generación con sesión de invitado de 60 s. La sesión del recorrido principal dura 1800 s. No se modificaron algoritmos, transporte, pacing, permisos ni código de aplicación para cambiar resultados de rendimiento.

El [baseline autorizado](evidencia-piloto-fase7/authorized-baseline.json) tenía MemAvailable 502.076 KiB (490,31 MiB), temperatura 59,072 °C y puerto 3400 libre. La auditoría inicial verificó SSD `/dev/sdb1` ext4 en `/mnt/ssd`, 82,56 GiB libres, 21 % ocupado e inodos al 4 %; CPU en reposo sin actividad de swap en los dos intervalos de un segundo. No se realizó benchmark, SMART ni prueba de escritura de datos existentes.

## SSH temporal: validación y restauración

1. Se comprobó primero SSH y `sudo -n true`. Al no haber sudo disponible se detuvo el trabajo hasta que el propietario ejecutó `sudo -v` interactivamente; después se verificó su disponibilidad desde la conexión del agente. No se recibieron contraseñas ni se cambió sudoers.
2. `sshd -t` del original y candidato: exit 0. Evaluación efectiva con usuario, IP cliente, IP local y puerto reales, también para otra cuenta: **solo cambia `PermitOpen` de la cuenta del piloto**, de `127.0.0.1:3306` a `127.0.0.1:3306 127.0.0.1:3400`; todas las demás directivas efectivas coinciden. [Validación previa](evidencia-piloto-fase7/ssh-candidate-validation.json).
3. Se utilizó **el controlador existente `backend/scripts/pilot-ssh-policy.py` sin modificarlo**, ejecutado con sudo temporal dentro de una sesión SSH conservada como vía administrativa de recuperación, además de la terminal mantenida por el propietario. Copia privada, control de cambios concurrentes, deadline y rollback preparados antes de aplicar. Solo **reload**, nunca restart.
4. Preflight versionado: exit 0. Conexiones nuevas: 3400 permitido y destino libre (`Connection refused`), 3401 denegado; MariaDB conserva saludo sin autenticación SQL. [Preflight autorizado](evidencia-piloto-fase7/authorized-preflight.json).
5. Al terminar, el controlador restauró el contenido original **byte a byte**, con propietario/permisos, validó sintaxis y ejecutó reload; copia privada eliminada. SHA-256 original/restaurado: `f1805313ad346bdb80dff4a560a080edfca9a998f620b64da2a1aba6bcf6782e`. [Eventos](evidencia-piloto-fase7/policy-events.json).
6. Conexiones nuevas finales: **3400 y 3401 denegados**, saludo MariaDB conservado. Controlador, supervisor y túnel propios finalizados. [Verificación de rollback](evidencia-piloto-fase7/rollback-verification.json).

## Recorrido funcional ejecutado

[Informe del navegador](evidencia-piloto-fase7/browser-report.json), resultado **pass**. Director Edge `156.0.4314.50`, primer invitado Firefox `142.0.1`, otros dos invitados Edge, con cuatro contextos independientes contra el backend ARMv7 real. No hubo backend de juego simulado en Windows. La interacción es automatizada; no se atribuye un ensayo manual a una persona.

- Login de cuenta sintética, alta por invitación de un uso y rechazo de reutilización; cuenta ordinaria sin creación de salas ni subida de recursos.
- QR generado por la interfaz y decodificado al enlace exacto; fragmento retirado; tres solicitudes aprobadas y entrada real a la sala. Recarga de solicitud pendiente; claim sin aprobación, claim repetido y solicitud rechazada denegados. Permisos iniciales de invitados comprobados en false.
- Asignación de tokens y concesión de movimiento; movimiento ajeno denegado en UI; permiso revocado denegado también mediante petición directa al backend. Director conserva autoridad. Invitado sin acceso a otra sala.
- Mismo mapa, retrato público, nombre/color/tamaño y posiciones en los cuatro clientes; cambios de mapa antes y durante actividad estable. PNG válido de exactamente 12.582.912 bytes, SHA-256 comprobado y recurso decodificado en los cuatro navegadores.
- Desconexión de un receptor al primer fragmento de otro PNG válido de 12 MiB; director y demás receptores continúan; receptor desconectado vuelve y verifica el recurso. No se reutilizó la misma imagen para que la caché no sustituyera la transferencia.
- Logout del director → sala en espera; login del mismo navegador, recarga con IndexedDB y reinicio exclusivo del backend → recuperación de autoridad, tokens, mapa y retrato con SQLite reabierta.
- **306,72 segundos** de actividad estable, 30 movimientos espaciados y comprobación de igualdad en los cuatro clientes; versiones finales `[21, 11, 0, 0]`. El tercer invitado participa como receptor sin permiso de movimiento; los movimientos se alternan entre director y los dos invitados asignados.
- Revocar QR impide nuevas solicitudes y mantiene admitidos; retirar pertenencia expulsa e invalida sesión. Se retiró finalmente acceso a los tres invitados del recorrido. Tablero local previo del director conservado al abandonar.

Cero errores de página observados en las aserciones, cero rechazos sin gestionar del controlador y ningún `RATE_LIMITED`. Códigos de acuses recogidos: `TRANSFER_NOT_FOUND` al cancelar transferencia y `DIRECTOR_NOT_READY` durante recuperación de autoridad, ambos recuperados por el recorrido que terminó en pass. No se afirma haber instrumentado todos los rechazos Promise internos de los navegadores.

Capturas finales revisadas: [director](evidencia-piloto-fase7/armv7-client-0.png) y [tercer invitado](evidencia-piloto-fase7/armv7-client-3.png), con el mismo mapa y posiciones, a distinto zoom personal. Se conservan también las capturas de los otros dos invitados; sin paneles de credenciales ni QR abiertos. La vista final usa el mapa pequeño de actividad, no la imagen aleatoria de 12 MiB.

### Transferencias y latencias

| Operación | Fase 7 real |
| --- | --- |
| 12 MiB a **tres invitados**, con cuatro navegadores verificando el recurso | **49923,38 ms** |
| Interrupción: hasta completar el otro receptor observado | **33466,34 ms** |
| Integridad y recuperación | Director conectado y receptor reconectado con imagen verificada |

PNG principal SHA-256 `a2c122b6a6a1c9c85c79dd7aff9fb93cb0db313679ff38965bdb5b86112a3bb1`. Segundo PNG SHA-256 `c80b77c69b4850301dbd59b4fe497e99c43cb825dec1ff0613feb68e2d606899`. Dimensiones 1740 × 1740; imagen RGBA sintética con bloque auxiliar PNG y CRC válido para completar 12 MiB. La Raspberry retransmite bytes; la decodificación ocurre en Windows. No es el peor caso de memoria gráfica de un móvil.

Los nombres heredados `twoPlayerTransferMs`, `threeDecoded` y la etiqueta de etapa de tres clientes del diagnóstico F6 se conservan en el JSON crudo; **en esta ejecución el bucle comprueba cuatro páginas y tres receptores**, como acreditan `clients=4`, `guests=3` y el diagnóstico conservado. El tiempo del receptor tras interrupción se mide sobre el jugador B observado; no representa una marca temporal conjunta de todos los receptores.

| Medida por red local y túnel | Muestras | Mediana / p95 / máximo |
| --- | ---: | --- |
| Login HTTP | 5 | 1678,05 / 1723,61 / 1723,61 ms |
| /health por túnel | 60 | 7,69 / 15,70 / 68,10 ms |
| Solicitud → confirmación de movimiento | 32 | 42,15 / 54,38 / 61,16 ms |

Movimiento mide frames solicitud/confirmación, no arrastre ni RTT TCP puro. p95 por rango más próximo. Los tiempos incluyen pacing/backpressure existente, red y SSH; no son ancho de banda puro ni predicción de Internet.

### Caducidad con reloj real

[Segundo diagnóstico](evidencia-piloto-fase7/expiry-report.json), resultado **pass**: tras reiniciar únicamente el backend con sesión de invitado a 60 s, se creó una identidad nueva, se conectó un socket real en Edge y se esperó **sin adelantar el reloj**. Solicitud no reclamada caduca a 30 s; QR caduca a 60 s; sesión caducada produce desconexión y `/auth/me` 401. Reutilizar claim expirado devuelve 410. Una nueva operación de admisión ejecutó la limpieza normal, sin editar SQLite directamente. Invitado sin emisión de invitaciones, subida de recursos ni apertura de admisión.

La base sintética final pasó `PRAGMA integrity_check`: **ok**. Filas finales: invitados 0, solicitudes 0, admisiones 1, sesiones sintéticas 5, salas sintéticas 3. La limpieza de identidades temporales se observa por el contador final de invitados; las demás filas válidas se eliminaron con toda la base y su raíz. [Estado antes de eliminar](evidencia-piloto-fase7/database-final.json).

## Recursos y convivencia durante todo el ensayo válido

[Resumen de métricas](evidencia-piloto-fase7/metrics-summary.json), [muestras saneadas](evidencia-piloto-fase7/samples.jsonl). El monitor es Python externo a Node; cubre bootstrap, imágenes, actividad estable, reinicio de recuperación y generación de caducidad. PIDs sustituidos por generaciones.

| Medida | Fase 7 |
| --- | --- |
| Muestras / ventana / generaciones Node | 432 / 539,83 s / 3 |
| RSS pico / última muestreada | **104,08 / 63,21 MiB** |
| MemAvailable mínimo | **406,10 MiB** |
| Temperatura mínima / máxima | **59,07 / 64,45 °C** |
| CPU usuario / sistema, suma por generación | 68,58 / 3,93 s |
| CPU media backend | **13,43 % de un núcleo** |
| Comprobaciones de procesos/servicios | 87, todas sin cambios |
| Parada del supervisor | `controller_stop`; ninguna guarda ni deadline activado |

| Sonda HTTPS local, vhost correcto | Muestras | Código estable | Mediana / p95 / máximo |
| --- | ---: | --- | --- |
| heavensgate | 87 | 200 | 142,39 / 170,54 / 522,47 ms |
| forum | 87 | 200 | 142,83 / 175,29 / 188,69 ms |
| proxy | 87 | 404 | 47,65 / 57,12 / 69,09 ms |
| bibprof | 87 | 200 | 161,42 / 188,59 / 287,58 ms |
| ordenanthia | 87 | 200 | 68,99 / 79,83 / 92,48 ms |
| gallery | 87 | 200 | 53,66 / 66,73 / 82,55 ms |
| api | 87 | 403 | 37,16 / 48,08 / 61,27 ms |

Las seis sedes y API conservaron sus códigos; Apache, MariaDB, SSH y SMB permanecieron activos con mismos PIDs principales. Hubo un máximo aislado de **522,47 ms** en Heaven's Gate, frente a mediana 142,39 ms y p95 170,54 ms; no hubo timeout ni cambio de código. El supervisor heredado detiene por cambios de estado/código o fallo de sonda, no por un umbral de latencia relativa: no se atribuye ausencia absoluta de degradación a estas mediciones. Usa `curl -k` para disponibilidad, no para validar certificados; las rondas inicial/final adicionales usan verificación TLS normal. El código 404 de `autonaufragio` y 403 de API son los baselines esperados, no fallos del piloto. No se hizo login ni modificación de datos de esas aplicaciones.

El muestreo no captura necesariamente picos instantáneos. CPU suma máximos muestreados por generación, sin mezclar contadores reiniciados; no es uso global del host. Las guardas no sustituyen contención dura. No se ensayó carga masiva ni horas de estabilidad; los seis sitios se comprobaron anónimamente, no en todos sus flujos internos.

## Comparación con Fase 6

Valores históricos del [piloto Fase 6](PILOTO-ARMV7-FASE6.md); distinto commit y **dos receptores F6 frente a tres F7**. No constituyen un A/B controlado.

| Medida | Fase 6 | Fase 7 |
| --- | --- | --- |
| Navegadores / admisión | 3; cuentas nominativas | 4; director + 3 invitados QR |
| Actividad estable | 308,457 s | 306,72 s |
| 12 MiB a receptores | 37.825,27 ms a dos | 49923,38 ms a tres |
| Receptor observado tras interrupción | 20.722,35 ms | 33466,34 ms |
| RSS pico | 97,23 MiB | 104,08 MiB |
| MemAvailable mínimo | 440,32 MiB | 406,10 MiB |
| Temperatura máxima | 62,300 °C | 64,45 °C |
| CPU media de un núcleo | 10,34 % | 13,43 % |
| Sitios vigilados por supervisor | 3 | 6 más API |
| QR y caducidad real F7 | No ensayados en ese recorrido | Aprobación, rechazo, revocación, 30/60 s y purga verificadas |
| SSH y temporales | Restaurados/eliminados | Restaurados/eliminados |

## Plantillas sin instalación

La validación real de Apache **2.4.69** dio `Syntax OK` con módulos `proxy`, `proxy_http` y `headers` del host, fragmento dentro de una configuración mínima temporal y futuro Include secreto sustituido por valor sintético. El primer intento sobre `/dev/stdin` falló por exigir Apache un fichero regular; la repetición con fichero privado regular pasó. No se activó listener, SSL, proxy público, WSS ni polling por Apache. [Resultado](evidencia-piloto-fase7/apache-template.json).

`systemd-analyze verify --man=no` con systemd **257.9** no notificó directivas desconocidas, pero salió 1 porque no existe `/opt/naufragio-vtt/runtime/bin/node`. **La unidad completa no está validada operativamente ni instalada**: usuario, rutas, namespaces y límites efectivos requieren el futuro entorno permanente. `MemoryHigh`/`MemoryMax` siguen sin efecto verificable por el controlador ausente. [Auditoría original](evidencia-piloto-fase7/audit.json).

## Memoria en producción: investigación de solo lectura

La causa inmediata está comprobada en [memory-and-ssh.json](evidencia-piloto-fase7/memory-and-ssh.json): el kernel `6.18.50+rpt-rpi-v7` tiene `CONFIG_CGROUPS=y`, **`CONFIG_MEMCG=y`** y `CONFIG_SWAP=y`, pero `/proc/cmdline` contiene **`cgroup_disable=memory`**. El mismo argumento aparece en el árbol de dispositivo entregado al kernel; `cgroup.controllers` solo expone `cpuset cpu io pids`. No falta compilar el soporte: se deshabilitó al arrancar. [Significado oficial de `cgroup_disable`](https://www.kernel.org/doc/html/latest/admin-guide/kernel-parameters.html).

Los archivos actuales `/boot/cmdline.txt` y `/boot/firmware/cmdline.txt` no contienen ese argumento; tampoco se encontraron selectores `cmdline=`, `include`, `os_prefix=` o `arm_64bit=` en los dos `config.txt` consultados. **No se ha identificado qué fuente de arranque introdujo el argumento observado.** No se debe editar a ciegas uno de esos archivos: pueden diferir de lo empleado en el último arranque. Se necesitaría revisar el origen efectivo antes de proponer un cambio concreto. No se modificó ningún archivo de arranque ni se reinició la Raspberry.

La comprobación decisiva es la ausencia de `memory` en los controladores disponibles junto al argumento de arranque. La ausencia de `memory.max` en la raíz de cgroup, registrada en la auditoría inicial, no sirve por sí sola para diagnosticarlo: ese límite se expone en cgroups no raíz. [Interfaz cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html).

| Alternativa | Ventaja | Riesgos y limitaciones | Reinicio necesario |
| --- | --- | --- | --- |
| Habilitar el controlador compilado, retirando la desactivación en el origen efectivo de arranque; después validar `MemoryHigh`/`MemoryMax` en el cgroup de VTT | Contención de todo el servicio por el kernel; `MemoryHigh` permite reclamar memoria y ralentizar; `MemoryMax` aporta defensa final | Requiere una ventana autorizada para todo el host y comprobar convivencia; coste de contabilidad y posible OOM dentro de VTT. Hay que verificar también política de swap, no darla por limitada | **Sí**, Raspberry; después verificar controladores y límites efectivos. No realizado |
| Supervisor externo por RSS + MemAvailable + temperatura, junto a heap 64 MiB y límites de concurrencia | Ejecutable con el kernel actual; el piloto demuestra su funcionamiento de monitorización y parada normal | Muestreo, sin límite atómico del kernel: un pico puede adelantarse al siguiente control; RSS no cubre toda la memoria contabilizable del servicio. Fallo del supervisor, reinicios en bucle o carga adicional exigen política operativa. No se probó provocar una guarda | **No** reinicia Raspberry; la adopción permanente y su política de parada/rearranque requieren un cambio autorizado de VTT |
| `LimitAS` / `RLIMIT_AS` como techo de espacio virtual por proceso | No depende de memcg; el kernel puede rechazar reservas de direcciones | Limita direcciones virtuales, no RSS: puede romper V8, SQLite o scrypt con RSS todavía baja; no se ha calibrado ni ensayado. No es una sustitución transparente del límite propuesto | **No** reinicia Raspberry; se aplica al arrancar de nuevo VTT |
| Trasladar VTT a otro host con controlador de memoria y runtime mantenible | Aísla la carga de los seis sitios; permite límites efectivos en el nuevo host | Necesita infraestructura y pruebas de red/almacenamiento; cambia la decisión de alojamiento. Un contenedor en esta misma Raspberry seguiría dependiendo del controlador ausente | No requiere reiniciar esta Raspberry si se conserva su configuración; el nuevo entorno requiere preparación independiente |

`MemoryHigh` y `MemoryMax` necesitan el controlador `memory`; el segundo puede acabar en OOM del servicio. No se han ensayado esos límites en esta sesión. [systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).

**`LimitRSS` no es una alternativa efectiva en Linux.** `LimitAS` limita espacio virtual y puede impedir reservas válidas; systemd recomienda los controles de memoria del servicio. Cambiar `MemoryAccounting=yes`, una slice, Docker o un gestor de procesos no reactiva el controlador deshabilitado al arrancar. [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

El heap de 64 MiB limita la sección old-space de V8, **no el RSS total** del backend; por eso se conserva la supervisión exterior. [Opción de Node](https://nodejs.org/download/release/v22.12.0/docs/api/cli.html#--max-old-space-sizesize-in-mib). Reducirlo o añadir swap no se presenta como solución suficiente al aislamiento de memoria. No se recomienda fijar un nuevo `LimitAS` con un valor arbitrario.

La decisión queda para otra autorización: para una instalación con contención dura, investigar primero el origen de `cgroup_disable=memory` y valorar su retirada con reinicio controlado; si se acepta temporalmente supervisión por RSS, reconocer expresamente su ventana de reacción y ausencia de límite duro. Este piloto no toma ni aplica esa decisión.

## Incidencias y limpieza final

El primer paquete de diagnóstico omitió `backend/public`, aunque `src/server.js` importa `public/site-config.js`; el backend terminó antes del recorrido funcional. Se detectó la omisión al revisar el paquete. El controlador restauró SSH byte a byte, cerró túnel/supervisor y eliminó la raíz. Se conservan [evidencias de ese intento](evidencia-piloto-fase7/attempt-1/rollback-verification.json). Su log de servidor no se recuperó antes de eliminar la raíz: no se atribuye un mensaje de error exacto no conservado. Se repitió con paquete completo y raíz nueva dentro de la autorización vigente. Ese intento no se mezcla con las métricas del recorrido válido. No fue una guarda de recursos ni se corrigió código VTT.

Al terminar el ensayo válido se cerraron navegadores y frontend, se detuvo exclusivamente el backend temporal, se recogieron métricas y se verificó SQLite antes de eliminarla. Ruta real, propietario, prefijo, ausencia de procesos asociados y puerto libre se comprobaron antes de borrar la raíz propia. Túnel cerrado, SSH restaurado por el controlador y backup privado eliminado. [Limpieza remota](evidencia-piloto-fase7/authorized-cleanup.json), [rollback](evidencia-piloto-fase7/rollback-verification.json) y [ronda final](evidencia-piloto-fase7/final-state.json).

La copia local temporal con runtime, dependencias, paquete, caché, fixture y PNGs se eliminó tras comprobar ruta y ausencia de procesos propios. Windows denegó inicialmente borrar un caché Python desde el contexto elevado; se eliminaron los restos desde el contexto que los había creado y se repitió la comprobación final, sin cambiar permisos globales. Solo se conservan informe, diagnósticos y evidencias saneadas. [Limpieza Windows](evidencia-piloto-fase7/windows-cleanup.json). No se cerraron sesiones ajenas ni la terminal administrativa que dejó abierta el propietario.

No se modificaron Apache, DNS, certificados, firewall, kernel, arranque ni sudoers. Solo se hicieron los reloads SSH autorizados, con su configuración original restaurada. No hubo servicio permanente, publicación de VTT, Pages, push, merge a main ni despliegue definitivo. Los cambios documentales previos del workspace se conservaron.

## Reproducción y límites pendientes

Se conservan los diagnósticos ejecutados [navegador](evidencia-piloto-fase7/pilot-browser-f7.mjs), [caducidad](evidencia-piloto-fase7/pilot-expiry-f7.mjs), [bootstrap](evidencia-piloto-fase7/pilot-server-f7.js) y [agregador de siete sondas](evidencia-piloto-fase7/pilot-metrics-f7.mjs). Los dos drivers se copiaron sin cambiar su contenido; esperan ejecutarse desde la raíz del repo con staging nuevo `.pilot-f7-work`, fuente limpia en `source`, jsQR 1.4.0 en `driverdeps` y las variables privadas del procedimiento. No incluyen destinos ni credenciales. Siempre preparar raíces/fixtures nuevas; no reutilizar rutas eliminadas.

Mantener el controlador SSH original, preflight, supervisor externo y cleanup/rollback en finally. La segunda generación usa un marcador privado `expiry-mode` leído por el bootstrap sintético, sin tocar la base ni adelantar el reloj. Para regenerar métricas con Node 24: `node docs/evidencia-piloto-fase7/pilot-metrics-f7.mjs docs/evidencia-piloto-fase7/samples.jsonl`.

Quedan para decisiones/pruebas posteriores: protección de memoria permanente, unidad operativa y backup sobre SSD; ruta real Apache HTTPS/WSS/polling y acceso desde fuera de la LAN; móviles físicos, escaneo óptico, suspensión/Wi-Fi y memoria gráfica; estabilidad prolongada y concurrencia superior a este piloto. La beta supervisada aquí ensayada no acredita esos escenarios. El despliegue definitivo necesita autorización independiente.
