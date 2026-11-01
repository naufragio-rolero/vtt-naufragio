# Piloto ARMv7 de Fase 6 — resultados y limpieza

Fecha: **30 de octubre de 2026**. Rama `feat/backend-multijugador`, commit de partida **`5d5eee5800a3112730cace8f97f5a175ce807d91`**.

## Resultado final — piloto autorizado

**APTO para instalar una beta privada pequeña, con los límites y supervisión ensayados.** Los tres navegadores han funcionado contra la Raspberry real, incluyendo mapas, retratos, permisos, movimientos, reconexiones, reinicio del backend y PNG de 12 MiB. La actividad estable superó cinco minutos. **SSH está restaurado íntegramente y el piloto remoto y sus temporales Windows están eliminados. No se ha realizado una instalación permanente.**

Este resultado sustituye el estado de bloqueo inicial conservado al final de este documento. El propietario autorizó expresamente la excepción temporal exacta, el piloto y su rollback; antes de modificar SSH se comprobó sudo, se validó la configuración efectiva y el candidato en memoria, se preparó copia privada y se conservó una sesión administrativa abierta durante la excepción.

### Runtime, paquete y aislamiento

- Node **22.23.4 oficial Linux ARMv7**, `process.arch=arm`, userland de 32 bits. Archivo oficial verificado contra SHA-256 `c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437` antes de extraerlo en Windows.
- Paquete: **39.511.428 bytes**, SHA-256 `00ac3b6be0e0df234a2260726c63330e39d9f7478213783d66462c23857e454b`, comprobado también al recibirlo. Incluye el ejecutable, fuentes/contratos/ajustes del commit indicado, **21 dependencias de producción** preparadas con `npm ci --omit=dev --ignore-scripts`, arranque sintético y supervisor. No hubo npm, compilación ni instalación global en Raspberry.
- No se modificó código del VTT ni sus tests. La copia temporal de **arranque del diagnóstico** fija `MAX_MESSAGE_BYTES=65536`, lo comprueba y lo incluye en la línea de estado; también se amplió el cliente diagnóstico. No se presenta ese paquete como un checkout remoto sin adaptaciones de instrumentación. Los scripts originales del backend permanecen intactos en Git.
- Todo el piloto remoto estuvo en una raíz privada nueva `/var/tmp/naufragio-pilot.*`, sin usar el SSD de aplicaciones. HOME, TMPDIR, SQLITE_TMPDIR, SQLite, fixture, logs y métricas quedaron dentro. Se validaron ruta real, propietario y miembros del paquete antes de extraerlo.
- Listener real comprobado con `ss`: **solo `127.0.0.1:3400`**. `MAX_MESSAGE_BYTES=65536` verificado en el proceso; no se cargó el antiguo `.env.example` con 16384. Heap 64 MiB, `UV_THREADPOOL_SIZE=1`, nice 19, cores deshabilitados y límite de CPU del supervisor existente.
- `dist/` servido **en Windows**, únicamente por loopback, y API/Socket.IO por el túnel SSH autorizado. Artefacto auditado: **18 archivos públicos y manifiesto, 187.359 bytes públicos, hashes correctos y cero incidencias de auditoría**. Sin backend, bases ni secretos en el artefacto.
- Guardas externas: RSS >160 MiB, MemAvailable <192 MiB, temperatura ≥75 °C o cambio de servicios/respuestas; deadline del supervisor 720 s. Control de excepción SSH con rollback por la misma sesión y deadline de 1200 s. Ninguna guarda ni deadline se activó.

### Comprobaciones reales de Fase 6

Director **Edge 156.0.4314.50**, jugador A **Firefox 142.0.1**, jugador B **Edge**, en tres contextos independientes de Playwright. No había un backend simulado en Windows.

Pasaron las siguientes comprobaciones del [resultado JSON](evidencia-armv7-fase6/browser-report.json):

- Login, alta mediante invitación y rechazo de reutilización; invitaciones nominativas de partida y códigos separados de los de alta.
- Usuario ordinario sin creación de sala ni subida de recursos; asignaciones de tokens, denegación de token ajeno y de permiso revocado mediante petición directa al backend. Restitución del permiso y movimiento del director.
- Mismo mapa ilustrado activo, retrato público, nombre «Exploradora ARMv7», color y tamaño en los tres clientes. Cambio de mapa antes y durante la actividad estable.
- **PNG válido de 12.582.912 bytes** recibido, verificado y decodificado por los tres navegadores, incluidos ambos jugadores. Sin `RATE_LIMITED`.
- Desconexión de un jugador al recibir el primer fragmento de otra imagen de 12 MiB: el director siguió conectado y el otro jugador terminó con el hash correcto; el receptor desconectado volvió y recibió/decodificó el recurso.
- Acceso a una segunda sala privada sin pertenencia rechazado por el backend.
- Logout del director, sala en espera, recuperación con su mismo navegador y recarga real con IndexedDB. Reinicio **solo del backend del piloto**, reapertura de SQLite y recuperación de autoridad, mapa y retrato en los tres clientes.
- **308,457 segundos de actividad estable**, 30 movimientos adicionales espaciados y confirmados, verificando igualdad tras cada uno. Versiones finales `[21,11,0,0]`; tablero local original conservado al abandonar.
- Cero errores de página en las aserciones y cero rechazos sin gestionar observados por el controlador de navegadores. El único código de error registrado en sus acuses fue el recuperable y esperado `TRANSFER_NOT_FOUND` de la transferencia cancelada.

El diagnóstico completo terminó con **exit 0**, en **433,962 s**. Capturas revisadas visualmente: [director Edge](evidencia-armv7-fase6/client-0.png), [jugador Firefox](evidencia-armv7-fase6/client-1.png), [jugador Edge](evidencia-armv7-fase6/client-2.png). Muestran el mismo mapa y posiciones, con zoom personal distinto; contienen cuentas sintéticas, sin paneles de credenciales o códigos abiertos. La interacción es automatizada en navegadores reales; no se atribuye a un operador una sesión manual que no realizó.

### Transferencias y latencias por túnel

El PNG original es la imagen RGBA sintética de 1740 × 1740 ya validada en Windows, con bloque auxiliar PNG y CRC correcto para alcanzar exactamente 12 MiB:

```text
SHA-256: 2710f8b7a6de0fb7eb31cff6aedda3bfccc2572849fb16a9ab9db5c76d193208
```

| Operación | Resultado |
| --- | --- |
| 12 MiB a ambos jugadores, con los tres clientes decodificando | **37.825,27 ms** |
| Interrumpir un receptor: tiempo hasta completar el otro | **20.722,35 ms** |
| Integridad y autoridad después de la interrupción | Hash correcto; director conectado; jugador reconectado con recurso disponible |

La segunda imagen modifica únicamente un bloque auxiliar y recalcula su CRC; sigue siendo PNG válido de 12 MiB. Su hash es `11131cb1364a59d8a88f45ca9b27894659920136527f7f38c5be7a195934b893`. La diferencia evita que una caché convierta la prueba de interrupción en una operación sin transferencia.

| Medida | Muestras | Mínimo | Mediana | p95 | Máximo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Login HTTP | 7 | 1639,56 ms | **1702,26 ms** | 1830,40 ms | 1830,40 ms |
| `/health` por túnel | 60 | 6,77 ms | **9,16 ms** | 19,64 ms | 131,04 ms |
| Solicitud → primera confirmación de movimiento observada | 32 | 33,06 ms | **45,27 ms** | 79,56 ms | 81,88 ms |

Login combina mediciones del navegador y del controlador HTTP; no es una medición aislada de scrypt. Movimiento mide frames de solicitud/confirmación después de la aceptación del director, no el tiempo de arrastre ni RTT TCP puro. p95 utiliza rango más próximo; muestras pequeñas sobre red local y SSH, sin extrapolación a Internet o muchos clientes.

### Recursos ARMv7 y convivencia

**480 muestras externas durante 546,931 s**, incluyendo bootstrap, imágenes, dos generaciones de Node por el reinicio y los cinco minutos estables. [Resumen](evidencia-armv7-fase6/metrics-summary.json) y [muestras saneadas](evidencia-armv7-fase6/samples.jsonl), con generaciones en lugar de PIDs.

| Medida | Resultado |
| --- | --- |
| Pico RSS backend | **97,23 MiB** |
| Última RSS muestreada | **67,28 MiB** |
| MemAvailable mínimo | **440,32 MiB** |
| Temperatura mínima / máxima | **58,534 / 62,300 °C** |
| CPU usuario / sistema, suma por generación | **53,72 / 2,82 s** |
| CPU media backend | **10,34 % de un núcleo**, aproximadamente 2,58 % de capacidad de cuatro núcleos durante la ventana |
| Guardas / timeout | Ninguno activado |
| Apache, MariaDB, SSH, SMB: estado y PID principal | Iguales al baseline en las **96 comprobaciones** y en la verificación final |

El muestreo es periódico; no garantiza capturar todo pico instantáneo. La CPU suma máximos muestreados de cada generación, sin mezclar contadores reiniciados, y no mide utilización global del host. No se pretende una prueba de carga masiva ni estabilidad prolongada.

| Sonda HTTPS local con vhost correcto | Muestras | Código estable | Mediana | p95 | Máximo |
| --- | ---: | --- | ---: | ---: | ---: |
| Heaven's Gate | 96 | **200** | 135,06 ms | 150,21 ms | 170,22 ms |
| Foro | 96 | **200** | 140,39 ms | 158,34 ms | 176,33 ms |
| Proxy existente, raíz | 96 | **404**, igual al baseline | 47,57 ms | 57,27 ms | 63,65 ms |

Las mismas respuestas se comprobaron antes del piloto, al detenerlo y después del rollback. Se usó `curl -k` local con SNI/Host correcto para disponibilidad, no para validar certificados externos. No hubo login ni modificación de archivos de estas aplicaciones. Estas sondas acreditan disponibilidad anónima y estabilidad de procesos, no todos los flujos internos ni todos los vhosts del host.

### SSH y limpieza comprobados

1. Se conservó una sesión administrativa con sudo autorizado antes de modificar configuración. El candidato pasó sintaxis y evaluación efectiva para la cuenta objetivo y otra cuenta; se mantuvieron autenticación por clave, forwarding local y MariaDB. Copia privada y rollback preparados antes del reload, **sin restart**.
2. Tras aplicar la excepción, preflight favorable: destino 3400 vacío pero alcanzable. MariaDB entregó saludo sin autenticación SQL y 3401 permaneció denegado. El paquete se transfirió únicamente después del gate.
3. Supervisor detenido por `controller_stop`, sin degradación ni guardas. Túnel propio cerrado; frontend y perfiles cerrados. [Evento de parada](evidencia-armv7-fase6/supervisor-stop.json).
4. **`sshd_config` restaurado byte a byte**, con sus permisos/propietario por el controlador, validación `sshd -t` correcta y reload. Copia privada eliminada. Configuración efectiva final: `PermitOpen 127.0.0.1:3306`, `AllowTcpForwarding local`, `DisableForwarding no`, `GatewayPorts no`.
5. Conexiones nuevas: MariaDB sigue entregando saludo sin autenticación SQL; **3400 y 3401 denegados**. Se confirma que la excepción no quedó activa.
6. SQLite cerrada y reabierta: `integrity_check: ok`, diez tablas previas de metadatos y dos salas, una de ellas de aislamiento. El directorio de datos contenía únicamente `pilot.sqlite` de 122.880 bytes y la fixture sintética privada, ambos eliminados. Sin archivos de imágenes ni nuevas tablas de contenido. No se ejecutó una traza global de escrituras en esta sesión.
7. Antes de borrar: ruta real, propietario, prefijo, ausencia de procesos asociados y puerto libre comprobados. **Raíz del piloto y backup SSH inexistentes; cero Node remoto y ningún listener en 3400.** [Verificación remota](evidencia-armv7-fase6/cleanup-verification.json).
8. Windows: eliminados los dos staging propios, incluidos runtime, paquete, dependencias, caché privada, fixture, probes y controladores. **Cero procesos Node, perfiles Playwright y listeners 8080/13400** del ensayo. Solo se conservan documentos, diagnóstico portable y evidencias saneadas. [Verificación Windows](evidencia-armv7-fase6/windows-cleanup.json).

No se modificaron Apache, MariaDB, Heaven's Gate, DNS, firewall, certificados ni claves autorizadas. No hubo servicio de arranque ni instalación permanente. La excepción SSH autorizada está revertida; otra sesión de piloto requerirá nueva autorización.

### Incidencias del controlador, sin fallos del VTT

- La primera raíz generada mediante `tempfile.mkdtemp` incluyó un carácter no admitido por el patrón del piloto. El guard abortó **antes de transferir o arrancar Node**. Se revirtió SSH byte a byte, se borró exclusivamente ese directorio vacío tras validar propietario/ruta y se cambió el generador temporal a `mktemp -d /var/tmp/naufragio-pilot.XXXXXXXXXX`. Después se repitieron validación, excepción y preflight dentro de la autorización vigente. El primer backup también quedó eliminado.
- Al limpiar, el guard local interpretó `exitCode === null` como proceso activo aunque el túnel ya había terminado por señal. Rechazó la operación conservadoramente. Se comprobó la ausencia real de proceso/listener remoto, se verificó SQLite y se limpió la raíz por un helper acotado a su ruta y propietario. Se cerró solo el PID del controlador Windows identificado por su ruta única, después de confirmar el rollback; no se utilizó una terminación global de Node o SSH.
- La comparación de rutas Windows detectó el alias 8.3 de TEMP frente al nombre largo y abortó sin borrar. Se normalizó el directorio padre real y se repitió la eliminación únicamente de los dos árboles propios previamente verificados. La comprobación final confirma su ausencia.

No hubo fallo de las comprobaciones de juego, `RATE_LIMITED`, error de página o rechazo sin gestionar. Las incidencias anteriores pertenecen a la preparación/limpieza temporal y están resueltas; no se corrigió ni modificó el código del VTT.

### Reproducción y decisiones para la instalación

Usar el [procedimiento existente](PILOTO-PRIVADO-RASPBERRY.md), `pilot-preflight.ps1`, `pilot-ssh-policy.py`, `pilot-supervisor.py` y `pilot-server.js`. El diagnóstico ampliado se conserva en [pilot-browser-phase6.mjs](evidencia-armv7-fase6/pilot-browser-phase6.mjs), sin destinos ni credenciales. Requiere las mismas variables privadas del piloto anterior y añade `PILOT_SMALL_PNG` y `PILOT_LARGE_PNG`; mantener exactamente 12 MiB y el PNG auxiliar para la prueba de interrupción. El frontend debe usar el origen loopback 8080 autorizado. Preparar siempre raíces y SQLite nuevas; no reutilizar las eliminadas.

La copia de arranque debe fijar y comprobar `MAX_MESSAGE_BYTES=65536`, sin cargar el `.env.example` antiguo. El supervisor conserva sus límites externos y debe abarcar todo el recorrido, con cleanup/rollback en `finally`. Para recalcular el resumen con Node 24:

```powershell
node backend/scripts/pilot-metrics.js docs/evidencia-armv7-fase6/samples.jsonl
```

**Aprobación técnica acotada a beta privada de tres clientes.** Antes de instalar permanentemente siguen pendientes la definición del usuario/directorio de servicio, límites y supervisión, backup/restauración de metadatos, acceso privado y ciclo de actualización del runtime. El navegador del director sigue siendo la autoridad y su IndexedDB no está respaldado por SQLite. No se acredita exposición HTTPS/WSS pública, carga con muchas salas ni continuidad más allá del ensayo de cinco minutos. La instalación permanente requiere una tarea/autorización separada.

## Registro anterior a la autorización

<details>
<summary>Preflight inicial bloqueado y propuesta presentada antes del permiso del propietario</summary>

## Estado y veredicto

**Piloto detenido en el preflight, pendiente de autorización expresa para la excepción SSH. NO APTO para aprobar todavía la instalación de la beta privada: no se ha ejecutado el piloto de Fase 6 en esta sesión.**

La [validación definitiva de Windows](VALIDACION-DEFINITIVA-FASE6-WINDOWS.md) acredita las suites seriales Node 22/24, los tres navegadores, el PNG de 12 MiB y la limpieza. No sustituye mediciones ARMv7 de Fase 6. El piloto histórico de [Fases 1–5](PILOTO-PRIVADO-RASPBERRY.md) tampoco se presenta como una prueba de imágenes de Fase 6.

No se ha restablecido la excepción anterior, escrito configuración SSH, recargado servicios, transferido runtime/backend ni iniciado Node en Raspberry. No hay staging, SQLite, túnel o supervisor nuevos del piloto que limpiar. Las conexiones SSH de inspección y preflight terminaron; no se han cerrado conexiones de otras aplicaciones.

## Inspección real de solo lectura

Se leyeron las instrucciones privadas de acceso sin copiar la clave, y se utilizó la identidad indicada. Los destinos, direcciones privadas, rutas de claves y material de autenticación se omiten de este informe. Git estaba en el commit solicitado y conserva los informes anteriores; no hay cambios de código ni tests.

| Comprobación | Resultado observado |
| --- | --- |
| Arquitectura / userland | `armv7l`, 32 bits |
| Sistema | Raspbian GNU/Linux 13 (trixie) |
| Kernel | `6.18.50+rpt-rpi-v7` |
| RAM total | 920 MiB |
| Memoria disponible | 515 MiB en inspección; 516 MiB en preflight |
| Swap total / usada | 919 / 310 MiB |
| Espacio disponible para `/var/tmp` | 53.276 MiB en la raíz de microSD |
| Temperatura | **58,534 °C**, ambas muestras |
| Carga 1/5/15 min | Inspección: 0,00 / 0,03 / 0,06; preflight: 0,27 / 0,09 / 0,08 |
| Apache, MariaDB, SSH, SMB | Activos en inspección |
| Apache, MariaDB, SSH | Activos también en preflight |
| Puerto TCP 3400 | Libre según `ss -ltnH` |
| Procesos Node | Ninguno observado |

La carga de `/proc/loadavg`/`uptime` no es porcentaje de CPU. Las dos muestras de reposo no acreditan estabilidad durante cinco minutos ni memoria bajo transferencia.

Listeners existentes observados: 3306 y 8787 en loopback; 9090 en una interfaz específica; SSH, HTTP/HTTPS y SMB en sus interfaces actuales. No se abrió, ocupó, reutilizó ni modificó ninguno. Apache activo **no acredita por sí solo salud funcional de Heaven's Gate**: sus sondas con vhost correcto y las de las demás aplicaciones quedan para la ejecución autorizada. No se han leído ni tocado archivos de Heaven's Gate.

## SSH actual y preflight

Directivas legibles actuales:

```text
/etc/ssh/sshd_config:12
Include /etc/ssh/sshd_config.d/*.conf

/etc/ssh/sshd_config.d/10-naufragio-hardening.conf:12–13
AllowTcpForwarding local
PermitOpen 127.0.0.1:3306
```

La entrada activa única de `authorized_keys` coincide con la clave pública de la identidad local indicada. No lleva opciones previas: no se observaron `restrict`, `no-port-forwarding` o `permitopen` adicionales. Modo 0600. No se imprimieron claves, huellas ni comentarios de clave.

**Limitaciones actuales de inspección:** `50-cloud-init.conf` no es legible por la cuenta; `sudo -n /usr/sbin/sshd -T -C ...` terminó con exit 1. No se dispone en esta conexión de la autorización sudo temporal. Por tanto, no se afirma haber leído toda la configuración efectiva ni haber validado hoy el candidato con `sshd -t`. La validación histórica no se reutiliza como evidencia actual.

Se ejecutó el script versionado `backend/scripts/pilot-preflight.ps1`, sin modificarlo y con destino remoto 3400. Resultado **exit 1**:

```text
SSH_FORWARDING_DENIED: no iniciar ni transferir el piloto;
requiere una ruta autorizada por operaciones.
```

El script identifica `administratively prohibited` al probar `ssh -W 127.0.0.1:3400`. No se creó un listener ni un túnel alternativo. Es una denegación de forwarding, no un resultado del backend, que todavía no está ejecutándose. Se detuvieron las operaciones remotas tras este gate.

El primer intento de inspección desde el entorno restringido de Windows no pudo iniciar la conexión (`Permission denied`); se repitió con permiso de red y pasó. No fue un cambio de credenciales, daemon o firewall remoto.

## Cambio exacto propuesto — todavía NO aplicado

Repetir únicamente la excepción temporal descrita en [el diagnóstico SSH](DIAGNOSTICO-SSH-PILOTO.md), añadiendo **al final de `/etc/ssh/sshd_config`**:

```text
# Naufragio: excepcion privada de piloto; MariaDB conservado
Match User <cuenta-SSH-del-piloto>
    PermitOpen 127.0.0.1:3306 127.0.0.1:3400
```

El marcador se sustituye por la cuenta exacta de `RASPBERRY_SSH.md`; se muestra al propietario en la solicitud de autorización. No es una orden para aplicar literalmente el marcador.

**Impacto propuesto:** esa cuenta podrá abrir forwarding local al nuevo destino único `127.0.0.1:3400`; se conserva `127.0.0.1:3306`. No cambia el include global, las claves, autenticación, `AllowTcpForwarding`, `GatewayPorts` ni el permiso de otras cuentas. No publica el puerto del backend. El alcance es por cuenta; se ha comprobado que actualmente tiene una sola entrada autorizada.

**Condiciones antes de escribir:** autorización expresa nueva, sesión administrativa conservada con sudo temporal habilitado por el propietario, revisión de la configuración efectiva completa y de cambios concurrentes. Construir el candidato en memoria; validar `sshd -t` y `sshd -T -C` para la cuenta del piloto y otra cuenta. Si los resultados no coinciden exactamente con lo propuesto, detenerse sin aplicar cambios.

**Aplicación, solo si se autoriza y valida:** copia privada del original con propietario/permisos y hash; añadir exclusivamente el bloque; validar nuevamente; hacer **reload de SSH, sin restart**; comprobar un login nuevo y el preflight. Conservar MariaDB y verificar que otros destinos siguen denegados, sin usar esos destinos para el piloto.

**Rollback:** al finalizar o fallar el piloto, detener solo sus procesos y túnel; desde la sesión administrativa abierta verificar ausencia de cambios concurrentes, restaurar el original con sus metadatos, ejecutar `sshd -t` y reload. Comprobar hash idéntico, login nuevo, MariaDB conservada y denegación de 3400 restaurada. Si hubo cambios concurrentes, no sobrescribirlos: detener la operación para revisar la reversión del bloque propio. El controlador existente dispone de rollback y límite temporal; no se ha arrancado en esta sesión.

## Ampliación prevista para Fase 6, tras la autorización

Se utilizarán el procedimiento, supervisor, bootstrap sintético y cliente del [piloto privado existente](PILOTO-PRIVADO-RASPBERRY.md), extendiendo únicamente el diagnóstico de recursos de Fase 6. No se modificará el código del VTT.

1. Repetir preflight y baseline antes de transferir. Mantener las guardas: al menos 384 MiB disponibles antes de arrancar; abortar ante RSS >160 MiB, MemAvailable <192 MiB, temperatura ≥75 °C o degradación de servicios. Confirmar sondas anónimas de Heaven's Gate y demás aplicaciones con su vhost correcto.
2. Crear exclusivamente una raíz privada nueva `/var/tmp/naufragio-pilot.*`. Runtime oficial Node 22.23.4 ARMv7 con hash verificado; backend del commit exacto; dependencias de producción preparadas en Windows sin scripts de instalación; HOME, TMPDIR, SQLITE_TMPDIR, SQLite y logs dentro del árbol. Sin npm ni instalación global remota.
3. Configurar explícitamente `HOST=127.0.0.1`, `PORT=3400` y **`MAX_MESSAGE_BYTES=65536`**, además del origen loopback autorizado. **No reutilizar el antiguo valor 16384 de `.env.example`.** `backend/src/config.js` ya tiene 65536 como valor predeterminado, pero se verificará también la configuración efectiva del proceso antes del ensayo. Heap 64 MiB, `UV_THREADPOOL_SIZE=1`, nice 19, supervisor externo y deadline temporal del procedimiento existente.
4. `dist/` servido en Windows. Un único túnel SSH autorizado, ligado también a loopback en Windows; backend solo en `127.0.0.1:3400`. Tres perfiles reales Edge/Firefox independientes, sin puertos LAN ni publicación.
5. Mapa activo, retratos, nombres/colores, movimientos, permisos y aislamiento; cambio de mapa, incorporación/reconexión y recuperación con el IndexedDB del director. PNG válido de **12.582.912 bytes**, con el hash ya validado en Windows, a dos jugadores; comprobar hash, integridad, ausencia de `RATE_LIMITED` y consumo ARMv7. Interrumpir un receptor y exigir que el director siga conectado y el otro termine.
6. Mantener **al menos cinco minutos de actividad con los tres clientes**, movimientos espaciados y verificaciones de igualdad. Monitorización externa de CPU/RSS, MemAvailable, swap, temperatura, tiempos de `/health` y movimientos, procesos y sondas de aplicaciones durante toda la prueba. No atribuir al piloto de Fase 6 las métricas históricas de Fase 5.
7. Cerrar únicamente recursos propios; recoger evidencias saneadas; comprobar ausencia de listeners, procesos y temporizadores del piloto. Validar ruta real, propietario y prefijo antes de borrar exclusivamente su raíz. Revertir la excepción SSH y verificar servicios y acceso original. No tocar Apache, MariaDB, Heaven's Gate, certificados, DNS ni firewall.

Estas operaciones están **pendientes**, no ejecutadas. No existen todavía métricas de transferencia, CPU/RAM bajo carga, latencia o cinco minutos de estabilidad ARMv7 de Fase 6 en esta sesión.

## Evidencias y trabajo pendiente

Logs de solo lectura, saneados, en Windows:

```text
%TEMP%\naufragio-armv7-fase6-preflight-<identificador-de-la-sesión>
  inspect.txt
  inspect-exit.json
  preflight.txt
  preflight-exit.json
```

El helper local lee la conexión privada sin imprimirla; el script Python de inspección se envía por stdin y no crea un archivo remoto. No se incorporan instrucciones de acceso ni secretos al repositorio.

Pendiente inmediato: autorización expresa para el bloque SSH, el piloto temporal y su rollback, y habilitar sudo temporal por el propietario. Hasta entonces no se prepara ni arranca ningún recurso remoto de piloto y **no se aprueba la instalación de la beta privada**.

</details>
