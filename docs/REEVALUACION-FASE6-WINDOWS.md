# Reevaluación de Fase 6 en Windows

Fecha: 28 de octubre de 2026. Rama: `feat/backend-multijugador`.
Commit comprobado: `1b0f9449b9236b2f6ee849c4e89c96e0c939d32b`.

## Veredicto

**NO APTO para el piloto ARMv7 según el criterio solicitado de ausencia de temporizadores residuales.**

Las correcciones de desconexión del director, cuota de fragmentos, error del emisor y PNG funcionan en las pruebas ejecutadas. El mapa válido de **exactamente 12 MiB** llega íntegro a dos jugadores, también en navegadores reales. Sin embargo, permanece un temporizador de descarga de **600 segundos** después de completar la transferencia y cerrar el cliente. Este defecto de limpieza se reproduce con Node 22 y 24 y mantiene vivo el proceso de pruebas. No se ha observado un rechazo sin gestionar asociado a ese temporizador: son problemas distintos.

No se ha modificado código, tests versionados ni frontend. No se han realizado commits, merges, pushes, conexiones a Raspberry ni cambios de servicios.

## Preparación y trazabilidad

- Se comprobó Git antes de cambiar archivos. Se conservó `docs/VALIDACION-FASE6-WINDOWS.md`, informe anterior sin seguimiento.
- Se actualizó la rama desde `68115afb` al commit solicitado, ya disponible localmente. La restricción de escritura de `.git` requirió ejecutar la actualización con permisos ampliados. Después, Windows impidió reemplazar `backend/scripts/browser-integration.js` (`unable to unlink ... Invalid argument`). Se recuperaron los seis archivos cambiados mediante sus blobs exactos de Git y se completó la actualización del índice. No fue una corrección de código.
- Se exportó el commit con `git archive` a una carpeta TEMP nueva. Se verificaron los **106 archivos** de esa exportación contra los hashes de sus blobs: **cero diferencias**.
- `npm ci --ignore-scripts` en `source/backend/` de la copia limpia: **exit 0**, 24 paquetes instalados. No se reutilizó `node_modules` del workspace.
- Runtimes: **Node 22.23.4** y **Node 24.18.0**, Windows x64. Playwright **1.56.1**, Edge **156.0.4314.50**, Firefox **142.0.1**.
- Datos, contraseñas y cuentas exclusivamente sintéticos; perfiles de navegador temporales e independientes.

Raíz de evidencias y scripts temporales, fuera del repositorio:

```text
%TEMP%\naufragio-fase6-reevaluacion-3dfab79ce4d34e88945cfbba07b1ac4b
```

La copia conserva el código exacto comprobado y los diagnósticos; estos últimos no se incorporan al repositorio.

## Suites completas originales

Se ejecutó `node --test` con cada runtime, sin filtros, parches, cancelaciones anticipadas ni instrumentación de temporizadores:

| Runtime | Resultado | Duración informada por Node | Salida del proceso |
| --- | --- | ---: | --- |
| Node 22.23.4 | **102/102 superadas**, 0 fallidas/omitidas/canceladas | 622,805 s | 0 |
| Node 24.18.0 | **102/102 superadas**, 0 fallidas/omitidas/canceladas | 605,213 s | 0 |

La prueba nueva de 12 MiB a dos miembros tarda 73,905 s en Node 22 y 62,853 s en Node 24 dentro de las suites. Ambas suites se lanzaron durante la misma sesión y compartieron CPU; estas cifras no son un benchmark comparativo de runtimes. Los ensayos aislados posteriores rondan los 31 s.

Las suites cierran naturalmente tras aproximadamente diez minutos, coherente con el temporizador residual del receptor. Las 102 aserciones pasan; la comprobación adicional que exige cero temporizadores tras `close()` falla y no forma parte de esas 102 pruebas.

## Distribución pública

`npm run build:frontend` en la copia limpia: **superado**.

Auditoría de `source/dist/`:

| Comprobación | Resultado |
| --- | --- |
| Archivos públicos | 18 más `manifest.json` |
| Tamaño de los 18 archivos | 187.219 bytes |
| SHA-256 contra manifiesto | 18 correctos |
| Archivos inesperados | 0 |
| Rutas de backend, dependencias, Git, secretos o bases de datos | 0 |
| Patrones comprobados de claves privadas y tokens de sesión/alta | 0 coincidencias |

Los adaptadores públicos de IndexedDB son código del cliente; no son datos privados almacenados. La inspección no equivale a un análisis universal de secretos. Playwright sirvió exclusivamente los artefactos públicos de `dist/` y los eliminó al cerrar cada ejecución.

## Playwright y tres clientes

### Aceptación original sin modificaciones

Las ejecuciones pasan sin modificar el script: **exit 0** con Node 24 en **58,214 s**, y con Node 22 en **82,120 s**:

- Modo local sin backend en Edge y Firefox.
- `/`: director Edge, jugador A Firefox, jugador B Edge en otro contexto.
- `/vtt/`: director Firefox, jugadores Edge en contextos separados; Socket.IO bajo `/transport/socket.io`.
- PNG corregido como mapa inicial, nuevo mapa y retrato: aceptado en ambos motores.
- Movimientos convergentes; versiones finales de los dos tokens: `[1, 1]`.
- Movimiento no autorizado rechazado en la interfaz y también eludiéndola mediante un socket real.
- Invitaciones, asignaciones, cierre de sesión, sala en espera, recuperación y recarga con IndexedDB.
- Segunda pestaña protegida por Web Locks; otro contexto sin estado oficial no recupera la autoridad.
- Tablero local original conservado: JSON, identificadores y blob de mapa tras abandonar la sala.
- Sin errores `pageerror` en la aceptación superada; sin credenciales en localStorage según sus aserciones.

Los dos primeros intentos dentro del entorno restringido fallaron **antes del multijugador**, creando una página de Firefox:

```text
browserContext.newPage: Cannot read properties of undefined (reading '_page')
```

Un diagnóstico mínimo mostró `Failed to launch tab subprocess` y errores de composición. La ejecución con permiso para lanzar los subprocesos del navegador pasó sin cambiar producto, fixture ni configuración de seguridad de Firefox. No se atribuye ese fallo al backend.

### Mapa válido de exactamente 12 MiB en navegadores

Se generó un PNG RGBA válido de **1740 × 1740**, con píxeles sintéticos de ruido y un bloque PNG auxiliar con CRC válido para alcanzar exactamente **12.582.912 bytes**. No se usó un buffer arbitrario etiquetado como PNG. La carga atraviesa la validación y decodificación reales del frontend.

Se amplió **solo una copia temporal del script de aceptación**, sin modificar el producto ni el script versionado. Se cargó el archivo por `#sharedMapUpload`; en los tres contextos se comprobó el SHA-256 del blob usado para renderizar y el nombre del mapa compartido después de decodificarlo. Después se cambió a un mapa pequeño y se ejecutó el resto del flujo original.

```text
SHA-256: 2710f8b7a6de0fb7eb31cff6aedda3bfccc2572849fb16a9ab9db5c76d193208
```

| Despliegue local | Tiempo hasta los tres clientes | Pico RSS Node del ensayo | CPU Node usuario / sistema |
| --- | ---: | ---: | ---: |
| `/`, director Edge y jugadores Firefox/Edge | 33,719 s | 164,89 MiB | 4,219 / 0,875 s |
| `/vtt/`, director Firefox y jugadores Edge/Edge | 31,937 s | 190,98 MiB | 3,797 / 0,672 s |

Resultado global de esta aceptación ampliada: **exit 0**, **122,377 s**. Ambos jugadores reciben el archivo completo; no se observa `RATE_LIMITED`, expulsión del director ni error de página. Los movimientos, permisos, reconexiones y conservación del tablero vuelven a pasar después de la transferencia grande.

El RSS de esta tabla pertenece al proceso que reúne backend y controlador Playwright; **excluye los procesos de Edge/Firefox**. No es una medición de memoria de la Raspberry ni de toda la aplicación en navegador. Las capturas conservadas muestran al director; la igualdad de los tres clientes se comprueba mediante aserciones, no mediante tres capturas simultáneas.

## Reproducciones independientes F6-01 a F6-04

### F6-01: desconexión durante transferencia — SUPERADA

Dos niveles de prueba, con sockets reales y Node 22/24:

1. Desconectar al receptor, esperar la retirada de su transferencia y enviar un fragmento pendiente: `TRANSFER_NOT_FOUND`, director conectado y con permisos operativos.
2. Publicar el PNG válido de 12 MiB a dos miembros usando `createAssetClient` del producto; desconectar a uno al recibir el **primer fragmento**. El otro completa el archivo con el SHA-256 correcto y el director permanece conectado. Se observan los errores recuperables esperados `TRANSFER_INTERRUPTED` y `TRANSFER_NOT_FOUND`; después se mantienen 12,5 s de observación.

| Runtime | Tiempo hasta completar el receptor restante | Pico RSS backend aislado |
| --- | ---: | ---: |
| Node 22 | 15,878 s | 86,72 MiB |
| Node 24 | 15,865 s | 94,97 MiB |

No se transfirió autoridad ni se desconectó al director.

### F6-02: 12 MiB a dos jugadores — SUPERADA

Además de Playwright y de la suite, se ejecutó un backend en un proceso hijo separado y tres clientes con el módulo real `createAssetClient`. Se mantuvieron los límites de producción del protocolo; no se aumentó la cuota de fragmentos. Cada receptor obtiene **12.582.912 bytes** con el hash indicado arriba, sin errores y con director conectado.

| Medición | Node 22 | Node 24 |
| --- | ---: | ---: |
| Tiempo total | 31,206 s | 31,095 s |
| Pico RSS backend | 87,14 MiB | 94,57 MiB |
| RSS final backend | 71,79 MiB | 79,57 MiB |
| Heap usado final | 15,32 MiB | 16,51 MiB |
| CPU usuario acumulada | 7,328 s | 3,703 s |
| CPU sistema acumulada | 1,312 s | 0,781 s |

El muestreo RSS se hace cada 10 ms. La CPU y el pico incluyen preparación de cuentas y backend; no se deben dividir por el tiempo de transferencia para inferir utilización. Son pruebas locales breves, no una prueba de estabilidad prolongada ni capacidad ARMv7.

### F6-03: recuperación del error del emisor — SUPERADA; limpieza global — FALLIDA

El diagnóstico que provocaba `key is not defined` importa el módulo real y hace que un acuse de `assets:chunk` devuelva `TRANSFER_NOT_FOUND`. Tras **12,5 segundos**, con ambos runtimes:

```json
{"errors":["TRANSFER_NOT_FOUND"],"unhandled":[]}
```

No aparece `key is not defined` ni el antiguo rechazo diferido `TRANSFER_TIMEOUT`. El temporizador de 12 s del emisor se cancela correctamente mediante `finally`.

**Incidencia pendiente: temporizador del receptor sin cancelar.**

- Archivo: `backend/client/asset-client.js`, **línea 90**. Creación de `setTimeout(..., 600000)` sin conservar su identificador.
- Finalización correcta: **línea 124**, borra el elemento de `pending`, sin cancelar el temporizador.
- Cancelación por error: **línea 130**; cierre: **línea 195**. Tampoco cancelan ese temporizador del receptor.
- Causa probable: la corrección del emisor contempla su `deadline`, pero el receptor mantiene el temporizador anterior independiente.
- Reproducción mínima: crear cliente receptor, emitir autoridad/manifiesto, entregar fragmento y finalización con hash correcto, esperar publicación del blob y ejecutar `client.close()`.
- Diagnóstico temporal `residual-timer.mjs`: intercepta únicamente la creación de temporizadores de 600.000 ms y comprueba sus handles Node tras `close()`. Resultado en Node 22 y 24: descarga correcta, cero errores, **un temporizador activo con referencia**, cuando se esperaba cero. **Exit 1** de la comprobación específica.
- En las transferencias reales a dos receptores se observan dos temporizadores de esta clase; el diagnóstico los cancela **solo al terminar la medición**, para cerrar sus propios recursos. Las suites completas originales se ejecutan sin esta instrumentación ni cancelación.

El callback comprueba `pending.has(key)` y no rechaza una transferencia ya finalizada. Por tanto, **no se afirma un timeout visible o rechazo tardío tras una descarga correcta**. El problema probado es que el recurso sigue vivo, retiene su cierre y retrasa la salida de Node hasta su vencimiento. En navegador no impide cerrar una pestaña, pero incumple la limpieza pedida y afecta al ciclo de vida del cliente.

No se propone ni aplica un parche en esta reevaluación. Resolver el manejo del temporizador del receptor y repetir esta comprobación antes de declarar todas las condiciones superadas.

### F6-04: PNG corregido — SUPERADA

Se ejecutó **el script original**, con sus tres apariciones de la nueva fixture, sin sustituir imágenes. Edge y Firefox aceptan el PNG: modo local, mapa inicial, cambio de mapa y retrato. El fallo de CRC/decodificación del informe anterior no se reproduce.

## SHA-256, límites, aislamiento y persistencia

Diagnóstico adicional con cada runtime: **6 pruebas, 6 superadas**, incluyendo el contenedor de subpruebas:

- Declaración de mapa de 12 MiB aceptada; un byte adicional rechazado.
- Retrato de 2 MiB y total de 24 MiB aceptados; excesos rechazados.
- Imagen declarada de 25 millones de píxeles rechazada.
- Fragmento de 32.769 bytes rechazado como `INVALID_CHUNK`, sin expulsar al director.
- SHA-256 incorrecto rechazado por el servidor como `HASH_MISMATCH`.
- Manifiestos aislados entre dos salas; solicitud cruzada rechazada como `INVALID_MESSAGE`.
- Interrupción de transferencia sin caída del director.

La comprobación específica del cliente con bytes alterados confirma `HASH_MISMATCH` y `blobPublished: false`.

Los backends aislados de medición conservan solo SQLite sintético, con sus diez tablas previas de cuentas/salas/permisos y `integrity_check: ok`. En sus directorios de datos no aparecen imágenes. El relay no incorpora tablas de imágenes ni persistencia de manifiestos. Esto no equivale a una traza global de todas las escrituras de Windows.

## Evidencias y reproducción

En la raíz TEMP indicada:

- `source-verification.json`, `dist-audit.json`: identidad del código y auditoría pública.
- `suite-node22.txt`, `suite-node24.txt` y sus `*-exit.json`: suites completas originales.
- `playwright-original-authorized.txt`, `playwright-original-node22.txt`: aceptación sin cambios.
- `playwright-large.txt`, `browser-large.mjs`, `map-12MiB.png`, `evidence-large/`: aceptación ampliada y capturas.
- `large-valid-node22.txt`, `large-valid-node24.txt`: transmisión de 12 MiB con backend medido por separado.
- `interrupted-node22.txt`, `interrupted-node24.txt`: desconexión durante el primer fragmento y recepción restante.
- `protocol-isolation*.txt`, `client-error-node*.txt`, `client-hash.txt`: seguridad y errores del emisor.
- `residual-timer-node22.txt`, `residual-timer-node24.txt`: comprobación fallida de limpieza.
- `firefox-probe.txt`: diagnóstico del límite de subprocesos del entorno restringido.

Ejemplo para reproducir el defecto pendiente sin tocar el repositorio:

```powershell
$validation = Join-Path $env:TEMP 'naufragio-fase6-reevaluacion-3dfab79ce4d34e88945cfbba07b1ac4b'
Set-Location $validation
node residual-timer.mjs
# Exit 1: activeAfterClose = 1, timeoutMs = [600000]
```

Suites originales y build, desde `source/backend/` con el runtime correspondiente:

```powershell
npm ci --ignore-scripts
node --test
npm run build:frontend
$env:BROWSER_TOOLS_DIR = Join-Path $env:TEMP 'naufragio-vtt-browser-tools'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'naufragio-vtt-browser-binaries'
$env:BROWSER_USE_DIST = '1'
node scripts/browser-integration.js
```

Para repetir los diagnósticos con proceso hijo, establecer `NAUFRAGIO_SNAPSHOT` en `source/` y `NAUFRAGIO_DIAG_ROOT` en **un directorio de datos nuevo**. Ejecutarlos desde la raíz TEMP. No reutilizar las cuentas/bases ya creadas para el bootstrap.

Las evidencias temporales se conservan para revisión; no se confunden con archivos versionados ni con un despliegue. Los procesos de backend, clientes y navegadores se cierran en los bloques de limpieza; las dos suites terminan con salida 0 sin detenerlas. Al terminar no queda ningún proceso Node de los ensayos. Los directorios de medición contienen únicamente su SQLite sintético de 122.880 bytes cada uno.

Git conserva el commit solicitado y cero modificaciones de archivos versionados. Permanecen sin seguimiento únicamente este informe y el informe previo. No hay mediciones ARMv7 nuevas ni autorización implícita para desplegar.
