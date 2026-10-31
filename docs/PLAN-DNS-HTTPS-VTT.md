# Naufragio VTT — Preparación DNS, HTTPS y WSS

Fecha: **31 de octubre de 2026**. Auditoría iniciada a las 08:10 UTC. Repositorio `naufragio-rolero/vtt-naufragio`, rama `feat/backend-multijugador`, base inspeccionada `5d5eee5800a3112730cace8f97f5a175ce807d91`.

**Resultado: arquitectura recomendada, pendiente de comprobaciones y autorización para ejecutarla. No se ha publicado ni instalado el VTT.** Raspberry se ha consultado exclusivamente mediante SSH de lectura. No se ha editado ni recargado Apache, SSH, DNS, DuckDNS, certificados, firewall, router ni servicios. Este informe es el único archivo que se propone guardar en GitHub; los cambios documentales anteriores del workspace se conservan aparte.

## 1. Decisión propuesta y condiciones pendientes

Usar **`https://api.naufragio.net`**, con un CNAME hacia **`naufragio-heavensgate.duckdns.org`**, un virtual host Apache independiente y un certificado exclusivo para `api.naufragio.net`. Node debe escuchar únicamente en **`127.0.0.1:3400`**. La actualización DuckDNS existente mantendría el destino: **no hace falta registrar otro subdominio DuckDNS ni modificar su actualizador**.

Esta propuesta todavía no está lista para aplicarse:

1. **DNS y correo:** no aparecen A, AAAA ni CNAME para `api.naufragio.net`, pero **sí un MX efectivo**. Un nombre de control aleatorio devuelve el mismo MX: es compatible con un comodín. El propietario debe comprobar el panel DNS y el uso del correo antes de añadir el CNAME; no se ha demostrado la ausencia de registros incompatibles explícitos.
2. **CAA del destino:** las consultas CAA a `naufragio-heavensgate.duckdns.org` fallan con SERVFAIL o timeout. Google DNS sobre HTTPS confirma SERVFAIL. Hay que aclararlo antes de solicitar un certificado; no equivale a «no hay restricciones CAA».
3. **Red exterior:** HTTPS local funciona, pero **no se ha acreditado el acceso desde una red independiente**. Falta revisar router/NAT/CG-NAT y reglas efectivas de firewall con el propietario.
4. **Privilegios:** `sudo -n true` no está autorizado en esta sesión. No se han solicitado contraseñas. Quedan pendientes el análisis completo de Apache y sus includes privados, reglas UFW y hooks globales de renovación. No se necesita modificar SSH para esta auditoría ni para que Apache se conecte a loopback.
5. **Límites detrás del proxy:** el backend actual agrupa por `request.socket.remoteAddress`. Con Apache, todos los clientes comparten loopback y los límites de autenticación/conexión. Añadir encabezados no corrige este comportamiento. Hay que decidir una política probada antes de abrir una beta pública; este trabajo no cambia código ni eleva límites.

## 2. Método y significado de las evidencias

| Marca | Significado |
| --- | --- |
| Comprobado | Consulta DNS, lectura de configuración accesible, código o respuesta observada en esta auditoría. |
| Probable | Inferencia consistente con los datos, sin verificación suficiente del mecanismo completo. |
| Propietario / pendiente | Requiere panel DNS, red exterior, permisos adicionales o decisión operativa. |

Se consultaron Cloudflare `1.1.1.1` y Google `8.8.8.8` directamente, sin depender del archivo `hosts` de Windows. Para los registros de correo se contrastaron también ambos servidores autoritativos de `naufragio.net`. Las conexiones TLS locales utilizaron SNI y validación de cadena/nombre, **sin `-k`**. Las sondas HTTP fueron anónimas a `/`, sin login ni inspección de contenido de aplicaciones.

Se leyeron solamente directivas seleccionadas de vhosts, parámetros no sensibles de renovación, nombres de módulos y metadatos de systemd. No se reprodujeron claves, tokens, URLs de actualización con credenciales, configuraciones privadas completas ni archivos de Heaven's Gate. Los scripts locales de diagnóstico fueron temporales; no forman parte de la entrega.

## 3. Inventario DNS y actualización dinámica

### 3.1 Nombres que corresponden actualmente a la instalación

**Comprobado:** los seis nombres siguientes tienen el mismo A público, **`188.78.105.221`**, tanto en Cloudflare como en Google. No se obtuvo AAAA para ninguno (`ENODATA`). Una consulta HTTPS de IP de salida desde Raspberry devolvió exactamente esa IPv4. Los seis nombres aparecen en virtual hosts habilitados de esa Raspberry y presentan certificados propios mediante SNI local.

| Nombre DuckDNS | A público | Servicio observado localmente | HTTP HTTPS local |
| --- | --- | --- | ---: |
| `naufragio-heavensgate.duckdns.org` | `188.78.105.221` | Heaven's Gate | 200 |
| `naufragio-foros.duckdns.org` | `188.78.105.221` | Foro | 200 |
| `autonaufragio.duckdns.org` | `188.78.105.221` | Proxy HTTP a aplicación loopback existente | 404 |
| `bibprof.duckdns.org` | `188.78.105.221` | Sitio existente independiente | 200 |
| `ordenanthia.duckdns.org` | `188.78.105.221` | Sitio existente independiente | 200 |
| `starkvind-gallery.duckdns.org` | `188.78.105.221` | Galería existente | 200 |

La IPv4 es una instantánea dinámica, **no un registro A recomendado para copiar a `api`**. El 404 de `autonaufragio` coincide con el observado en el piloto anterior; no prueba la salud funcional de todas sus rutas. Una misma IP pública no demuestra por sí sola que todas las conexiones entrantes lleguen a esa máquina.

Hay seis nombres existentes en esta instalación, no solo los tres citados en la petición. No se ha accedido al panel DuckDNS ni comprobado cuántas cuentas o cuotas los gestionan. **No se deduce de ello que una sola cuenta tenga seis dominios disponibles.** Reutilizar el destino elegido evita consumir una plaza, con independencia de esa distribución.

### 3.2 Actualizador existente

**Comprobado:** `duckdns-update.timer` está activo, con `OnBootSec=2min`, `OnUnitActiveSec=5min` y `Persistent=true`. Ejecuta `duckdns-update.service`; el ejecutable existente se llama `duckdns-update`. Su lectura filtrada identifica los seis nombres anteriores y uso de la API HTTPS DuckDNS. No se ejecutó manualmente ni se mostraron sus credenciales.

Última ejecución observada: **31/10/2026 09:09:44 CET**, `Result=success`, `ExecMainStatus=0`. Esto acredita que el servicio terminó correctamente; no sustituye una comprobación histórica de cada actualización ni demuestra la respuesta individual para cada nombre tras un cambio de IP.

El CNAME propuesto seguirá las actualizaciones de ese nombre sin añadirlo al script ni copiar el token DuckDNS al VTT. La API permite actualizar nombres existentes y autodetectar IPv4 cuando no se proporciona dirección; esa capacidad está documentada, pero no se presupone aquí qué variante exacta usa cada actualización existente. [Especificación oficial DuckDNS](https://www.duckdns.org/spec.jsp).

### 3.3 Zona `naufragio.net` y posible conflicto en `api`

**Comprobado:** NS `docks02.rzone.de` y `shades04.rzone.de`; SOA consultado con serial `2020061952`. El proveedor aparente es STRATO/rzone; el acceso administrativo del propietario no se ha verificado.

| Consulta | Resultado observado |
| --- | --- |
| `naufragio.net A` | `81.169.145.70`, distinto del destino Raspberry. |
| `naufragio.net AAAA` | `2a01:238:20a:202:1070::`, alojamiento diferente. |
| `naufragio.net MX` | Prioridad 5, `smtp.rzone.de`. |
| `api.naufragio.net A / AAAA / CNAME` | `ENODATA` en ambos resolutores. No es un NXDOMAIN demostrado. |
| `api.naufragio.net MX` | Prioridad 5, `smtp.rzone.de`, confirmado por ambos autoritativos. |
| `audit-20261031-noexist.naufragio.net MX` | Mismo MX, confirmado por ambos autoritativos: indicio de comodín. |
| `api.naufragio.net TXT / NS / HTTPS` | Google DNS sobre HTTPS: NOERROR sin respuestas. |
| `api.naufragio.net CAA` y `naufragio.net CAA` | Sin datos en consultas satisfactorias. |
| CAA del destino DuckDNS | SERVFAIL/timeouts; Google DoH: status 2, «Suspicious or confusing response received». |
| CAA de `duckdns.org` | Google DoH: NOERROR sin respuestas; no resuelve el error del subdominio. |

Las consultas CNAME de los nombres DuckDNS también presentaron SERVFAIL/timeouts, aunque A/AAAA respondían. La causa no se atribuye definitivamente a DNSSEC, al proveedor ni a la red: falta diagnóstico autoritativo específico. No se ha emitido ni intentado emitir un certificado durante esta auditoría.

**Acción del propietario:** consultar los registros explícitos de `api` y posibles comodines en el panel. Si el MX es explícito, no puede coexistir con CNAME: primero decidir su retirada, previa comprobación de que no se usa correo para ese nombre. Si procede de un comodín, crear el CNAME explícito puede sustituir su síntesis para `api`, sin borrar el comodín ni el MX del dominio raíz; verificar el comportamiento del proveedor. Conservar exportación privada del estado anterior. No cambiar A/AAAA/MX del dominio raíz.

CAA sigue los CNAME y los errores impiden determinar si una CA tiene permiso para emitir. No añadir un CAA al mismo nombre que el CNAME ni desactivar validaciones para evitar el problema. Repetir las consultas y, si persiste, consultar al proveedor; una prueba ACME staging será una operación futura autorizada. [Let's Encrypt: CAA y errores DNS](https://letsencrypt.org/docs/caa/).

### 3.4 Registro propuesto, no creado

```dns
; Zona naufragio.net — solo tras comprobar correo y registros explícitos
api  300  IN  CNAME  naufragio-heavensgate.duckdns.org.
```

TTL inicial propuesto: 300 s, sujeto a los mínimos del proveedor. No añadir A/AAAA en `api`, no crear otro nombre DuckDNS y no alterar el actualizador. No crear un AAAA hacia la IPv6 del alojamiento del dominio raíz. Tras propagación, la resolución de `api` debe encadenar al destino DuckDNS y terminar en su IP vigente; no hereda automáticamente el certificado de ese destino.

## 4. Conectividad, NAT y exposición

**Comprobado en Raspberry:** listeners TCP 80/443 en interfaces de red; MariaDB 3306 y la aplicación 8787 solo en loopback. Otros servicios existentes conservan sus listeners. **No hay listener 3400**, ni se ha arrancado el VTT. Apache, MariaDB, SSH y SMB permanecen activos en las lecturas realizadas. Memoria total 920 MiB, disponible aproximadamente 513–518 MiB, swap usada 318 MiB; temperatura observada 56,920–57,996 °C. Son mediciones de inventario, sin carga VTT.

**Comprobado en Windows:** el archivo `hosts` contiene overrides privados para Heaven's Gate y el foro. `curl` a sus nombres devuelve 200 con TLS válido, pero conecta a una dirección LAN. `autonaufragio` devuelve 404 con TLS válido conectando a la IPv4 pública. Los tiempos de una muestra fueron 318, 203 y 313 ms respectivamente; no son un benchmark.

**No comprobado:** que la conexión a la IP pública desde Windows salga realmente a Internet; podría ser NAT loopback. El servicio web externo utilizado para intentar acceder a los dominios devolvió «not accessible via this tool», sin una respuesta HTTP utilizable. Ese resultado no acredita ni descarta disponibilidad exterior. No se ha hecho una prueba 4G ni una prueba WSS pública.

`ufw` está activo, pero `ufw status` sin privilegios termina con `ERROR: You need to be root to run this script`. No se han leído reglas efectivas ni configuración del router. La coincidencia entre A y salida WAN es consistente con el destino esperado, **no demuestra ausencia de CG-NAT ni un DNAT correcto**.

### Verificaciones del propietario antes de publicar

1. Desde otra red real, sin VPN hacia la LAN ni overrides `hosts`, comprobar HTTP/HTTPS con SNI correcto para los nombres existentes. Registrar red de origen, fecha, IP destino, código y validación TLS.
2. Revisar WAN del router frente a la IP pública y la posible presencia de doble NAT/CG-NAT. Verificar las redirecciones actuales de TCP 80/443 hacia Apache y las reglas efectivas UFW/nftables. No habilitar UPnP ni crear reglas por inferencia.
3. Confirmar que **no existe redirección, proxy adicional o regla de publicación para 3400**, en IPv4 e IPv6. Después del futuro arranque, exigir bind exclusivo loopback; nunca `0.0.0.0` ni `::`.
4. Si 80/443 ya llegan correctamente a Apache, el nuevo vhost usa esos mismos puertos: no necesita otro puerto de router/firewall. Si no llegan, detener la instalación y presentar la modificación de red para autorización separada.

## 5. Apache y certificados actuales

**Comprobado:** Apache **2.4.69 Raspbian**, arquitectura ARMv7. Los enlaces de `mods-enabled` incluyen `proxy`, `proxy_http`, `ssl`, `headers`, `rewrite`, `proxy_fcgi` y `reqtimeout`. No aparece `proxy_wstunnel` en esa lista filtrada; esta versión puede tramitar el upgrade mediante `proxy_http`. Se identifica configuración habilitada, no una validación privilegiada de todos los módulos del proceso vivo.

Cada uno de los seis dominios públicos tiene archivos independientes `nombre.conf` para HTTP y `nombre-le-ssl.conf` para HTTPS. Los vhosts HTTP redirigen a HTTPS. `autonaufragio` tiene proxy raíz a la aplicación loopback existente; no debe reutilizarse su ruta ni su upstream para VTT. Hay además un vhost LAN y bloques predeterminados de denegación para HTTP/HTTPS. Ninguno de los `ServerName` públicos seleccionados es `api.naufragio.net`; falta descartar aliases o reglas en includes no accesibles.

**Límite exacto:** `apache2ctl -S` y `-M` terminan con salida 1 porque no se puede leer un include privado de otro sitio (`Permission denied`). Esto **no demuestra una sintaxis inválida de la configuración ejecutada por root**. No se abrió ese include ni se intentó eludir sus permisos. Antes de cualquier cambio, el propietario debe ejecutar con privilegios `apache2ctl configtest`, `apache2ctl -S` y `apache2ctl -M`, revisando solamente resultados necesarios y sin publicar secretos.

### Certificados presentados en TLS local

Todos validaron cadena y hostname. El SAN observado contiene únicamente el nombre de su fila. Rutas configuradas: lineages individuales de `/etc/letsencrypt/live/<dominio>/`; no se leyeron claves privadas.

| Nombre | Emisor Let's Encrypt | Vencimiento UTC |
| --- | --- | --- |
| `naufragio-heavensgate.duckdns.org` | YR1 | 2027-01-06 16:35:59 |
| `naufragio-foros.duckdns.org` | YR1 | 2026-12-16 20:19:54 |
| `autonaufragio.duckdns.org` | YR1 | 2027-01-08 07:38:50 |
| `bibprof.duckdns.org` | YR1 | 2027-01-18 22:10:02 |
| `ordenanthia.duckdns.org` | YR2 | 2026-12-22 16:23:25 |
| `starkvind-gallery.duckdns.org` | YR2 | 2026-12-20 08:31:56 |

**Renovación comprobada:** Certbot **4.0.0** instalado. Las seis configuraciones de renovación accesibles indican `authenticator=apache`, `installer=apache`, servidor ACME de producción Let's Encrypt y ausencia de hooks definidos en esos archivos. No se ha confirmado la ausencia de hooks globales o configuración global sensible.

`certbot.timer` está activo: `OnCalendar=*-*-* 00,12:00:00`, `RandomizedDelaySec=43200`, `Persistent=true`. Última ejecución observada: 31/10/2026 09:09:35 CET, salida 0. Existe además `/etc/cron.d/certbot` con horario `0 */12 * * *`; no se presupone que ambos mecanismos ejecuten renovaciones duplicadas, pues el cron puede incluir guardas para systemd. No modificar ninguno durante la preparación. Una salida 0 del timer **no demuestra que todos los certificados se hayan renovado en esa ejecución**.

## 6. Arquitectura recomendada e impacto

```text
Navegadores → GitHub Pages: frontend estático y estado local del director
      │
      └─ HTTPS / WSS → api.naufragio.net
                         CNAME → DuckDNS existente → IP pública vigente
                         router TCP 80/443 → Apache, vhost exclusivo
                                              │ HTTP / WS local
                                              └─ 127.0.0.1:3400 → Node 22 ARMv7
                                                                   └─ SQLite: identidad y metadatos
```

Separar nombre, certificado, logs, servicio y almacenamiento reduce el riesgo de colisión con Heaven's Gate y el foro. Apache sigue siendo un recurso compartido: cualquier reload autorizado exige validación global y sondas antes/después; CPU/RAM/conexiones de VTT también pueden afectar a otros sitios. Un vhost independiente no garantiza aislamiento de recursos por sí solo.

**Alternativa `https://naufragio-heavensgate.duckdns.org/api`:** reutilizaría el certificado actual para ese hostname y no requiere un CNAME, pero obligaría a editar el vhost de Heaven's Gate, revisar colisiones con `/api`, ajustar prefijos de API/Socket.IO y probar reescrituras y clientes. El proxy `/socket.io/` por defecto no se puede asumir correcto bajo `/api`. Se desaconseja como primera opción por el impacto directo sobre ese servicio; no se prepara ni aplica un cambio a su vhost.

## 7. Propuesta Apache, pendiente de revisión privilegiada

**Ejemplo, no instalado ni validado contra la configuración completa del host.** Archivo futuro independiente `api-naufragio.conf`. Antes de emitir el certificado se habilitaría **solo el bloque de puerto 80**, inicialmente sin las tres directivas de redirección `Rewrite`, para comprobar el challenge sin referencias a certificados inexistentes.

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

    # Incorporar estas tres directivas después de disponer de HTTPS válido:
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://api.naufragio.net%{REQUEST_URI} [R=301,L,NE]
</VirtualHost>

<VirtualHost *:443>
    ServerName api.naufragio.net
    SSLEngine on
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCertificateFile /etc/letsencrypt/live/api.naufragio.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/api.naufragio.net/privkey.pem

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

    ErrorLog ${APACHE_LOG_DIR}/naufragio-vtt-error.log
    # %U no registra la consulta; no registrar Authorization, Cookie ni cuerpos.
    CustomLog ${APACHE_LOG_DIR}/naufragio-vtt-access.log "%h %t \"%m %U %H\" %>s %b"
</VirtualHost>
```

El orden conserva la regla específica de Socket.IO antes de la raíz; el upgrade solo se habilita en esa ruta. No se fuerzan globalmente `Connection: Upgrade` ni `Upgrade: websocket`, para mantener polling HTTP. Apache 2.4.47+ ofrece `upgrade=websocket` mediante `proxy_http`; no hace falta instalar otro proxy. [Apache: proxy y upgrade](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#examples).

Los encabezados enviados por el cliente se descartan antes de que Apache genere sus propios datos de proxy. No se borra `Origin` ni se añaden CORS comodín. Esto prepara encabezados fiables en una topología directa, **pero el backend actual no los usa para identificar IP**. Si se añade un CDN/proxy delante, deberá revisarse la cadena de confianza antes de aplicar este ejemplo. [Apache: encabezados de proxy](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxyaddheaders).

`timeout=120` supera el heartbeat habitual de Socket.IO. Se mantienen ruta y consultas del transporte y se comprobarán tanto polling como upgrade 101; un simple `/health` no valida WSS. `LimitRequestBody` limita cuerpos HTTP, no el total de una imagen transmitida por fragmentos WebSocket. La configuración propuesta requiere validar también polling para el PNG de 12 MiB. [Socket.IO: proxy inverso y tiempos](https://socket.io/docs/v4/reverse-proxy/).

Revisar herencia TLS, HSTS, logs globales, filtros y límites antes de instalar. No copiar includes de secretos de otros vhosts ni asignar al VTT permisos sobre sus documentos o certificados. No ampliar HSTS a subdominios desde el dominio raíz como parte de este cambio.

## 8. Certificado nuevo y renovación: procedimiento futuro

**No se ha ejecutado ninguno de estos pasos de instalación.** Exigen aprobación separada del propietario y resolver los puntos 1–5 de la primera sección.

1. Exportar privadamente el estado DNS relevante y respaldar el futuro ámbito de cambio Apache. Confirmar vhosts/módulos/sintaxis con privilegios, reglas de red, hooks globales y que el nuevo nombre de certificado no existe. Registrar baseline de los seis sitios y sus certificados.
2. Crear el CNAME aprobado, con la salvedad del MX. Esperar propagación positiva y negativa; comprobar desde dos resolutores y ambos autoritativos. Repetir CAA del nombre y su cadena hasta obtener respuestas válidas. No cambiar el dominio raíz ni DuckDNS.
3. Crear el webroot dedicado `/var/lib/naufragio-vtt-acme/.well-known/acme-challenge/`, con permisos de lectura mínimos para Apache; habilitar únicamente el vhost HTTP del ejemplo, **sin redirección todavía**. Validar configuración global y hacer reload autorizado. Comprobar un fichero sintético de challenge desde una red externa real y eliminar ese fichero de prueba.
4. Usar **HTTP-01 con `certonly --webroot`**, no standalone ni expansión del certificado de Heaven's Gate. HTTP-01 necesita entrada TCP 80; puede validar un nombre con CNAME. Si 80 está bloqueado, detenerse: DNS-01 sería otra propuesta con acceso a la zona `_acme-challenge.api.naufragio.net`, automatización y autorización propias, no una excusa para usar tokens DuckDNS en scripts públicos. [Let's Encrypt: validación HTTP-01 y DNS-01](https://letsencrypt.org/docs/challenge-types/).
5. Probar ACME staging/dry-run de la emisión y después solicitar el certificado de producción. Los siguientes comandos son un plan para un operador autorizado; pueden escribir archivos y ejecutar hooks, **no son consultas de auditoría**:

```sh
sudo certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net --dry-run

# Tras aprobar resultado, cuenta ACME y condiciones del proveedor:
sudo certbot certonly --webroot \
  --webroot-path /var/lib/naufragio-vtt-acme \
  --cert-name api.naufragio.net -d api.naufragio.net \
  --deploy-hook '/usr/sbin/apache2ctl configtest && /usr/bin/systemctl reload apache2'
```

6. Comprobar el SAN exacto, emisor y fechas del nuevo certificado; solo entonces habilitar el vhost 443 y añadir la redirección HTTP excluyendo challenges. Ejecutar `sudo apache2ctl configtest`, revisar `-S` y hacer reload, **sin restart**. Verificar todos los servicios antes/después y abortar ante degradación.
7. Mantener el `certbot.timer` existente, sin otro cron/timer. Comprobar que la nueva renovación guarda autenticador webroot, su ruta y el deploy hook limitado a este lineage; revisar interferencias de hooks globales. El hook valida Apache antes del reload; un fallo del hook exige alerta y comprobación del certificado servido, aunque se haya renovado el fichero. Probar en una ventana autorizada:

```sh
sudo certbot renew --cert-name api.naufragio.net --dry-run
# Solo con autorización para probar también el reload del hook:
sudo certbot renew --cert-name api.naufragio.net --dry-run --run-deploy-hooks
```

`certonly` permite obtener el certificado sin editar automáticamente los vhosts; el deploy hook se ejecuta tras emisión/renovación correcta. No ejecutar `renew --force-renewal` ni renovar todos los sitios para probar este cambio. Los hooks existentes se revisan antes incluso del dry-run. Supervisar vencimiento del certificado **servido**, timer, resultados ACME y hook; no fijar un supuesto período de validez ni confiar solo en una salida 0. [Certbot: webroot, renovación y hooks](https://eff-certbot.readthedocs.io/en/stable/using.html).

## 9. Configuración VTT y seguridad

### Configuración propuesta, sin aplicación

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3400
ALLOWED_ORIGINS=https://naufragio-rolero.github.io
SOCKET_PATH=/socket.io
MAX_BODY_BYTES=16384
MAX_MESSAGE_BYTES=65536
ENABLE_DIAGNOSTICS=false
DATABASE_PATH=/var/lib/naufragio-vtt/naufragio.sqlite
```

El directorio de SQLite es una **propuesta futura**, no una ruta creada o reservada. Usar cuenta de servicio exclusiva sin sudo, código de solo lectura, almacenamiento privado de metadatos, límites de recursos y respaldo coherente de SQLite. No compartir usuario/directorio de Heaven's Gate, MariaDB ni el servicio de `autonaufragio`. El runtime ARMv7 y su mantenimiento deben seguir el plan operativo previo; esta auditoría no instala Node.

Configuración pública futura del frontend: `apiBaseUrl` y `realtimeBaseUrl` = `https://api.naufragio.net`, `socketPath` = `/socket.io`, junto al resto del esquema existente. Ningún secreto en ese JSON. Publicarlo en Pages requerirá otra autorización; ahora no se cambia el frontend ni su despliegue.

### Comprobaciones sobre el código de la rama

| Control | Evidencia y consecuencia |
| --- | --- |
| Origen exacto | `backend/src/config.js:18–26` valida orígenes sin ruta. **Correcto:** `https://naufragio-rolero.github.io`. Incorrecto: añadir `/vtt-naufragio/`, barra final o `*`. |
| CORS HTTP | `backend/src/server.js:62–79`: origen presente fuera de lista → 403; OPTIONS permite Authorization/Content-Type y métodos definidos. La ausencia de Origin en HTTP no es por sí sola un rechazo: siguen siendo necesarias autenticación y permisos. |
| WebSocket | `backend/src/realtime.js:18–39`: `allowRequest` y middleware Engine.IO verifican Origin, también en polling/upgrade. No confiar solo en CORS para WSS. |
| Límites actuales | HTTP 120/min, handshake 20/min, autenticación costosa 10/5 min, entrada por código 10/5 min, eventos ordinarios 120/min y 32 conexiones de capacidad por defecto. La entrada por código usa `authWindowMs`, no `rateWindowMs` (`auth/routes.js:14`). Las rutas de recursos pueden tener sus propios controles adicionales. |
| Proxy e IP | `server.js:64`, `auth/routes.js:59–60`, `realtime.js:20`: usan dirección del socket TCP. **Todos los visitantes detrás de Apache comparten los límites por IP.** Afecta también a intentos exitosos costosos y reconexiones; no es aislamiento entre usuarios. |
| Tamaños | JSON HTTP 16 KiB y mensajes Socket.IO 64 KiB por defecto (`config.js:42–43`). No usar el antiguo `MAX_MESSAGE_BYTES=16384` de ejemplos previos para Fase 6. El PNG de 12 MiB se fragmenta; no ampliar a 12 MiB el límite por mensaje. |
| Persistencia | Mantener SQLite solo para cuentas y metadatos; no crear un directorio público de imágenes ni un endpoint de subida como parte de este proxy. No activar volcado de cuerpos o mensajes en logs. |

Los límites por IP compartidos permiten que un cliente agote el cupo de otros sin eludir autenticación. **Decisión pendiente antes de publicar:** diseñar y probar una identificación de cliente con proxy de confianza estrictamente definido y controles agregados/per cuenta, o aceptar expresamente un piloto restringido con el comportamiento actual y capacidad medida. No basta con habilitar `mod_remoteip` en Apache: no cambia `remoteAddress` del socket que recibe Node. Tampoco se debe confiar globalmente en cualquier `X-Forwarded-For` ni subir límites sin medición. No se ha corregido el código en esta tarea.

El origen GitHub Pages abarca **todos los proyectos bajo `naufragio-rolero.github.io`**, no solo la subruta VTT. No puede restringirse a una ruta mediante CORS. Un cliente no navegador puede falsificar Origin: cuentas, pertenencia y permisos continúan siendo obligatorios. [Socket.IO: alcance de CORS y `allowRequest`](https://socket.io/docs/v4/handling-cors/).

## 10. Aceptación futura antes de publicar una beta

Esta lista es un procedimiento pendiente, **no resultados obtenidos contra una API pública**:

1. DNS: CNAME exacto, A final vigente, ausencia de AAAA inesperado y CAA satisfactorio; revisar el efecto sobre el MX de `api` sin alterar correo raíz.
2. HTTPS desde red externa: certificado para `api.naufragio.net`, cadena válida, HTTP→HTTPS conservando ruta y consulta, challenge accesible para renovación, sin depender de `hosts`.
3. Backend: listener únicamente `127.0.0.1:3400`, sin NAT/publicación directa del puerto. `/health` HTTPS devuelve el servicio VTT; Node caído produce fallo contenido del proxy y no sirve otro sitio por error.
4. CORS: OPTIONS desde el origen Pages correcto permite Authorization/Content-Type; origen ajeno se rechaza. Repetir handshake/upgrade con origen ajeno y sin Origin, sin credenciales reales en URLs ni logs.
5. Socket.IO: probar WebSocket con 101 y polling por separado, reconexiones tras cortes y continuidad durante más de cinco minutos. Verificar que no se confunde path de transporte con namespace de juego.
6. Tres navegadores: director y dos jugadores; login, invitaciones, permisos, movimiento, cambio de mapa, PNG válido de **12 MiB a ambos**, SHA-256, interrupción de un jugador sin expulsar al director, incorporación tardía y recuperación desde IndexedDB. Aislar dos salas y rechazar suplantaciones/permisos revocados.
7. Medir autenticaciones/reconexiones y límites compartidos con tres clientes, incluyendo intentos fallidos. CPU/RSS/temperatura y MemAvailable, sin degradar Heaven's Gate, foro y otros sitios. El piloto SSH previo no acredita este trayecto Apache/Internet.
8. Confirmar que imágenes no se guardan en SQLite, archivos, dumps, logs o caché de proxy; comprobar limpieza de procesos/temporizadores y rechazo de límites de tamaño. Revisar logs saneados de **este** vhost y el servicio.
9. Dry-run de renovación limitada al certificado nuevo, prueba autorizada del hook y comprobación del certificado servido. Aceptación del propietario y autorización específica antes de instalación permanente o cambios en Pages.

## 11. Rollback propuesto

No hay rollback de infraestructura que ejecutar ahora: **la auditoría no la ha modificado**. Para una futura implantación autorizada:

1. Detener solo el servicio VTT creado, verificando su unidad/PID. Deshabilitar exclusivamente el nuevo vhost `api-naufragio.conf`, validar la configuración global y recargar Apache en la ventana autorizada. No restaurar un árbol completo de configuración sobre cambios concurrentes.
2. Restaurar únicamente los registros DNS nuevos/modificados de `api` desde la exportación previa. Si había MX explícito y se retiró con aprobación, restaurarlo; si era comodín, no tocar el comodín. Mantener el destino y actualizador DuckDNS originales. Considerar TTL y cachés negativos.
3. No retirar certificados compartidos ni modificar renovaciones de los seis sitios. Mantener temporalmente el certificado nuevo o, tras verificar que no tiene referencias, retirarlo mediante una operación específica de Certbot autorizada; no borrar lineages manualmente ni revocar certificados de terceros.
4. Si se borra el webroot/hook nuevo, hacerlo solo después de desactivar sus referencias y su renovación. Conservar backups de metadatos conforme a la decisión de retención; no borrar archivos por comodines ni tocar rutas de aplicaciones existentes.
5. Verificar otra vez todos los sitios con SNI, certificados, Apache/MariaDB/SSH/SMB activos y puerto 3400 sin listener. Comparar el ámbito de configuración cambiado y comprobar desde red externa. No necesita cambios o rollback de SSH, UFW, router, DNS raíz ni Pages si se ha seguido el plan sin ampliaciones.

## 12. Cierre y decisiones del propietario

**Viable como arquitectura; no autorizado ni suficientemente verificado para publicarlo todavía.** La separación `api.naufragio.net` → DuckDNS existente → vhost independiente evita consumir otro dominio DuckDNS y evita introducir rutas nuevas dentro de Heaven's Gate.

Pendientes concretos: acceso del propietario a la zona `naufragio.net` y revisión MX/comodín; aclaración de errores CAA; prueba exterior y revisión NAT/firewall; lectura privilegiada de la configuración Apache efectiva y hooks; política de límites detrás del proxy; aprobación de nombre final, cuenta/directorio de servicio y ventana de cambios. La emisión, los reloads, el arranque permanente y la publicación de configuración en Pages requieren autorización futura.

Se conservaron los cambios previos de la rama y no se tocaron sus archivos de código. Las conexiones de auditoría SSH terminaron tras cada consulta, sin túneles, procesos de piloto ni ficheros temporales creados en Raspberry. Las pruebas descritas aquí no equivalen a un despliegue ni a una validación pública de Fase 6.
