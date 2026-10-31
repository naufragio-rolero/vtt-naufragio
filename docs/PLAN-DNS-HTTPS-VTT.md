# Naufragio VTT — Validación DNS y preparación HTTPS/WSS

Actualización: **31 de octubre de 2026, consultas desde 09:29 UTC**. Rama `feat/backend-multijugador`, código local inspeccionado `5d5eee58`. Este informe sustituye la recomendación anterior de CNAME. La [versión histórica](https://github.com/naufragio-rolero/vtt-naufragio/blob/cc467ab0379c497871c1aa54db6bb1619293a5a3/docs/PLAN-DNS-HTTPS-VTT.md) conserva el inventario previo y el diagnóstico del trayecto mediante DuckDNS.

## 1. Veredicto y alcance

**DNS / CAA: APTO. El bloqueo CAA/SERVFAIL ha desaparecido para `api.naufragio.net`.**

**Comenzar la instalación HTTPS: BLOQUEADO actualmente por falta de sudo autorizado para validar la configuración global de Apache antes de modificarla.** Las consultas sin privilegios tropiezan con un include protegido; no demuestran que la configuración sea inválida. No queda ningún cambio DNS que pedir al propietario ni ninguna consulta a soporte que realizar.

La conectividad exterior del challenge sigue pendiente: se comprobará después de autorizar y habilitar el vhost HTTP, **antes de ejecutar ACME staging**. No se declara que HTTP-01 vaya a funcionar desde Internet basándose en consultas locales. La respuesta 403 actual y la falta de certificado para `api` son estados esperables antes de instalar su vhost, no nuevos defectos DNS.

**Auditoría exclusivamente de lectura en Raspberry.** No se han modificado Apache, certificados, DNS, SSH, firewall, router ni servicios; no se ha ejecutado Certbot para emitir, renovar o realizar staging. No se ha instalado ni arrancado el backend, modificado Pages, contactado con STRATO ni fusionado `main`. Solo se actualiza este informe en GitHub; se conservan los cambios locales anteriores.

## 2. DNS actual, comprobado

El propietario ha sustituido el CNAME por un A directo. Se consultaron Cloudflare, Google y ambos NS autoritativos de STRATO, evitando las entradas `hosts` de Windows.

| Fuente | A de `api.naufragio.net` | CNAME | AAAA | CAA |
| --- | --- | --- | --- | --- |
| Cloudflare `1.1.1.1` | `188.78.105.221` | Sin datos | Sin datos | Sin datos, sin SERVFAIL |
| Google `8.8.8.8` | `188.78.105.221` | Sin datos | Sin datos | Sin datos, sin SERVFAIL |
| `docks02.rzone.de`, `217.160.80.129` | `188.78.105.221` | Sin datos | Sin datos | Sin datos, sin SERVFAIL |
| `shades04.rzone.de`, `185.132.34.131` | `188.78.105.221` | Sin datos | Sin datos | Sin datos, sin SERVFAIL |

Una consulta HTTPS de IP de salida desde Raspberry devuelve **`188.78.105.221`**, idéntica al A actual. No se ha copiado una dirección privada ni inferido la IP únicamente de DuckDNS. El nombre existente de Heaven's Gate también resuelve a esa IP, pero **ya no interviene como CNAME en la resolución de `api`**.

Las respuestas «sin datos» de la tabla fueron `ENODATA`, no timeout, SERVFAIL ni NXDOMAIN. Google DNS sobre HTTPS confirma CAA **Status 0 / NOERROR**, sin Answer y con SOA de `naufragio.net`; serial observado **`2020061961`**. CAA de `naufragio.net` y de `.net` también respondió NOERROR sin registros CAA. No aparece una política CAA heredada que restrinja Let's Encrypt en las consultas realizadas.

No hay que crear un CAA para corregir un error inexistente: la ausencia válida de CAA permite la emisión si se cumplen la validación de control y los demás requisitos de la CA. [Let's Encrypt: CAA](https://letsencrypt.org/docs/caa/).

### Otros registros y conflictos

- MX efectivo: prioridad 5, `smtp.rzone.de`, en las cuatro fuentes. **Un MX puede coexistir con un A y no bloquea HTTP-01 ni HTTPS.** No retirarlo.
- TXT y NS en `api`: sin datos. No se observó una delegación del subdominio ni un CNAME incompatible.
- Sin AAAA final: no existe en las muestras una ruta IPv6 alternativa que lleve el challenge a otro servidor.
- No se propone tocar A/AAAA/MX del dominio raíz, nombres DuckDNS ni sus actualizadores. No se ha accedido al panel STRATO.

### Continuidad de la IP, separada de la emisión inicial

El A es correcto **hoy**. No se ha demostrado que tenga actualización automática. La actualización DuckDNS existente no actualiza este A de STRATO; tras un cambio de IP habría que mantenerlo para evitar interrupciones y fallos de renovación.

Esto **no bloquea una primera emisión mientras la IP siga coincidiendo**. Antes de dar la instalación por operativa a largo plazo debe acordarse su mantenimiento. DynDNS nativo de STRATO es una posibilidad ya documentada, no activada en esta tarea; no se cambia ahora el registro ni se depende de soporte. [STRATO: actualización dinámica](https://www.strato.es/faq/hosting/como-configurar-dyndns-para-tus-dominios/).

## 3. Apache, Certbot y disponibilidad actual

### Lecturas actuales

| Comprobación | Resultado |
| --- | --- |
| Host | ARMv7; Apache **2.4.69 Raspbian**, Certbot **4.0.0**. |
| Módulos habilitados en disco | `ssl`, `proxy`, `proxy_http`, `headers`, `rewrite`: presentes. |
| `api.naufragio.net` en vhosts legibles | No aparece. Un vhost nuevo con ese `ServerName` puede prepararse de forma independiente; falta validación global privilegiada de aliases/includes. |
| `sudo -n true` | No autorizado en esta sesión. No se solicitaron contraseñas ni se alteró SSH. |
| `apache2ctl configtest`, `-S`, `-M` | Salida 1 por `Permission denied` al leer un include privado de otro sitio. No atribuirlo a una configuración defectuosa ejecutada por root. |
| Lineage `api.naufragio.net` | No existe su archivo de renovación en la ruta estándar comprobada. |
| Puerto 3400 | Sin listener. No se arrancó Node. |
| HTTP local con Host `api.naufragio.net` | 403, respuesta del ámbito predeterminado; no hay challenge preparado. |
| TLS local con SNI `api.naufragio.net` | Verificación falla por hostname mismatch; no hay certificado que cubra el nombre. |

**Requisito previo a cualquier escritura:** disponer de sudo autorizado y ejecutar con privilegios `apache2ctl configtest`, `apache2ctl -S` y `apache2ctl -M`. Revisar el resultado filtrado, sin volcar includes privados, claves ni configuraciones sensibles al informe. Confirmar también que `api` no aparece como alias, que los archivos nuevos no colisionan y que las rutas futuras no existen o están libres para este fin.

### Renovación y hooks comprobados

Las seis configuraciones actuales de renovación accesibles usan `authenticator=apache`, `installer=apache`, sin hooks definidos en esos archivos. El archivo global de Certbot accesible no presenta directivas de pre/post/deploy hook. Los directorios estándar `renewal-hooks/pre`, `post` y `deploy` se pudieron listar y estaban vacíos. No se ejecutaron hooks.

`certbot.timer` está activo, con `OnCalendar=*-*-* 00,12:00:00`, `RandomizedDelaySec=43200` y `Persistent=true`. `certbot.service` informa última salida 0 y estado inactivo, normal entre ejecuciones. Esto no prueba una emisión ni renovación nueva. Se reutilizará ese timer; no crear otro cron o servicio de renovación.

La revisión privilegiada previa deberá confirmar configuración efectiva de Certbot, cuenta ACME existente, posibles overrides de unidad/CLI y ausencia de hooks nuevos desde esta auditoría. No publicar identificadores privados ni ejecutar `certbot certificates`/`renew` como si fueran necesarios para esta lectura.

### Servicios existentes, baseline comprobado

Se hicieron sondas HTTPS **por loopback con SNI/Host correcto y verificación TLS**, sin `-k`, login ni lectura de archivos de aplicaciones.

| Sitio | HTTP HTTPS | Tiempo de una muestra | Certificado válido hasta, UTC |
| --- | ---: | ---: | --- |
| Heaven's Gate | 200 | 193 ms | 2027-01-06 16:35:59 |
| Foro | 200 | 207 ms | 2026-12-16 20:19:54 |
| `autonaufragio` | 404, baseline existente | 107 ms | 2027-01-08 07:38:50 |
| `bibprof` | 200 | 205 ms | 2027-01-18 22:10:02 |
| `ordenanthia` | 200 | 133 ms | 2026-12-22 16:23:25 |
| Galería existente | 200 | 132 ms | 2026-12-20 08:31:56 |

Apache, MariaDB, SSH y SMB estuvieron activos, con **los mismos PIDs principales antes/después** de las consultas. No se guardan sus PIDs ni direcciones privadas en el informe. Estas sondas acreditan disponibilidad anónima local, no todos los flujos internos ni el acceso por Internet. Los servicios han permanecido intactos durante esta auditoría; el efecto de una instalación futura se verificará antes/después, no se garantiza por anticipado.

## 4. Acceso exterior y HTTP-01

El servicio web externo disponible volvió a devolver «not accessible via this tool» al intentar HTTP/HTTPS de `api`; no produjo una respuesta utilizable y el intento HTTP se mostró normalizado a HTTPS. **No permite confirmar ni descartar el acceso exterior a TCP 80.** Las pruebas desde Windows o Raspberry no sustituyen una red independiente y pueden verse afectadas por NAT loopback u overrides locales.

No se revisaron reglas efectivas de UFW/router con privilegios porque no hay sudo disponible. No se presume necesario cambiar ninguna regla: los sitios actuales ya utilizan Apache en 80/443. Si, después de habilitar el vhost HTTP autorizado, el challenge no llega desde fuera, **detenerse antes de staging** y diagnosticar el trayecto; no abrir puertos, alterar firewall/router o contactar soporte por inferencia.

HTTP-01 exige que la CA pueda leer el challenge del nombre solicitado en **puerto 80**; un certificado HTTPS válido previo no es necesario. [Let's Encrypt: HTTP-01](https://letsencrypt.org/docs/challenge-types/).

## 5. Plan concreto de instalación, pendiente de autorización

**Ningún comando de instalación de esta sección se ha ejecutado.** El primer paso actual es desbloquear la lectura privilegiada; después se podrá autorizar el ámbito de cambios que sigue. No hace falta desplegar VTT para obtener y comprobar su certificado.

### A. Validación, respaldo y vhost HTTP exclusivo

1. Verificar sudo autorizado, sintaxis global, mapa de vhosts y módulos. Registrar otra vez servicios, certificados y sondas anteriores. Guardar copia privada de los archivos/enlaces concretos que se vayan a cambiar; no copiar claves al repositorio ni restaurar árboles completos sobre cambios concurrentes.
2. Crear el webroot dedicado `/var/lib/naufragio-vtt-acme/.well-known/acme-challenge/`, con permisos de lectura mínimos para Apache. No usar el DocumentRoot de Heaven's Gate ni de otro sitio.
3. Crear únicamente `/etc/apache2/sites-available/api-naufragio.conf` y su enlace mediante `a2ensite api-naufragio.conf`, inicialmente con este contenido HTTP, **sin redirección a HTTPS y sin proxy**:

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

4. Validar y realizar **reload, sin restart**, solo si la validación termina con salida 0:

```sh
sudo apache2ctl configtest
sudo apache2ctl -S
sudo systemctl reload apache2
```

5. Crear un fichero sintético de prueba dentro del directorio de challenges y comprobar su contenido exacto desde una red independiente, sin `hosts`, VPN hacia la LAN ni redirección forzada a HTTPS. Eliminar solo ese fichero al terminar. Comparar todos los sitios del baseline. Si falla, detenerse sin ejecutar ACME.

### B. ACME staging y certificado exclusivo

Revisar primero configuración global de Certbot y hooks, incluida cualquier diferencia desde la lectura actual. Usar la cuenta ACME existente conforme a sus condiciones; no introducir credenciales por argumentos/URLs/logs. `certonly --webroot` evita el instalador Apache y standalone; no ampliar ni reemitir el certificado de Heaven's Gate.

Primera prueba autorizada, **staging mediante dry-run**:

```sh
sudo certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net --dry-run
```

Aunque sea dry-run, hace solicitudes ACME y escribe datos temporales/logs; requiere autorización y **no se ha ejecutado**. No utilizar `--staging` de forma que se active en Apache un certificado de prueba.

Para renovación, preparar un hook privado independiente `/usr/local/sbin/naufragio-vtt-cert-deploy`, propiedad de root, sin escritura para la cuenta del VTT. Contenido propuesto:

```sh
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/api.naufragio.net" ] || exit 0
[ -L /etc/apache2/sites-enabled/api-naufragio-ssl.conf ] || exit 0
/usr/sbin/apache2ctl configtest
/usr/bin/systemctl reload apache2
```

El hook solo recarga si se renueva ese lineage y su vhost SSL ya está habilitado. Evita un reload innecesario en la emisión inicial, antes de crear el vhost 443. No instalarlo en el directorio de hooks globales ni añadirlo a certificados existentes.

Después de staging satisfactorio, emisión de producción autorizada:

```sh
sudo certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net \
  --deploy-hook /usr/local/sbin/naufragio-vtt-cert-deploy
```

Comprobar SAN exclusivo `api.naufragio.net`, emisor, fechas y cadena. Las rutas esperadas son `/etc/letsencrypt/live/api.naufragio.net/fullchain.pem` y `privkey.pem`; no leer/publicar la clave. Revisar que la configuración nueva de renovación conserva webroot y hook, sin alterar las seis renovaciones actuales. [Certbot: webroot y renovación](https://eff-certbot.readthedocs.io/en/stable/using.html).

### C. HTTPS independiente, todavía sin backend

Crear `/etc/apache2/sites-available/api-naufragio-ssl.conf` **solo después de emitir el certificado válido**:

```apache
<VirtualHost *:443>
    ServerName api.naufragio.net
    SSLEngine on
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCertificateFile /etc/letsencrypt/live/api.naufragio.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/api.naufragio.net/privkey.pem
    DocumentRoot /var/lib/naufragio-vtt-acme
    <Directory /var/lib/naufragio-vtt-acme>
        Require all denied
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/naufragio-vtt-error.log
    CustomLog ${APACHE_LOG_DIR}/naufragio-vtt-access.log "%h %t \"%m %U %H\" %>s %b"
</VirtualHost>
```

Revisar la política TLS heredada antes de aplicar el ejemplo. Habilitar únicamente este vhost, validar configuración global y hacer reload autorizado. La raíz HTTPS respondería **403 con certificado válido**: es intencionado mientras no exista backend. No hay que arrancar Node para convertir ese 403 en 200.

Si se autoriza redirección HTTP, añadir al vhost de puerto 80:

```apache
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
RewriteRule ^ https://api.naufragio.net%{REQUEST_URI} [R=301,L,NE]
```

Mantener el challenge fuera de la redirección. Validar conservación de ruta/consulta, TLS público desde otra red y todos los sitios del baseline tras el reload. No añadir HSTS global o `includeSubDomains`, ni alterar vhosts/certificados de otros sitios.

### D. Renovación automática y prueba del hook

Reutilizar `certbot.timer`. Probar únicamente el nuevo lineage en una ventana autorizada:

```sh
sudo certbot renew --cert-name api.naufragio.net --dry-run
# Autorización adicional explícita para ejecutar también el reload del hook:
sudo certbot renew --cert-name api.naufragio.net --dry-run --run-deploy-hooks
```

Comprobar salida de ACME, resultado del hook, certificado servido y sitios existentes. No ejecutar renovación forzada ni renovar todos los certificados para probar este. Supervisar vencimiento **del certificado servido**, timer y errores; una salida 0 de `renew` puede significar que no había nada que renovar. [Referencia de Certbot: dry-run y deploy hooks](https://eff-certbot.readthedocs.io/en/stable/man/certbot.html).

## 6. HTTP/WSS para VTT: propuesta posterior, no parte de activar el certificado

La capacidad está disponible por versión/módulos, pero no se ha instalado ni probado un trayecto público WSS. Cuando se autorice por separado el backend, estas directivas sustituirían el ámbito estático denegado del vhost SSL; no incorporarlas aún:

```apache
ProxyRequests Off
ProxyPreserveHost On
ProxyAddHeaders On
RequestHeader unset Forwarded
RequestHeader unset X-Forwarded-For
RequestHeader unset X-Forwarded-Host
RequestHeader unset X-Forwarded-Server
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"
LimitRequestBody 131072
ProxyPass "/socket.io/" "http://127.0.0.1:3400/socket.io/" upgrade=websocket connectiontimeout=5 timeout=120
ProxyPassReverse "/socket.io/" "http://127.0.0.1:3400/socket.io/"
ProxyPass "/" "http://127.0.0.1:3400/" connectiontimeout=5 timeout=120
ProxyPassReverse "/" "http://127.0.0.1:3400/"
```

La regla específica precede a la raíz, conserva polling y permite upgrade únicamente en la ruta Socket.IO. No forzar encabezados Upgrade globalmente. Apache 2.4.47+ permite este upgrade con `proxy_http`. [Apache: proxy y WebSocket](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#examples).

Configuración futura: `HOST=127.0.0.1`, `PORT=3400`, `NODE_ENV=production`, `ALLOWED_ORIGINS=https://naufragio-rolero.github.io`, `SOCKET_PATH=/socket.io`, `MAX_MESSAGE_BYTES=65536`, diagnósticos desactivados y SQLite privada de metadatos. No abrir 3400 ni modificar Pages en esta fase.

El backend actual agrupa límites por dirección de socket; detrás de Apache todos los clientes compartirán loopback. Esto requiere una política probada antes de publicar el **backend**, pero **no bloquea obtener el certificado o comprobar TLS sin backend**. Las pruebas futuras WSS incluirán tres clientes, permisos, reconexiones y PNG de 12 MiB. Ninguna se declara superada por instalar solo HTTPS.

## 7. Aislamiento y rollback de la futura instalación HTTPS

El ámbito autorizado debería limitarse a dos archivos/enlaces de vhost, webroot nuevo, lineage nuevo, hook específico, logs propios y reloads validados. No modificar `ports.conf`, el vhost predeterminado, módulos globales, certificados de otros nombres, rutas de aplicaciones, MariaDB, firewall, SSH, router, DNS o Pages.

Apache es compartido: **no se puede garantizar impacto cero por adelantado**. Confirmar baseline, validar sintaxis global antes de cada reload y detenerse si cambia la salud de cualquier sitio. No reiniciar Apache, Raspberry ni otros servicios.

Rollback propuesto, solo si se autoriza la instalación:

1. Deshabilitar exclusivamente `api-naufragio-ssl.conf` y `api-naufragio.conf`; restaurar cualquier versión previa de esos archivos si existía, sin sobrescribir cambios concurrentes. Validar y recargar Apache. Confirmar nuevamente todos los sitios y servicios del baseline.
2. No revertir el A directo del propietario ni tocar DuckDNS: no forman parte de estos cambios.
3. Mantener temporalmente el lineage nuevo o, si se autoriza su retirada y no tiene referencias, usar `certbot delete --cert-name api.naufragio.net` tras revisar su ámbito. No borrar lineages manualmente ni revocar los existentes.
4. Retirar hook/webroot propios solo después de eliminar sus referencias y su renovación. Borrar exclusivamente recursos creados y registrados para esta instalación; no usar comodines sobre certificados o directorios compartidos. Mantener los logs según la política operativa.
5. Verificar ausencia de listener 3400, sin backend instalado ni cambios en Pages. La limpieza no necesita modificaciones SSH, firewall, DNS ni reinicios.

## 8. Operaciones que necesitan autorización

| Operación | Estado / condición |
| --- | --- |
| Sudo para lecturas de validación global | **No disponible ahora**. Es el impedimento actual antes de comenzar las escrituras. |
| Crear webroot y vhost HTTP exclusivo; configtest y reload | Pendiente de autorización tras validación privilegiada satisfactoria. |
| Fichero sintético de challenge y comprobación exterior | Pendiente; debe pasar antes de ACME. Si falla, diagnosticar sin cambiar red. |
| Ejecutar dry-run ACME staging | Pendiente de autorización; no ejecutado. |
| Emitir certificado exclusivo y crear hook específico | Pendiente de autorización y staging satisfactorio. |
| Crear/habilitar vhost TLS, redirección y reload | Pendiente de certificado válido, autorización y validación global. |
| Probar renovación y hook/reload; ejecutar rollback si falla | Debe incluirse expresamente en el ámbito autorizado. |

**No son obstáculos actuales:** CAA, el MX coexistente, ausencia de un certificado previo para `api`, ni que Node esté detenido. **No forman parte de esta autorización:** actualizar DNS automáticamente, publicar backend, abrir puertos o cambiar Pages. No hay gestiones de soporte que encargar al propietario.
