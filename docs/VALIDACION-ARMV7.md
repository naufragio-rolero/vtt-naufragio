# Validación temporal de Node 22 en ARMv7

Fecha: 27 de octubre de 2026. Rama: `feat/backend-multijugador`. **Resultado satisfactorio: se permite continuar la Fase 3 local. No constituye un despliegue ni una autorización de publicación.**

## Alcance y aislamiento

Se probó la implementación de autenticación de Fase 2 del commit `1348fde`, con el diagnóstico reproducible [`backend/scripts/armv7-probe.js`](../backend/scripts/armv7-probe.js). No se ejecutó la suite completa en paralelo en la Raspberry. Se usaron exclusivamente cuentas, contraseñas, sesiones e invitaciones sintéticas. Los cambios posteriores de salas de Fase 3 se prueban en Windows, no se han validado en ARMv7 en esta entrega.

El host confirmó `armv7l`, usuario de 32 bits, cuatro núcleos y aproximadamente 920 MiB de RAM. Antes de empezar se comprobaron espacio, memoria disponible, temperatura y estado/PID principal de Apache. `/tmp` está en tmpfs; se eligió un directorio privado creado con `mktemp` bajo `/var/tmp`, en el sistema de archivos raíz, con unos 53 GiB disponibles, para no consumir RAM con el runtime y las trazas. No se usó el SSD de aplicaciones.

Se descargó por HTTPS el archivo oficial `node-v22.23.4-linux-armv7l.tar.xz` y se verificó su SHA-256:

```text
c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437
```

Solo se extrajo el ejecutable Node dentro del directorio temporal. No se instaló Node/npm en el sistema, no se ejecutó npm en la Raspberry ni se instalaron paquetes globales. Las dependencias JavaScript ya resueltas por el lockfile se transfirieron desde Windows junto con el backend de Fase 2 y el diagnóstico, sin `.env`, bases reales, credenciales ni archivos del frontend publicado. SHA-256 del paquete de prueba transferido:

```text
10c4fac50ce468645431aae12e48abeb312e6f703db885300a1fce6e050d820d
```

Fuentes del artefacto: [versión oficial 22.23.4](https://nodejs.org/pt-br/blog/release/v22.23.4), [archivo oficial ARMv7](https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-armv7l.tar.xz). El hash corresponde a esa versión exacta, no a un alias de descarga mutable.

## Controles de ejecución

- Directorios privados, `umask 077`, entorno mínimo mediante `env -i`; `TMPDIR`, `SQLITE_TMPDIR` y `VALIDATION_ROOT` apuntaban al árbol temporal.
- Node arrancó sin privilegios, con `UV_THREADPOOL_SIZE=1`, `--max-old-space-size=64`, prioridad `nice 19`, volcados de núcleo deshabilitados, límite de CPU de 120 s (duro: 125 s) y timeout de 180 s.
- El backend escuchó únicamente en loopback y en un puerto efímero. No se añadió proxy, unidad de servicio ni persistencia de arranque.
- Vigilancia cada 250 ms: detener si `MemAvailable` bajaba de 192 MiB o la temperatura alcanzaba 75 °C. El diagnóstico también detenía la prueba con RSS superior a 160 MiB. No se alcanzó ningún umbral.
- `strace -f -e trace=%file` permitió revisar aperturas con escritura y otras mutaciones de archivos, incluidos SQLite, WAL/journal y temporales. Se contaron **cero llamadas de escritura/mutación de archivos fuera del árbol temporal**. Esto describe el proceso probado y sus hijos; no pretende excluir registros propios de SSH o del sistema operativo.
- No se leyó ni modificó Heaven's Gate; no se modificaron Apache ni otros servicios. Apache seguía activo y conservaba su PID principal al terminar.

## SQLite y autenticación

Primero se probó únicamente `node:sqlite`: apertura, creación, escritura, `COMMIT`, `ROLLBACK`, cierre y reapertura comprobando los datos. Resultado **correcto**, sin flags para habilitar SQLite; Node 22 emitió su aviso experimental habitual.

| Medida de la prueba SQLite aislada | Resultado |
| --- | --- |
| Tiempo de pared | 65,96 ms |
| CPU usuario / sistema | 15,32 / 2,62 ms |
| RSS máximo comunicado por el proceso | 42 548 KiB, aproximadamente 41,55 MiB |

Después se midieron tres hashes y tres verificaciones scrypt, **en serie**, manteniendo N=32768, r=8, p=3 y el límite de memoria real. Se arrancó el backend y se comprobaron bootstrap sintético, login HTTP, provisión de director, invitación de alta, validación, registro, rechazo de reutilización, login ordinario, denegación de creación de salas/emisión de invitaciones por un usuario ordinario, logout, revocación y contraseña incorrecta. **Todas las comprobaciones finalizaron correctamente; salida 0.**

| Operación | Pared (ms) | CPU usuario (ms) | CPU sistema (ms) |
| --- | ---: | ---: | ---: |
| Hash 1 | 1663,48 | 1625,69 | 40,02 |
| Hash 2 | 1614,02 | 1560,61 | 70,94 |
| Hash 3 | 1621,08 | 1603,97 | 30,88 |
| Verificación 1 | 1616,64 | 1583,26 | 50,51 |
| Verificación 2 | 1615,06 | 1563,48 | 68,79 |
| Verificación 3 | 1614,11 | 1613,07 | 70,15 |
| Login HTTP del administrador sintético | 1722,58 | 1580,09 | 138,72 |

Mediana de hash: **1621,08 ms**; de verificación: **1615,06 ms**. Son muestras pequeñas bajo instrumentación y prioridad reducida; no representan un percentil de producción. La latencia supera un segundo y debe aceptarse expresamente para el piloto o motivar un host más rápido. No se rebajaron los parámetros de contraseña.

| Medida del diagnóstico completo | Resultado |
| --- | --- |
| Tiempo de pared | 23,808 s |
| CPU total usuario / sistema del proceso | 23,052 / 1,071 s |
| CPU media aproximada | Cerca de un núcleo; aproximadamente el 25 % de la capacidad de cuatro núcleos. No es una medición de utilización global del host. |
| Pico RSS del proceso | 103 580 KiB, aproximadamente **101,15 MiB** |
| RAM disponible antes / mínimo / después | 523 076 / **443 980** / 490 672 KiB; mínimo aproximado **433,6 MiB** |
| Temperatura inicial / máxima observada | 60,148 / **62,838 °C** |
| Guardas activadas | Ninguna |

## Limpieza y reproducción

Ambos directorios temporales (SQLite aislado y backend) se eliminaron al terminar mediante limpieza acotada al prefijo y propietario creados para la prueba. Se verificó por SSH que el último directorio ya no existía y que no quedaban procesos Node, strace, timeout o nice de esta validación. También se eliminó el paquete temporal transferido desde Windows. **No queda runtime ni base de prueba en la Raspberry.**

El script versionado exige `VALIDATION_ROOT` y debe ejecutarse dentro de una raíz temporal nueva: no reutilizar directorios ni bases anteriores. Para repetir hay que preparar expresamente esa raíz privada, el runtime verificado y el paquete de código; configurar los directorios temporales, límites y vigilancia anteriores; ejecutar el script secuencialmente; revisar la traza y eliminar todo el árbol al finalizar, incluso si falla. El script no instala dependencias, no configura servicios y no sustituye la vigilancia externa ni la limpieza del controlador.

## Decisiones pendientes

1. Aceptar la latencia de acceso de aproximadamente 1,6–1,7 s en el piloto y medir colas, carga concurrente y convivencia antes de publicar. La cola actual permite una derivación activa y cuatro pendientes; esta prueba secuencial no valida cinco accesos simultáneos.
2. Mantener un único proceso backend y fijar sus límites operativos después de medir carga sostenida. Los umbrales de esta prueba no son una configuración definitiva de servicio.
3. Resolver la plataforma posterior a Node 22 y el horizonte de soporte de ARMv7. Probar Node 24 en Windows no demuestra que exista un runtime Node 24 adecuado para esta Raspberry.
4. Continúan pendientes HTTPS/WSS de extremo a extremo, proxy, usuario/directorio permanente, backup consistente y autorización de despliegue del [inventario](INVENTARIO-BACKEND-RASPBERRY.md).
