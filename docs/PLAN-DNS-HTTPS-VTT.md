# Naufragio VTT — Activación controlada de HTTPS

Fecha: **31 de octubre de 2026**. Rama `feat/backend-multijugador`; código VTT local conservado en `5d5eee58`. Auditoría e instalación aproximadamente 09:45–09:52 UTC. El [plan anterior](https://github.com/naufragio-rolero/vtt-naufragio/blob/ea1f96be70293f7e2d91fae0ca5a8da1a87bccd2/docs/PLAN-DNS-HTTPS-VTT.md) conserva el historial de validación DNS y la propuesta previa a la autorización.

## 1. Veredicto: HTTPS OPERATIVO

**`https://api.naufragio.net/` presenta un certificado válido de Let's Encrypt, exclusivo para ese nombre, y responde HTTP 403 controlado.** Se comprobó desde Raspberry con SNI y desde Windows contra la IP pública, usando validación TLS normal, sin `-k` ni excepciones de certificados.

El usuario autorizó expresamente la instalación HTTPS, las pruebas ACME staging/producción, renovación y recuperación. **No se ha instalado ni iniciado Node, habilitado proxy HTTP/WebSocket, abierto 3400, modificado DNS/STRATO/DuckDNS/router/firewall/SSH/Pages, reiniciado Apache o Raspberry, ni fusionado `main`.** No se han modificado vhosts, renovaciones o certificados de otros sitios.

Las seis sedes existentes conservan sus códigos HTTP y certificados. Los 242 archivos/enlaces de configuración ajenos vigilados coinciden con el baseline. Apache, MariaDB, SSH y SMB siguen activos con sus mismos PIDs principales. La renovación simulada con ejecución del hook ha pasado. No fue necesario revertir cambios de infraestructura.

## 2. DNS y certificado

Al inicio se revalidó mediante Cloudflare `1.1.1.1` y Google `8.8.8.8`:

| Registro de `api.naufragio.net` | Resultado |
| --- | --- |
| A | `188.78.105.221`, dirección pública usada por Windows para la comprobación HTTPS. |
| CNAME | Sin datos; no hay salto a DuckDNS. |
| AAAA | Sin datos. |
| CAA | Sin datos (`ENODATA`), sin SERVFAIL ni timeout. |

La validación previa contra los dos autoritativos de STRATO también había confirmado esos resultados y NOERROR con SOA para CAA. El MX efectivo de STRATO puede coexistir con el A y no se modificó. La emisión real y las pruebas ACME posteriores pasaron sin errores CAA. No fue necesario contactar con ningún proveedor ni cambiar DNS.

| Certificado API | Valor comprobado |
| --- | --- |
| Subject y único SAN | `api.naufragio.net` |
| Emisor | Let's Encrypt **YE1** |
| Válido desde, UTC | **2026-10-31 08:49:11** |
| Vencimiento, UTC | **2027-01-29 08:49:10** |
| SHA-256 del certificado DER servido | `4b82450af3a39196d4b5046646530bb6ea6bf79c888b327520846df712076c54` |
| Lineage | `/etc/letsencrypt/live/api.naufragio.net/` |
| Renovación | `/etc/letsencrypt/renewal/api.naufragio.net.conf`, webroot y hook específicos comprobados. |

La validez del certificado se verificó mediante cadena y hostname; no se leyó ni publicó su clave privada. La ausencia válida de CAA es distinta del error anterior del destino DuckDNS. [Let's Encrypt: CAA](https://letsencrypt.org/docs/caa/).

## 3. Auditoría privilegiada y controles de aislamiento

1. Se ejecutó **`sudo -n true` mediante la identidad/conexión SSH de instalación: salida 0**, sin introducir ni almacenar contraseña.
2. Se mantuvo una sesión administrativa para el controlador secuencial, con límite de duración de 30 minutos y recuperación ante fallo/EOF. No se modificó sudoers, SSH ni ningún permiso global. La sesión/controlador terminaron al cerrar la instalación.
3. `apache2ctl configtest`, `apache2ctl -S` y `apache2ctl -M`: **salida 0**, sintaxis global correcta. Apache **2.4.69 Raspbian**; módulos requeridos presentes. Los includes privados se pudieron procesar con privilegios, sin volcarlos al informe.
4. Se comprobó que `api` no figuraba en el mapa efectivo de vhosts y que no existían los archivos, enlaces, hook, webroot ni lineage nuevos. No hubo que sobrescribir ni respaldar archivos anteriores de esos nombres.
5. Se registraron hashes de **242 configuraciones/enlaces existentes** de Apache y renovaciones Certbot. La comparación excluyó únicamente los nuevos vhosts/enlaces y la nueva renovación de API; los archivos de otras aplicaciones, incluidos los protegidos, permanecieron idénticos.
6. Certbot **4.0.0**. Se revisaron configuración global, configuración de root, unidad/timer, seis renovaciones existentes y directorios de hooks. Sin overrides globales que interfirieran con el procedimiento ni hooks globales. Las seis renovaciones actuales conservan el autenticador/instalador Apache; no se invocó ese plugin para el certificado nuevo.
7. Se registraron estado/PID principal de los cuatro servicios y huella de certificado, código HTTP y tiempo de los seis sitios. Antes de cada fase y después de cada reload se comparó con el baseline.

El controlador inicial se cerró tras la auditoría, **antes de cualquier escritura**, para ajustar en local la comparación del nuevo lineage; se repitió la auditoría antes de instalar. No fue un fallo de Apache o ACME ni un rollback de infraestructura.

## 4. Secuencia exacta ejecutada

Las acciones se realizaron en orden; cada fase dependió del éxito anterior. Los comandos administrativos indicados se ejecutaron como root dentro de la sesión ya autorizada, sin requerir otro prompt de sudo.

| Paso | Acción y resultado real |
| --- | --- |
| 1 | Crear webroot independiente y dos subdirectorios; crear únicamente el archivo HTTP y su enlace en `sites-enabled`. Archivos nuevos, sin sobrescrituras. |
| 2 | `apache2ctl configtest` → 0; `systemctl reload apache2` → 0. Primera recarga, sin restart. Los seis sitios y certificados permanecen iguales. |
| 3 | Crear `/.well-known/acme-challenge/naufragio-install-probe` con contenido sintético; lectura HTTP local mediante Host correcto y comparación exacta → aprobada. Fichero eliminado inmediatamente. |
| 4 | ACME staging: `certonly --webroot --dry-run --non-interactive` → **0**, «The dry run was successful», **11,403 s**. Acredita validación HTTP-01 desde la infraestructura externa de Let's Encrypt. |
| 5 | Crear el hook específico, root:root 0750; emisión de producción `certonly --webroot --deploy-hook ... --non-interactive` → **0**, **11,147 s**, «Successfully received certificate». SAN exclusivo, emisor y fechas verificados. |
| 6 | Crear únicamente el archivo HTTPS y su enlace. `apache2ctl configtest` → 0; `systemctl reload apache2` → 0. Segunda recarga. Seis sitios sin cambios; API → **403 con TLS válido**. |
| 7 | Renovación simulada del nuevo lineage con `--dry-run --run-deploy-hooks --non-interactive` → **0**, **75,681 s**, «all simulated renewals succeeded». El hook ejecutó configtest y el tercer reload. Seis sitios y API verificados de nuevo. |
| 8 | Configtest y ronda final de salud → aprobados; timer existente activo, directorio de challenges vacío, ningún listener 3400 ni directivas ProxyPass en los vhosts nuevos. Controlador y temporales eliminados. |

Comandos ACME efectivamente ejecutados, sin dominios ajenos:

```sh
certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net \
  --non-interactive --dry-run

certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net \
  --non-interactive --deploy-hook /usr/local/sbin/naufragio-vtt-cert-deploy

certbot renew --cert-name api.naufragio.net \
  --dry-run --run-deploy-hooks --non-interactive
```

No se ejecutó `certbot --apache`, standalone, renovación forzada, ni emisión/ampliación para otro nombre. Staging no instaló un certificado de prueba. El hook de la emisión inicial salió sin recargar porque aún no estaba habilitado el vhost SSL; en la renovación simulada sí ejecutó la recarga.

Se realizaron **tres reloads** en total: HTTP, HTTPS y hook de renovación. Todos precedidos por configtest correcto. El último reload registrado por systemd terminó con estado 0 a las **10:49:46 CET / 09:49:46 UTC**. No hubo restart.

## 5. Archivos y directorios creados

Todos son exclusivos de API. Propietario root; no se cambiaron permisos de rutas globales existentes.

| Recurso persistente | Permisos / finalidad |
| --- | --- |
| `/var/lib/naufragio-vtt-acme/` | 0755, nuevo webroot. |
| `/var/lib/naufragio-vtt-acme/.well-known/` | 0755, nuevo subdirectorio. |
| `/var/lib/naufragio-vtt-acme/.well-known/acme-challenge/` | 0755, nuevo subdirectorio, vacío al finalizar. |
| `/etc/apache2/sites-available/api-naufragio.conf` | 0644, vhost HTTP, solo lectura pública de challenges. |
| `/etc/apache2/sites-enabled/api-naufragio.conf` | Enlace al archivo anterior; creado directamente mediante symlink, no mediante edición de otro vhost. |
| `/etc/apache2/sites-available/api-naufragio-ssl.conf` | 0644, TLS independiente, raíz denegada. |
| `/etc/apache2/sites-enabled/api-naufragio-ssl.conf` | Enlace al archivo anterior. |
| `/usr/local/sbin/naufragio-vtt-cert-deploy` | 0750, hook exclusivo de este lineage. |
| `/etc/letsencrypt/renewal/api.naufragio.net.conf` | 0600, configuración generada por Certbot. |
| `/etc/letsencrypt/live/api.naufragio.net/` | Enlaces Certbot de cert, chain, fullchain y privkey. La clave de destino conserva 0600. |
| `/etc/letsencrypt/archive/api.naufragio.net/` | Archivos de la primera emisión del nuevo lineage, gestionados por Certbot. No se publican claves ni contenidos de este directorio. |
| `/var/log/apache2/naufragio-vtt-access.log` y `naufragio-vtt-error.log` | Logs propios declarados en ambos vhosts. El formato no registra query, Authorization, Cookie ni cuerpos. |

Certbot utilizó sus directorios habituales de trabajo/logs/estado ACME. No se volcaron cuentas, URLs de autorización, tokens de challenge ni logs ACME completos al repositorio. No se afirma que una ejecución de Certbot sea una operación sin escrituras auxiliares.

Recursos temporales retirados: fichero sintético de challenge, raíz privada `/var/tmp/naufragio-https.*` con salidas del controlador y scripts locales auxiliares. Verificación final: **cero raíces temporales de ese prefijo y cero ficheros en el directorio de challenges**. El controlador terminó con salida 0; no queda una sesión administrativa de esta instalación ni proceso de piloto.

Huellas SHA-256 comprobadas de los archivos nuevos, sin contenido sensible:

```text
api-naufragio.conf       64974171b58fa709235e7ccb80f7d09377ef2844be6d67dc26605950db539785
api-naufragio-ssl.conf   2bb7a45c31f59fda96c6ddaa6035830328be43e74822ad071fe96b8a0b652d1d
hook de renovación      dc6fd503281e8e8b07372d1310ede9c9bf78a0ddc2ce35b15625ad90fb48fef2
renewal API             28ff2db774d05f3c46b2da7f0a1454015c6d05a256e40beca9cde5137ccf6fce
```

## 6. Configuración instalada

### `/etc/apache2/sites-available/api-naufragio.conf`

```apache
<VirtualHost *:80>
    ServerName api.naufragio.net
    DocumentRoot /var/lib/naufragio-vtt-acme
    Alias /.well-known/acme-challenge/ /var/lib/naufragio-vtt-acme/.well-known/acme-challenge/
    <Directory /var/lib/naufragio-vtt-acme>
        Options None
        AllowOverride None
        Require all denied
    </Directory>
    <Directory /var/lib/naufragio-vtt-acme/.well-known/acme-challenge>
        Require all granted
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/naufragio-vtt-error.log
    CustomLog ${APACHE_LOG_DIR}/naufragio-vtt-access.log "%h %t \"%m %U %H\" %>s %b"
</VirtualHost>
```

### `/etc/apache2/sites-available/api-naufragio-ssl.conf`

```apache
<VirtualHost *:443>
    ServerName api.naufragio.net
    SSLEngine on
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCertificateFile /etc/letsencrypt/live/api.naufragio.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/api.naufragio.net/privkey.pem
    DocumentRoot /var/lib/naufragio-vtt-acme
    <Directory /var/lib/naufragio-vtt-acme>
        Options None
        AllowOverride None
        Require all denied
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/naufragio-vtt-error.log
    CustomLog ${APACHE_LOG_DIR}/naufragio-vtt-access.log "%h %t \"%m %U %H\" %>s %b"
</VirtualHost>
```

### `/usr/local/sbin/naufragio-vtt-cert-deploy`

```sh
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/api.naufragio.net" ] || exit 0
[ -L /etc/apache2/sites-enabled/api-naufragio-ssl.conf ] || exit 0
/usr/sbin/apache2ctl configtest
/usr/bin/systemctl reload apache2
```

No se añadieron redirecciones HTTP→HTTPS, HSTS global, módulos, ProxyPass ni reglas de WebSocket. La raíz HTTP también devuelve 403; solo la ruta HTTP-01 está concedida. La raíz HTTPS devuelve 403 de forma intencionada mientras el backend siga fuera de alcance.

## 7. Pruebas de conservación de los servicios

El controlador completó **11 rondas de seis sitios, 66 sondas HTTP**, además de comprobar sus certificados mediante TLS con SNI. Incluyen baseline, antes/después de fases y después de cada reload. Todas conservaron código y huella del certificado; no hubo regresiones observadas. La comparación de 242 archivos/enlaces ajenos pasó en todas las rondas. Se omitió únicamente el ámbito nuevo autorizado de API.

| Sitio | Código en todas las rondas | Baseline → final | Certificado final |
| --- | ---: | ---: | --- |
| Heaven's Gate | 200 | 182,921 → 184,663 ms | Idéntico al inicial. |
| Foro | 200 | 202,552 → 191,427 ms | Idéntico al inicial. |
| `autonaufragio` | 404, igual al baseline | 101,201 → 102,230 ms | Idéntico al inicial. |
| `bibprof` | 200 | 195,838 → 196,953 ms | Idéntico al inicial. |
| `ordenanthia` | 200 | 116,948 → 141,303 ms | Idéntico al inicial. |
| Galería existente | 200 | 104,427 → 104,787 ms | Idéntico al inicial. |

Apache, MariaDB, SSH y SMB: activos y mismos PIDs principales en todas las comparaciones. Las sondas son lecturas anónimas de la raíz; no prueban todos los recorridos autenticados o funciones privadas de esas aplicaciones, ni equivalen a monitorización continua durante cada milisegundo del reload.

### Validación de la API

- TLS local con SNI correcto: cadena y hostname válidos, SAN exclusivo. Tras la segunda recarga: 403, **141,677 ms**. Tras renovación: 403, **144,020 ms**. Ronda final: 403, **148,671 ms**. Misma huella del certificado de producción.
- Windows: `curl.exe https://api.naufragio.net/` con verificación normal → salida **0**, HTTP **403**, IP destino `188.78.105.221`, `ssl_verify_result=0`, **153,468 ms**.
- Windows HTTP → 403, **28,613 ms**. No se habilitó redirección.
- Las tres operaciones ACME satisfactorias acreditan que Let's Encrypt pudo validar HTTP-01 desde su infraestructura exterior. No se atribuye a Windows una red externa independiente.
- La herramienta web externa siguió sin devolver una respuesta utilizable a HTTPS. No se usa ese resultado como prueba de fallo del servicio ni como validación externa independiente de TCP 443. El certificado servido sí está comprobado desde Raspberry y Windows.

## 8. Renovación automática

Se conserva el **`certbot.timer` existente**, activo; `OnCalendar=*-*-* 00,12:00:00`, `RandomizedDelaySec=43200`, `Persistent=true`. No se creó otro timer, cron ni servicio. El nuevo archivo de renovación contiene autenticador webroot, webroot dedicado y hook propio; se verificó su contenido sin publicar datos privados de cuenta.

La prueba `renew --cert-name api.naufragio.net --dry-run --run-deploy-hooks` pasó con salida 0. La revisión filtrada del log confirmó **ejecución del deploy hook, `Syntax OK`, ausencia de error no cero del hook y éxito de la renovación simulada**. systemd confirmó último reload con estado 0. No se sustituyó el certificado de producción por uno staging.

Mantener la ruta HTTP-01 y vigilar el vencimiento **del certificado servido**, el timer y errores ACME/hook. Las renovaciones futuras dependen también de que el A siga apuntando a la IP vigente; no se ha implementado su actualización automática. [Certbot: renovación y hooks](https://eff-certbot.readthedocs.io/en/stable/using.html).

## 9. Incidencias y recuperación

**Sin errores de validación Apache/ACME ni regresiones observadas. No se ejecutó rollback de infraestructura.** La renovación simulada duró más que las emisiones iniciales, pero terminó correctamente; no se trató esa espera como un fallo ni se alteraron límites o servicios para acelerarla.

Rollback preparado, no ejecutado:

1. Deshabilitar únicamente los dos enlaces nuevos de API; comprobar que sus destinos siguen siendo los registrados. Validar configuración global y recargar Apache, sin restart. Comparar otra vez los seis sitios, certificados y procesos principales.
2. Retirar solo los archivos HTTP/HTTPS y hook nuevos tras comprobar su huella/propiedad. No restaurar un árbol completo de Apache ni sobrescribir cambios concurrentes.
3. Si se retira el lineage nuevo, verificar antes que no tiene referencias activas y ejecutar exclusivamente `certbot delete --cert-name api.naufragio.net --non-interactive`. No borrar otros certificados, revocarlos ni tocar cuentas compartidas.
4. Retirar el webroot solo después de eliminar sus referencias de vhost y renovación. Conservar logs según la política operativa. No usar comodines destructivos sobre certificados/directorios compartidos.
5. Validar de nuevo Apache y los servicios originales. No necesita revertir DNS, SSH, firewall, router o Pages porque no se modificaron. No hay bases de datos o contenido VTT que borrar.

## 10. Pendientes exclusivos de la siguiente fase

No se ha publicado el multijugador. Quedan registrados, **sin implementar**:

1. Corregir límites por IP detrás de Apache con un modelo de proxy de confianza que no acepte cabeceras falsificadas.
2. Actualizar `backend/.env.example` a `MAX_MESSAGE_BYTES=65536`.
3. Autorizar y configurar posteriormente Node solo en `127.0.0.1:3400` y el proxy independiente. Ahora el puerto sigue sin listener y no se ha abierto.
4. Probar Socket.IO mediante HTTPS/WSS y HTTP polling, con cuentas, pertenencias y permisos reales del backend.
5. Repetir PNG/mapas válidos de 12 MiB con varios jugadores, SHA-256, interrupciones y reconexiones por el trayecto público.
6. Resolver el mantenimiento automático del A cuando cambie la IP pública, sin modificar ahora STRATO/DuckDNS.

GitHub Pages permanece intacto. Solo se versiona esta actualización documental en la rama de trabajo, sin merge con `main`, código VTT, scripts de control temporales, credenciales o claves.
