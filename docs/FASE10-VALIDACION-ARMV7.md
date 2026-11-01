# Fase 10 — Preparación y validación ARMv7

Fecha: **1 de noviembre de 2026**. Veredicto: **APTO CON LIMITACIONES** para preparar una ventana de actualización autorizada.

**No se ha actualizado producción.** El candidato está preparado, la rama está publicada en GitHub y las pruebas focalizadas han pasado. La base real sigue en v4; `current` sigue en Fase 9; Pages conserva los 27 archivos anteriores de `/beta/`. La API pública responde 403. La estabilidad prolongada específica de Fase 10 no está validada.

## 1. Código publicado y correspondencia de evidencias

Rama: `feat/phase10-table-ux`. Código candidato fijado en **`1f19390afd0671e4bf4dd719e1c4a1522101475a`**, árbol `5c6ea98f9d58b46b211e0d2143f136ed41e24720`.

Se verificaron y publicaron los seis commits funcionales y el informe final:

| Commit | Función |
| --- | --- |
| `54c09f3` | Solicitudes QR y panel de jugadores |
| `ab2f593` | Mapas confirmados y límites autorizados |
| `d046932` | Edición contextual de fichas |
| `c532dc4` | Dados verificados, permisos e historial |
| `a2ce974` | Consolidación responsiva y pruebas de navegador |
| `ebcc3d1` | Candidato local y rollback mediante copia |
| `1f19390` | Informe de implementación y evidencias |

La rama se subió mediante `git push -u origin feat/phase10-table-ux`; `ls-remote` confirmó el SHA. No hubo merge ni escritura en estas ramas:

| Rama conservada | SHA |
| --- | --- |
| `feat/backend-multijugador` | `6a96591d5a5993f6211d9b0f2b8b9d11386b0d0c` |
| `deploy/phase9-beta` | `4a6ba2c10fbb0bd0a0dd660ad165b152e9ca0000` |
| `main` | `37edf0d691cc807335f3020eb12182b643634312` |

Se extrajo un `git archive` del SHA exacto, fuera del árbol de trabajo. Sobre ese snapshot se repitieron **129/129 pruebas Node** y la aceptación real Edge/Firefox con `dist`, polling, táctil y mapa de 12 MiB. El recuento anterior de 128 correspondía a la suite anterior a incorporar la última prueba de rollback; el snapshot final contiene 129. No se reconstruyó el candidato desde archivos sueltos o modificaciones locales.

Backend, frontend y el candidato completo de Pages proceden del mismo SHA. La configuración pública se incorpora desde `backend/deploy/site.config.json` del snapshot, y el frontend se construye con `storageNamespace: 'phase9-beta'`.

Evidencias:

- [Procedencia, siete commits completos y hashes](evidencia-fase10-armv7/provenance.json).
- [129 pruebas Windows sobre el snapshot exacto](evidencia-fase10-armv7/tests-windows-exact-1f19390.txt).
- [Aceptación Edge/Firefox del mismo snapshot](evidencia-fase10-armv7/browser-exact-1f19390.json).

Los commits posteriores de esta rama añaden verificadores, métricas y este informe; no modifican el código de aplicación candidato de `1f19390`. Se identifican con `git log` y el seguimiento `origin/feat/phase10-table-ux`. Se conservan fuera de esos commits las modificaciones previas de documentación y evidencia ARMv7/Windows ajenas al encargo.

`a83f0f9` añade los verificadores y las evidencias ARMv7. El commit de este informe se identifica con `git log -1 -- docs/FASE10-VALIDACION-ARMV7.md`; ambos se publican en la misma rama de trabajo, conservando el candidato fijado en `1f19390`.

## 2. Baseline y aislamiento de Raspberry

Antes de preparar el staging: VTT `inactive/dead`, `MainPID=0`, sin Node ni listener 3400. No había una partida atendida por ese backend. No se interrumpió ningún usuario. Release actual: `/opt/naufragio-vtt/releases/phase9-beta`.

Baseline registrado: carga `0.35 / 0.15 / 0.11`, memoria disponible **513,24 MiB**, temperatura **59,07 °C**, SSD con **82,52 GiB disponibles**. El montaje efectivo era `/dev/sdb1`, ext4, `rw,noatime`; no se asumió el nombre de dispositivo de informes anteriores. No aparecieron errores de E/S o ext4 en la consulta del kernel de la última hora. No se instaló SMART ni se realizó un diagnóstico físico completo del disco.

Se reutilizó **Node v22.23.4 ARMv7** instalado:

```text
runtime SHA-256:
407b390f1667066e55cb36c8622e79d6d488aed417d072487bfbe92f47829d6b

supervisor instalado SHA-256, sin cambios:
66493462bcadc49f7c0e994a076724e3f45c86fa22245ddd298bd91a69fa6c51
```

Staging privado: `/mnt/ssd/naufragio-phase10-1f19390`, propiedad del operador y modo 0700. No se instaló software ni se cambiaron servicios existentes. Las dependencias de prueba se transfirieron fijadas por lockfile; el release final reutiliza una copia de las dependencias de ejecución inmutables de Fase 9, que no han cambiado.

Las tandas de pruebas se ejecutaron secuencialmente en unidades transitorias **del usuario**, con cuota CPU 100 %, watchdog 10 s, heap Node 64 MiB, `TasksMax=32`, `LimitNOFILE=1024`, `LimitCORE=0` y cierre de todo el grupo. El monitor de las tandas importa de solo lectura las funciones de guardas y sondas del supervisor instalado. El recorrido funcional ejecutó ese supervisor **íntegro y sin parches**, con el backend candidato y una SQLite sintética por loopback.

Umbrales conservados: RSS sumado Node + supervisor ≤160 MiB, `MemAvailable` ≥192 MiB, disponibilidad inicial ≥384 MiB, temperatura <75 °C y watchdog activo de 10 s. No se elevaron para pasar pruebas. Se conservó la vigilancia de servicios, latencia de sondas, salud, señales y fin del hijo al cerrar el supervisor. La ventana de validación se acotó a 900 s por unidad; no se aumentó la duración del servicio real.

El archivo de la unidad real sigue configurando `WatchdogSec=10`; la unidad detenida muestra `WatchdogUSec=infinity`. En las unidades de validación activas se verificó `WatchdogUSec=10s`. No se arrancó el servicio real para comprobar su estado de watchdog en ejecución; deberá confirmarse al activar la ventana autorizada. `MemoryMax=infinity` sigue sin aportar contención dura: se mantiene la guarda externa existente, sin cambiar kernel ni arranque.

[Baseline completo](evidencia-fase10-armv7/baseline.json).

## 3. Protección y ensayo de datos reales

El propietario abrió la ventana sudo prevista por el procedimiento local. Solo se utilizó para backup, preparación independiente y lecturas de verificación. Nunca se introdujeron contraseñas reales en los clientes de prueba.

Se leyó exclusivamente la ruta efectiva de SQLite de `/etc/naufragio-vtt/backend.env`, sin imprimir el resto de su contenido. Ruta confirmada:

```text
/mnt/ssd/naufragio-vtt/data/naufragio.sqlite
```

Contenía una cuenta administrativa habilitada. Se ejecutó el procedimiento de backup online **ya instalado**, como `naufragio-vtt`, y se comprobaron `integrity_check` y `foreign_key_check`.

| Copia privada | Resultado |
| --- | --- |
| `/mnt/ssd/naufragio-vtt/backups/phase10-1f19390/real-v4.sqlite` | Backup consistente v4 de la base real |
| `…/migration-v7.sqlite` | Migración v4→v7 ensayada exclusivamente en copia |
| `…/rollback-v4.sqlite` | Copia compatible v4 generada desde la v7 mediante el script de Fase 10 |

Se compararon íntegramente usuarios, roles, estado habilitado, hashes de contraseña, pertenencias/permisos y etiquetas; los valores sensibles se compararon internamente, sin publicarlos. **La cuenta administrativa y sus permisos sobreviven a ambos recorridos.** La base original conservó su contenido, esquema v4 y su SHA durante el ensayo; al cierre volvió a compararse su identidad con el backup v4.

La v7 ensayada y sus backups permanecen privados. No se arrancó el backend antiguo sobre una v7. No se abrió, exportó, borró ni alteró el IndexedDB real del director; los navegadores de aceptación usan contextos sintéticos separados.

Estas copias en el mismo SSD sirven para recuperación lógica de una actualización; no sustituyen la cápsula cifrada de recuperación en NAS existente ni constituyen un backup físico independiente del SSD.

[Resultado del ensayo real](evidencia-fase10-armv7/real-copy-result.json).

## 4. Pruebas focalizadas ARMv7

| Tanda | Resultado |
| --- | --- |
| Admisión, límites, dados, migración y persistencia | **18/18** — [registro](evidencia-fase10-armv7/core-tests.txt) |
| Autoridad, permisos, presencia y reconexión | **23/23** — [registro](evidencia-fase10-armv7/authority-tests.txt) |
| Recursos, integridad y limpieza de transferencias | **5/5** — [registro](evidencia-fase10-armv7/media-tests.txt) |
| Recorrido funcional sobre el backend candidato supervisado | **Superado** — [resultado](evidencia-fase10-armv7/functional-result.json) |
| Persistencia tras parar y recrear la instancia sintética | **Superada** — [resultado](evidencia-fase10-armv7/restart-result.json) |

Total: **46 pruebas automatizadas ARMv7**, además del recorrido funcional y del reinicio.

El recorrido funcional nativo comprobó:

- Dos solicitudes pendientes, aprobación de una y rechazo de otra; alta de dos invitados sintéticos, presencia y permisos.
- Autoridad de fichas, asignación y manifiesto público con nombre/tamaño editados. Ninguna publicación de mapa antes de la confirmación del cliente.
- PNG válido de **12.582.912 bytes** enviado íntegro a dos clientes con backpressure y SHA-256, en **46,397 s**. Hash: `a2e3746c1868784497823516735ecbe951f11fecfa813cf5e46425e62aacfe59`.
- Límites derivados del mapa desplazado, rectángulo fraccionario personalizado, rechazo de un movimiento construido fuera del área y confirmación de otro permitido.
- `2d6+3` idéntico en director y participantes, rechazo de duplicados, resultados suministrados por cliente y tiradas sin permiso.
- Reconexión con recuperación de mapa e historial; tras reiniciar la instancia, persistencia de SQLite, límites y restauración de la autoridad sintética original.

La prueba de interfaz —contador con QR cerrado, edición contextual, vista previa, selección/arrastre, cancelación y controles táctiles— se repitió en Edge/Firefox sobre el snapshot exacto en Windows. Las pruebas nativas ARMv7 utilizaron clientes de protocolo por loopback. **No se declara un navegador físico conectado de extremo a extremo a esta versión en Raspberry**, ni una validación pública Fase 10 de Pages → Apache → backend. No se modificó SSH para obtener un túnel ni se abrió una ruta pública de prueba.

## 5. Mediciones y disponibilidad

516 muestras en las tandas y recorrido. Son observaciones focalizadas, no un ensayo continuo de tres horas ni garantía de capturar todo pico instantáneo.

| Etapa | RSS máximo Node + supervisor | MemAvailable mínimo | Temperatura máxima | CPU Node observada |
| --- | --- | --- | --- | --- |
| Pruebas de funciones básicas | 135,68 MiB | 423,88 MiB | 64,99 °C | 139,04 s |
| Autoridad/presencia | 125,35 MiB | 354,24 MiB | 68,76 °C | 283,29 s |
| Recursos | 119,29 MiB | 459,76 MiB | 66,60 °C | 43,37 s |
| Backend funcional y reinicio | **116,43 MiB** | **319,58 MiB** | **67,68 °C** | **25,14 s** |

Las tres primeras filas miden el proceso de pruebas, con sus fixtures y clientes, más el monitor. La última mide el backend separado y el supervisor real. El conductor de clientes nativos tuvo un RSS máximo adicional de **237,37 MiB**; no pertenece al backend desplegable. Sus recursos sí afectan a `MemAvailable` del host. No se usa su memoria para atribuir consumo al backend ni se compara la prueba de loopback con rendimiento WAN.

No se dispararon guardas. Los cuatro servicios vigilados conservaron estado y PIDs: Apache `31389`, MariaDB `868`, SSH `803`, SMB `1029`.

| Sitio | Sondas durante pruebas | Código observado | Mediana / máximo |
| --- | --- | --- | --- |
| Heaven's Gate | 88 | 200 | 328,62 / 393,82 ms |
| Foro | 87 | 200 | 321,96 / 438,59 ms |
| Proxy | 87 | 404 esperado | 226,91 / 402,03 ms |
| Bibprof | 85 | 200 | 341,73 / 541,16 ms |
| Ordenanthia | 85 | 200 | 244,75 / 384,02 ms |
| Galería | 84 | 200 | 237,33 / 354,28 ms |

Sin respuestas inesperadas ni cambios de PIDs. Las sondas validaron certificados, sin `curl -k`. Al cierre, seis sondas adicionales correctas, temperatura 60,69 °C y **82,51 GiB** disponibles en SSD.

[Resumen calculado](evidencia-fase10-armv7/metrics-summary.json), [métricas funcionales](evidencia-fase10-armv7/functional-metrics.jsonl), [estado final](evidencia-fase10-armv7/final-host.json). Se conservan también las series de cada tanda en el mismo directorio.

## 6. Candidato preparado y riesgos

Release independiente y de solo lectura, propiedad de root:

```text
/opt/naufragio-vtt/releases/phase10-1f19390/backend
/opt/naufragio-vtt/releases/phase10-1f19390/frontend
```

No se cambió `current`. El release contiene el supervisor idéntico al instalado, código de `1f19390` y dependencias de ejecución ya verificadas. No incluye la SQLite real ni secretos de sesión del director.

Candidato local para revisión:

```text
artifacts/phase10-validation/candidate-1f19390/backend-source.zip
artifacts/phase10-validation/candidate-1f19390/dist/
artifacts/phase10-validation/candidate-1f19390/pages-candidate.zip
```

El ZIP de Pages preserva byte a byte los **9 archivos ajenos a `/beta/`** de la rama de publicación y prepara 29 archivos en `/beta/`, incluido el manifiesto. No crea commits ni publica en esa rama. [Hash y comprobación](evidencia-fase10-armv7/pages-candidate.json).

Configuración candidata confirmada: API y tiempo real `https://api.naufragio.net`, Socket.IO `/socket.io`, namespace local `phase9-beta`. Se conservan nombres y claves de IndexedDB de autoridad y recursos.

Limitaciones y riesgos expresos:

1. No hay ensayo prolongado de Fase 10 ni partida humana de tres horas. No se repitió automáticamente Fase 9, pues supervisor y duración no cambian.
2. La aceptación de navegador y la de protocolo ARMv7 son pruebas complementarias separadas; falta el recorrido público completo tras autorizar la actualización y los dispositivos físicos Android/iOS.
3. La contención de memoria sigue siendo externa; no se añadió un controlador duro ni se cambió el arranque. Confirmar watchdog efectivo al arrancar la unidad real durante la futura ventana.
4. Los backups reales ensayados son una fotografía de esta preparación. Si se vuelve a utilizar Fase 9 antes de actualizar, **crear otro backup consistente y volver a comprobar identidades**; no activar ni restaurar a ciegas las copias antiguas de este ensayo.
5. Durante la preparación, un tar generado en Windows conservó atributos de solo lectura de directorios e impidió una primera extracción. Se corrigió exclusivamente en staging, se reextrajo sin aplicar esos atributos y se verificaron todos los hashes del manifiesto. No se cambiaron archivos del release anterior.
6. Al detener una unidad transitoria, systemd la descargó; el primer intento de `start` posterior no encontró la unidad y el cliente recibió conexión rechazada. Se recreó la unidad con idénticas propiedades y la misma base sintética; la comprobación de persistencia pasó. No fue un fallo de recuperación del backend ni hubo restart del servicio real.
7. Pages responde con **`Cache-Control: max-age=600`** y los assets mantienen sus rutas/versiones anteriores. Una pestaña ya abierta puede conservar código de Fase 9. En la ventana autorizada, hacer recarga completa de recursos y comprobar los nuevos controles antes de admitir jugadores; si no se puede forzar esa recarga, esperar la caducidad de caché y reabrir las pestañas. **No usar borrado de datos del sitio, perfiles ni IndexedDB.** [Encabezados verificados](evidencia-fase10-armv7/pages-cache.json). El candidato no introduce una estrategia nueva de versionado de assets.

## 7. Procedimiento de actualización coordinada — NO EJECUTADO

Requiere **otra autorización expresa del propietario** para sustituir release, cambiar la ruta efectiva de datos y publicar Pages. Mantener la API cerrada durante la operación. No modificar Apache, DNS, certificados, SSH, firewall, kernel ni arranque para realizar este procedimiento. La eventual apertura pública de la ventana corresponde al procedimiento operativo existente y a su autorización posterior; no se ha ejecutado aquí.

1. Volver a verificar `naufragio-vtt` inactivo, ausencia de Node/listener 3400 y de participantes. Si hay actividad, detener esta actualización sin interrumpirla. Comprobar que las ramas conservadas y los 426 archivos del release anterior aún corresponden al baseline; si cambiaron, revisar el candidato.
2. Guardar una copia privada nueva de configuración y frontend publicado, sin imprimir secretos. Crear backup online nuevo de la **ruta efectiva** real con `database-backup.js`, como usuario VTT. Validar integridad, claves foráneas e identidades antes de continuar.
3. Crear una **nueva base de trabajo** v7 dentro de `/mnt/ssd/naufragio-vtt/data/`, a partir del backup recién creado; conservar la original v4. Aplicar `openStorage` del release Fase 10 únicamente sobre esa nueva copia y comparar usuarios/permisos. Los archivos de `backups/phase10-1f19390` son ensayos: no reemplazan este backup fresco.

   Ejemplo, en la ventana autorizada y con destinos nuevos:

   ```bash
   # Como root. Estos comandos NO se han ejecutado contra producción.
   phase10_stamp=$(date -u +%Y%m%dT%H%M%SZ)
   phase10_backup=/mnt/ssd/naufragio-vtt/backups/update-$phase10_stamp
   phase10_next=/mnt/ssd/naufragio-vtt/data/phase10-$phase10_stamp.sqlite
   install -d -m 0700 -o naufragio-vtt -g naufragio-vtt "$phase10_backup"
   runuser -u naufragio-vtt -- /opt/naufragio-vtt/runtime/bin/node \
     /opt/naufragio-vtt/releases/phase9-beta/backend/scripts/database-backup.js \
     /mnt/ssd/naufragio-vtt/data/naufragio.sqlite "$phase10_backup/real-v4.sqlite"
   runuser -u naufragio-vtt -- /opt/naufragio-vtt/runtime/bin/node \
     /opt/naufragio-vtt/releases/phase9-beta/backend/scripts/database-backup.js \
     "$phase10_backup/real-v4.sqlite" "$phase10_next"
   runuser -u naufragio-vtt -- /opt/naufragio-vtt/runtime/bin/node --input-type=module -e \
     "import {openStorage} from 'file:///opt/naufragio-vtt/releases/phase10-1f19390/backend/src/storage.js';const s=openStorage(process.argv[1]);s.close();" \
     "$phase10_next"
   ```

   La ruta de origen del ejemplo es la verificada hoy; resolverla de nuevo antes de usarlo. No copiar una SQLite viva con `cp` omitiendo WAL.

4. Editar **solo** `DATABASE_PATH` en `/etc/naufragio-vtt/backend.env` para apuntar a `phase10_next`, conservando todas las credenciales, límites, sondas y valores de supervisor. No volcar el archivo a consola ni a Git. Con servicio detenido, cambiar atómicamente el symlink `current` al release preparado, verificando antes que sigue apuntando a Fase 9. Conservar el destino anterior; no reemplazar su contenido.
5. Iniciar el nuevo backend en la ventana atendida con la API aún cerrada. Verificar `READY`, salud interna del supervisor, watchdog activo 10 s, ausencia de guardas e integridad de datos. El backend antiguo no debe abrir la nueva v7.
6. En un worktree independiente basado en el tip vigente de `deploy/phase9-beta`, aplicar **solo** el contenido candidato de `/beta/`. Comprobar que no hay diff fuera de esa carpeta y que se conservan namespace y URLs. Crear el commit de publicación y hacer push a esa rama **solo con la autorización de actualización**. No hacer merge a `main` ni actualizar la rama de aplicación como parte implícita de este paso.
7. Esperar a que Pages complete el build y comparar los archivos servidos con el manifiesto candidato. Resolver también la caché HTTP de las pestañas sin borrar almacenamiento: recarga completa o caducidad de los 600 s y reapertura, seguida de comprobación de los controles Fase 10. Hasta entonces mantener cerrada la admisión pública: nunca servir un frontend Fase 10 a un backend Fase 9 accesible.
8. Abrir la ventana pública únicamente con el procedimiento existente autorizado. Comprobar la cadena real Pages → API, solicitudes con QR cerrado, aprobación/rechazo, presencia, edición, mapa, límites y dados con permisos; revisar seis sitios, RSS, CPU y temperatura. Los participantes deben recargar el frontend durante esta ventana sin partida activa.
9. Si falla una comprobación material, cerrar la ventana y realizar el rollback siguiente. Registrar el SHA Pages efectivamente publicado, ruta efectiva de SQLite y hashes de ambos componentes.

## 8. Rollback coordinado sin pérdida de cuentas — preparado, NO ACTIVADO

1. Cerrar la ventana mediante el procedimiento existente y confirmar servicio sin participantes. Detener únicamente el servicio VTT autorizado y mantener la API cerrada hasta completar el retorno de ambos componentes.
2. Crear backup online consistente de la **v7 actual**, en directorio privado nuevo. No usar automáticamente la v4 anterior si hubo altas, permisos o sesiones posteriores.
3. Generar una copia v4 compatible desde esa v7 mediante el script ensayado:

   ```bash
   # Como root, únicamente durante el rollback autorizado.
   runuser -u naufragio-vtt -- /opt/naufragio-vtt/runtime/bin/node \
     /opt/naufragio-vtt/releases/phase10-1f19390/backend/scripts/rollback-phase10.js \
     RUTA_DEL_BACKUP_V7_ACTUAL RUTA_NUEVA_V4_COMPATIBLE
   ```

   Los destinos deben ser nuevos, privados y accesibles al usuario VTT. Validar `integrity_check`, `foreign_key_check` y comparación completa de usuarios/permisos. La v7 original y sus copias se conservan, incluidos dados y límites que el backend anterior no entiende.

4. Apuntar `DATABASE_PATH` a la **copia compatible nueva** y `current` a `/opt/naufragio-vtt/releases/phase9-beta`, sin modificar ese release ni perfiles del navegador. No arrancar Fase 9 contra una v7.
5. Revertir únicamente el commit de publicación de `/beta/` sobre la rama de Pages, sin force push ni cambios en la raíz. Esperar build y verificar los hashes anteriores antes de abrir la API. Restaurar backend y frontend como pareja.
6. Verificar autoridad/IndexedDB del director, cuenta administrativa, pertenencias, seis sitios y recursos. Si no se puede garantizar la conservación de las escrituras actuales, mantener cerrada la ventana y preparar corrección hacia delante. No ejecutar el rollback destructivo de fases antiguas.

## 9. Estado final

- Raspberry `armv7l`: producción **inactive, disabled, MainPID=0**; cero procesos Node y ningún listener 3400. Unidades sintéticas detenidas; ninguna unidad nueva habilitada al arranque.
- `current` permanece en Fase 9. **426 archivos del release anterior idénticos**; runtime y supervisor conservan sus hashes. Release candidato preparado y separado.
- SQLite real **v4**, una identidad administrativa preservada, copias privadas verificadas. IndexedDB real del director sin intervención.
- Pages sigue en `deploy/phase9-beta` Fase 9. **27/27 archivos servidos coinciden antes y después**; API pública 403. [Comprobación anterior](evidencia-fase10-armv7/pages-before.json) y [posterior](evidencia-fase10-armv7/pages-after.json).
- Cuatro servicios y seis sitios disponibles, sin cambios de PIDs. Sin modificaciones de Apache, DNS, certificados, SSH, firewall, kernel, parámetros de memoria o arranque.
- Rama de trabajo publicada; verificadores y este informe se guardan en commits propios, excluyendo las modificaciones ajenas preexistentes.

**APTO CON LIMITACIONES:** listo para solicitar autorización de una actualización real coordinada. No equivale a autorización de despliegue, funcionamiento continuo, validación pública de Fase 10 ni ensayo de estabilidad prolongada.
