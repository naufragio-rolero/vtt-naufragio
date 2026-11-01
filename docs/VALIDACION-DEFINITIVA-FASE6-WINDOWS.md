# Validación definitiva de Fase 6 en Windows

**Veredicto: APTO para un piloto ARMv7 controlado.**

Sesión iniciada el 29 y terminada el **30 de octubre de 2026**, zona Europe/Madrid. Rama `feat/backend-multijugador`, commit **`5d5eee5800a3112730cace8f97f5a175ce807d91`**.

Las suites completas seriales de Node **22.23.4** y **24.18.0** terminan con **103/103 pruebas superadas, exit 0 y cero pruebas fallidas, canceladas u omitidas**. También pasan la prueba nueva de temporizadores, la aceptación real Edge/Firefox, el PNG válido de 12 MiB para dos jugadores, la interrupción y la limpieza explícita.

No se ha modificado código ni tests del proyecto. No se han realizado commits, merges, pushes, accesos a Raspberry ni cambios de servicios.

## Preparación, identidad y ejecución secuencial

- Git comprobado antes de actualizar. Se conservan los tres informes anteriores sin seguimiento.
- Actualización al commit solicitado, disponible localmente. Windows bloqueó el reemplazo de `backend/package.json` con `unable to unlink ... Invalid argument`. Se recuperaron los tres archivos cambiados mediante sus blobs exactos de Git y se completó el índice; no se aplicaron correcciones al código.
- Exportación limpia mediante `git archive` a TEMP. Comprobación inicial y final de **107 archivos** frente a los blobs del commit: **cero diferencias**.
- `npm ci --ignore-scripts` con Node 22: **exit 0**, 24 paquetes, **31,522 s de proceso**. Se utilizaron esas dependencias del lockfile con ambos runtimes, sin reutilizar el `node_modules` del workspace.
- Versiones comprobadas: Node **22.23.4**, Node **24.18.0**, Playwright **1.56.1**, Edge **156.0.4314.50**, Firefox **142.0.1**.
- Cuentas, contraseñas, imágenes y SQLite exclusivamente sintéticos. Perfiles de navegador independientes y temporales.

Orden efectivo:

1. Instalación; prueba de temporizadores Node 22; `npm run test:serial` Node 22.
2. Prueba de temporizadores Node 24; `npm run test:serial` Node 24.
3. Build y auditoría de `dist/`.
4. Playwright original en ambas rutas.
5. Playwright con PNG de 12 MiB; transferencia con backend aislado Node 22 y después Node 24.
6. Interrupción Node 22 y después Node 24.
7. Diagnósticos explícitos de temporizadores y errores, uno tras otro; comprobación de procesos.

Cada operación terminó antes de comenzar la siguiente. `sequence-audit.json` compara las marcas UTC de inicio y fin de las **20 operaciones instrumentadas**, incluido el intento de diagnóstico con codificación incorrecta descrito abajo: **cero solapamientos**. Dentro de cada ensayo multijugador, los tres clientes se conectan simultáneamente por ser el escenario que se valida.

Raíz de evidencias, exportación y diagnósticos, fuera del repositorio:

```text
%TEMP%\naufragio-fase6-definitiva-e4d9787c2ed14dd284ff7d3eb47189d0
```

## Suites completas y prueba de temporizadores

| Runtime | Comando | Superadas | Fallidas / canceladas / omitidas | Duración del runner, ms | Exit |
| --- | --- | ---: | --- | ---: | ---: |
| 22.23.4 | `node --test tests/asset-client-timers.test.js` | 1/1 | 0 / 0 / 0 | 299,532 | 0 |
| 22.23.4 | `npm run test:serial` | **103/103** | **0 / 0 / 0** | 268986,0487 | **0** |
| 24.18.0 | `node --test tests/asset-client-timers.test.js` | 1/1 | 0 / 0 / 0 | 358,8958 | 0 |
| 24.18.0 | `npm run test:serial` | **103/103** | **0 / 0 / 0** | 235297,6153 | **0** |

`test:serial` ejecuta `node --test --test-concurrency=1`. Se fijó el ejecutable de cada runtime y su directorio al inicio del PATH de npm, para que el comando del script utilizase esa misma versión de Node.

La aserción de sustitución del manifiesto que fallaba en `5ad09912` pasa tanto aislada como dentro de ambas suites. Ninguna suite se interrumpió, filtró ni repitió para sustituir un resultado fallido. Los timeouts de la ejecución conjunta anterior no se reproducen en estas suites seriales.

## Build y auditoría pública

`npm run build:frontend` desde la copia limpia: **exit 0**, 1,769 s de proceso.

| Auditoría de `source/dist/` | Resultado |
| --- | --- |
| Contenido | 18 archivos públicos y `manifest.json` |
| Bytes de los archivos públicos, sin manifiesto | 187.359 |
| Hashes SHA-256 contra manifiesto | 18 correctos |
| Archivos inesperados | 0 |
| Rutas privadas, backend, dependencias, bases de datos o claves | 0 |
| Patrones comprobados de claves privadas y tokens de sesión/alta | 0 coincidencias |

Los adaptadores públicos de IndexedDB son código del cliente, no datos del usuario. La auditoría de rutas, lista pública y patrones no constituye una detección universal de secretos. El frontend publicado y GitHub Pages permanecen intactos; solo se generó el artefacto de la copia temporal.

## Playwright original: tres clientes y dos rutas

Aceptación **original sin cambios**, sirviendo `dist/`, con Node 24: **exit 0**, **135,493 s de proceso**.

| Ruta | Director | Jugadores | Resultado |
| --- | --- | --- | --- |
| `/` | Edge | Firefox y Edge, contextos separados | Superado |
| `/vtt/` | Firefox | Dos contextos Edge independientes | Superado |

También pasa el modo local sin backend en ambos motores. La ruta secundaria utiliza el prefijo Socket.IO `/transport/socket.io`.

Comprobaciones superadas: autenticación e invitaciones, mapa inicial y cambio de mapa, PNG corregido y retrato público, movimientos convergentes y versiones finales `[1, 1]`, denegación de movimiento no autorizado en interfaz y socket directo, asignaciones, director desconectado y sala en espera, recuperación con IndexedDB y recarga, bloqueo de segunda pestaña mediante Web Locks y rechazo de un contexto sin estado oficial.

Se conserva el tablero local al abandonar: JSON, identificadores y blob original del mapa. Cero errores `pageerror` en las aserciones. Pasan las comprobaciones de higiene de secretos en localStorage de la aceptación.

Firefox se ejecutó con permiso para lanzar sus subprocesos de pestañas fuera del entorno restringido, como en las validaciones anteriores. No se deshabilitó su sandbox ni se modificó su configuración de seguridad.

## PNG real de 12 MiB: navegadores y backend aislado

Archivo sintético válido: PNG RGBA **1740 × 1740**, con ruido de píxeles y un bloque auxiliar PNG con CRC válido para alcanzar exactamente **12.582.912 bytes**. No se utilizó un buffer arbitrario etiquetado como imagen.

```text
SHA-256: 2710f8b7a6de0fb7eb31cff6aedda3bfccc2572849fb16a9ab9db5c76d193208
```

### Tres navegadores

Una extensión temporal del diagnóstico anterior importa los módulos de la exportación actual. Carga el archivo por `#sharedMapUpload`, exige el hash del blob usado para renderizar y el mapa decodificado en los tres contextos. Después vuelve al mapa pequeño y repite movimientos, permisos y recuperación. No altera producto ni tests versionados.

| Escenario | Tiempo hasta los tres clientes | Pico RSS Node del ensayo | CPU usuario / sistema |
| --- | ---: | ---: | ---: |
| `/`: director Edge, jugadores Firefox/Edge | 37,200 s | 182,77 MiB | 4,578 / 0,641 s |
| `/vtt/`: director Firefox, jugadores Edge/Edge | 33,081 s | 215,50 MiB | 4,141 / 0,781 s |

Aceptación ampliada completa: **exit 0**, **150,065 s de proceso**. Los tres blobs tienen el tamaño y hash esperados. Pasan también el flujo posterior de movimientos y recuperación y las aserciones de errores de página.

El RSS de esta tabla incluye backend y controlador Playwright; **excluye los procesos de Edge/Firefox**. Las capturas conservadas muestran al director; la igualdad de los tres clientes se acredita mediante aserciones, no mediante tres capturas simultáneas.

### Backend en proceso separado

Ensayo con el cliente real `createAssetClient`, tres conexiones y límites de protocolo sin ampliar. Cada uno de los dos jugadores recibe **12.582.912 bytes** con el SHA-256 indicado. Director conectado, errores `[]`, **sin `RATE_LIMITED`**. Los dos ensayos terminan con exit 0.

| Medición | Node 22.23.4 | Node 24.18.0 |
| --- | ---: | ---: |
| Tiempo de transmisión a ambos | 30,959 s | 31,206 s |
| Pico RSS backend | 84,07 MiB | 89,54 MiB |
| RSS final backend | 74,57 MiB | 76,64 MiB |
| Heap usado final | 18,06 MiB | 15,85 MiB |
| CPU usuario acumulada | 6,656 s | 4,812 s |
| CPU sistema acumulada | 1,390 s | 1,218 s |
| Plazos de descarga creados / activos tras cerrar | **2 / 0** | **2 / 0** |

Muestreo RSS cada 10 ms. CPU y pico incluyen preparación de cuentas y backend; no dividir esa CPU por el tiempo de transmisión para inferir utilización. Son mediciones locales Windows x64, no de ARMv7 ni de memoria total de los navegadores.

## Transferencia interrumpida

Se desconecta un receptor cuando recibe el **primer fragmento** del PNG de 12 MiB. El otro debe completar el archivo con el hash correcto y el director permanecer conectado. Después se observan otros 12,5 s.

| Resultado | Node 22.23.4 | Node 24.18.0 |
| --- | ---: | ---: |
| Segundo jugador: bytes y SHA-256 correctos | Sí | Sí |
| Tiempo de descarga restante | 16,604 s | 17,635 s |
| Director conectado después de la espera | Sí | Sí |
| Pico RSS backend | 83,64 MiB | 89,48 MiB |
| Temporizadores de 600 s activos tras cerrar | **0** | **0** |
| Exit del ensayo | **0** | **0** |

Se registran los errores recuperables esperados `TRANSFER_INTERRUPTED` y `TRANSFER_NOT_FOUND` de la operación cancelada. No aparecen `RATE_LIMITED`, `key is not defined` ni `TRANSFER_TIMEOUT` tardío; el segundo jugador no pierde su transferencia.

## Limpieza comprobada explícitamente

Se repitió **sin modificar** `residual-timer.mjs` del informe anterior, con ambos runtimes. Ambos terminan con exit 0 y:

```json
{"downloaded":true,"errors":[],"activeAfterClose":0,"timeoutMs":[],"expectedActiveAfterClose":0}
```

El diagnóstico adicional `residual-lifecycle-awaited.mjs` observa handles de **600.000 y 12.000 ms**, esperando hitos concretos. Resultado con Node 22 y 24:

| Ruta | Plazos de descarga tras la operación | Tras `close()` |
| --- | ---: | ---: |
| Completar con SHA-256 correcto | 0 | 0 |
| Cancelar mediante `assets:failed` | 0 | 0 |
| Cerrar pendiente | 0 | 0 |
| Desconectar | 0 | 0 |
| Perder autoridad del director | 0 | 0 |
| Sustituir manifiesto | 1 nuevo; anterior cancelado | 0 |

**Exit 0 en ambos, cero handles instrumentados activos y cero rechazos sin gestionar.** La medición de las transferencias reales también comprueba cero plazos activos antes de restaurar la instrumentación o ejecutar su salvaguarda de limpieza.

Se fuerza además un rechazo de fragmento del emisor y se observan **12,5 s por runtime**. Resultado: solo `TRANSFER_NOT_FOUND`, `unhandled: []`, exit 0. No hay error de variable `key` ni rechazo diferido de timeout.

Comprobación final: **0 procesos Node y 0 procesos con perfiles Playwright temporales**. No queda un proceso del ensayo que mantenga backend, conexiones o temporizadores. Esto no exige eliminar estados TCP `TIME_WAIT` de Windows ni afecta a conexiones de otras aplicaciones.

Los cuatro directorios de datos de medición contienen únicamente SQLite sintético de **122.880 bytes** cada uno, con diez tablas previas de identidad/salas/permisos y `integrity_check: ok`. No aparecen imágenes ni tablas nuevas de contenido en esos directorios. No se afirma una traza global de todas las escrituras de Windows.

## Incidencia del diagnóstico y errores reproducibles

**Ningún fallo de producto ni de los tests versionados en esta validación.** Hubo un intento fallido del script temporal ampliado, antes de cargar el archivo grande:

```text
stage: / signup invitation UI
locator.click: Timeout 20000ms exceeded
```

Causa comprobada: al adaptar con PowerShell el script temporal anterior, una lectura sin indicar UTF-8 corrompió etiquetas con acentos. El selector pedía una etiqueta distinta a la del frontend. El producto y el Playwright original conservaban su codificación y ya habían pasado.

Se cerró el intento fallido y se reconstruyó **solo el diagnóstico temporal**, leyendo y escribiendo UTF-8 explícitamente con Node. La repetición pasó en ambas rutas, con 12 MiB y los tres clientes. Se conserva el fallo en `playwright-large.txt`, su exit 1 y `browser-large-encoding-failed.mjs`; el resultado válido está en `playwright-large-utf8.txt`, exit 0. No se oculta ni se presenta ese intento como un fallo de la suite del proyecto.

## Evidencias y reproducción

- `source-verification.json`, `dist-audit.json`: identidad del commit y auditoría pública.
- `timer-node22.txt`, `serial-node22.txt`, `timer-node24.txt`, `serial-node24.txt`: pruebas originales y sus `*-exit.json` con códigos, duración y marcas UTC.
- `sequence-audit.json`: cronología completa y cero solapamientos.
- `playwright-original.txt`, `playwright-large-utf8.txt`, `evidence-original/`, `evidence-large/`: aceptación de navegadores y capturas.
- `large-node*.txt`, `interrupted-node*.txt`, `metrics-summary.json`: tamaños, hashes, memoria y CPU.
- `residual-node*.txt`, `lifecycle-node*.txt`, `sender-node*.txt`, `cleanup.json`: limpieza y errores controlados.

Reproducir las suites desde `source/backend/` con cada runtime, **esperando a que cada comando termine**:

```powershell
npm ci --ignore-scripts
node --test tests/asset-client-timers.test.js
npm run test:serial
# Cambiar al otro runtime y repetir las dos pruebas antes de seguir.
npm run build:frontend
```

Para los navegadores, configurar `BROWSER_TOOLS_DIR`, `PLAYWRIGHT_BROWSERS_PATH` y `BROWSER_USE_DIST=1` como en los informes anteriores. Ejecutar `node scripts/browser-integration.js` y esperar su cierre antes de iniciar el diagnóstico ampliado. Los scripts conservados en TEMP requieren su directorio como cwd; los de proceso hijo necesitan `NAUFRAGIO_SNAPSHOT` apuntando a `source/` y `NAUFRAGIO_DIAG_ROOT` a **un directorio nuevo** para bootstrap.

Las evidencias y bases sintéticas se conservan en TEMP para revisión. No se han incorporado diagnósticos al repositorio. Solo se añade este informe de documentación; los tres informes previos se mantienen.

## Alcance de la aprobación

**APTO para preparar y ejecutar posteriormente el piloto ARMv7 controlado.** Quedan acreditadas las pruebas Windows solicitadas, incluidas las suites completas y la limpieza explícita. Esta sesión no verifica consumo ARMv7, capacidad con muchas salas ni estabilidad prolongada y no constituye un despliegue permanente. Raspberry, SSH y los servicios existentes no se han tocado.
