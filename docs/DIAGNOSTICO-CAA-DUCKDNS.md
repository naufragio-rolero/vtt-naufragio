# Diagnóstico CAA/SERVFAIL de DuckDNS

Fecha: **31 de octubre de 2026**, consultas entre aproximadamente 09:04 y 09:08 UTC. Rama local `feat/backend-multijugador`; código base `5d5eee58`. Complementa [el plan DNS/HTTPS](PLAN-DNS-HTTPS-VTT.md), sin aplicar su instalación.

## Resultado

**Se ha identificado una respuesta DNS anómala en las consultas directas a los nueve autoritativos anunciados por DuckDNS.** Para `naufragio-heavensgate.duckdns.org`, una pregunta **CAA, tipo 257**, recibe en Answer un **A, tipo 1**, sin CAA ni SOA. No es una respuesta válida de ausencia de CAA. Los resolutores públicos terminan con SERVFAIL o timeout al resolver esa consulta y la del alias `api.naufragio.net`.

El CNAME de STRATO se conserva íntegramente. No se ha cambiado ningún registro, certificado, servicio, firewall ni archivo de Raspberry. No se ha solicitado un certificado ni ejecutado el actualizador DuckDNS. Este diagnóstico tampoco envía una incidencia al proveedor.

## 1. Evidencia directa, sin resolutor recursivo intermedio

Se construyeron consultas DNS binarias dirigidas a cada dirección autoritativa, UDP/53, `RD=0`, clase IN. Se verificaron identificador de transacción, pregunta devuelta y tipos reales de los registros. La lista NS y sus direcciones se obtuvieron previamente de DNS público.

| Autoritativo | IPv4 consultada | Respuesta UDP a CAA del destino |
| --- | --- | --- |
| `ns1.duckdns.org` | `99.79.143.35` | A en Answer; sin CAA/SOA |
| `ns2.duckdns.org` | `35.182.183.211` | A en Answer; sin CAA/SOA |
| `ns3.duckdns.org` | `35.183.157.249` | A en Answer; sin CAA/SOA |
| `ns4.duckdns.org` | `3.97.51.116` | A en Answer; sin CAA/SOA |
| `ns5.duckdns.org` | `99.79.16.64` | A en Answer; sin CAA/SOA |
| `ns6.duckdns.org` | `3.97.58.28` | A en Answer; sin CAA/SOA |
| `ns7.duckdns.org` | `15.223.21.81` | A en Answer; sin CAA/SOA |
| `ns8.duckdns.org` | `15.223.106.16` | A en Answer; sin CAA/SOA |
| `ns9.duckdns.org` | `15.222.19.97` | A en Answer; sin CAA/SOA |

Patrón observado en todos ellos, repetido en una segunda pasada UDP:

```text
QUESTION: naufragio-heavensgate.duckdns.org IN CAA
QTYPE: 257
RCODE: 0 (NOERROR)
AA: 1; TC: 0; RA: 0
ANSWER: naufragio-heavensgate.duckdns.org 60 IN A 188.78.105.221
AUTHORITY: nueve registros NS de duckdns.org; ningún SOA
ADDITIONAL: direcciones A de los NS
Tamaño sin EDNS: 373 bytes
Identificador de respuesta y pregunta: coinciden con la consulta
```

En la repetición compacta del 09:07:56 UTC, los nueve tiempos UDP estuvieron entre **92 y 107 ms**. No es ausencia de respuesta UDP ni un paquete truncado que exija TCP: `TC=0`.

Cuando un autoritativo indica que no hay datos del tipo solicitado, debe incluir el SOA de la zona en Authority. Un A de la misma etiqueta no demuestra ausencia de CAA. [RFC 2308, sección 3](https://www.rfc-editor.org/rfc/rfc2308.html#section-3).

## 2. Controles para descartar errores del diagnóstico

| Control | Observación |
| --- | --- |
| A del destino, nueve NS | A esperado `188.78.105.221`, AA=1. |
| CAA con EDNS0, `ns1` | Mismo Answer A incorrecto; respuesta de 384 bytes. No depende de omitir EDNS. |
| CNAME del destino, `ns1`, EDNS0 | También devuelve A en vez de una respuesta negativa adecuada. El problema no se limita al tipo CAA. |
| AAAA del destino, `ns1`, EDNS0 | NOERROR, Answer vacío y SOA en Authority: respuesta negativa coherente. |
| CAA de `duckdns.org`, `ns1` | NOERROR, Answer vacío y SOA. El dominio raíz sí contesta de forma coherente. |
| CAA de `autonaufragio.duckdns.org`, `ns1` | Misma anomalía: devuelve A. No es exclusivo del nombre de Heaven's Gate. |
| CAA de nombre de control inexistente | NXDOMAIN, Answer vacío y SOA; no se registró ni modificó ese nombre. |
| TXT del destino | Registro TXT vacío, tipo 16, distinto de la respuesta incorrecta observada para CAA. |

**Segunda implementación:** desde Raspberry se repitieron las consultas UDP mediante Python estándar, con un generador/parser distinto del utilizado en Windows. `ns1` y `ns9` devolvieron de nuevo pregunta tipo 257 y Answer tipo 1. CAA del dominio raíz y AAAA del destino devolvieron los controles negativos con SOA. No había `dig` instalado en Raspberry y no se instaló.

Windows y Raspberry no se presentan como dos redes externas independientes. Su coincidencia descarta un problema exclusivo del parser JavaScript o del equipo Windows; no permite inspeccionar la implementación interna del proveedor.

## 3. TCP, resolutores públicos y DNSSEC

Las consultas CAA por TCP a los nueve NS agotaron el plazo de **2,5 s** desde Windows. En cambio, los controles DNS sobre TCP a Cloudflare y Google respondieron correctamente en aproximadamente **22 y 14 ms**. Hay, por tanto, una dificultad de acceso/respuesta TCP hacia esos destinos, no un bloqueo general de todo TCP/53 desde Windows. No se puede localizar con estas muestras si está en el proveedor o en un tramo de red; tampoco es necesaria para explicar el Answer UDP incorrecto.

Google DNS sobre HTTPS devuelve para el destino y `api.naufragio.net`:

```text
Status: 2 (SERVFAIL)
Comment: Suspicious or confusing response received.
```

La consulta con `cd=1` —pedir al resolutor que no valide DNSSEC para esa consulta diagnóstica— mantiene el mismo SERVFAIL. No se ha desactivado DNSSEC en ninguna configuración. La consulta DS de `duckdns.org` devolvió NOERROR sin DS, con SOA de `.org`. Estos datos no apoyan una firma DNSSEC inválida como explicación principal; la respuesta autoritativa incorrecta ya es observable sin validación DNSSEC.

## 4. Causa y límites de la conclusión

**Comprobado:** los nueve destinos autoritativos contestan CAA para el nombre existente con un registro de otro tipo, sin la respuesta negativa correspondiente. La anomalía persiste con EDNS0, en otra implementación y para otro dominio existente de la instalación. Los resolutores públicos rechazan la resolución CAA y siguen el fallo a través del CNAME.

**Diagnóstico:** la evidencia apunta al tratamiento de tipos DNS en la infraestructura autoritativa de DuckDNS para los nombres dinámicos existentes. No procede de un CAA restrictivo configurado en STRATO, ni se resolvería instalando un certificado distinto, editando Apache o esperando únicamente la propagación del CNAME.

**No comprobado:** qué componente interno del proveedor genera la respuesta —servidor DNS, configuración, capa frontal o filtrado—, desde cuándo ocurre ni si afecta a todas sus cuentas/regiones. No se ha inspeccionado su software, sus logs o su infraestructura. La atribución exacta interna requiere al proveedor; no corresponde afirmar una línea de código concreta.

Una respuesta CAA vacía válida es distinta de un error de resolución. Let's Encrypt documenta que los errores CAA impiden determinar si está autorizada a emitir; no se debe intentar evitarlos desactivando comprobaciones. [Let's Encrypt: CAA y errores](https://letsencrypt.org/docs/caa/). Véase también [RFC 8659, sección 6](https://www.rfc-editor.org/rfc/rfc8659.html#section-6).

## 5. Reproducción para una incidencia técnica

Comandos preparados para un equipo que ya disponga de `dig`; no se ejecutaron con esa herramienta en Raspberry:

```sh
dig @99.79.143.35 naufragio-heavensgate.duckdns.org CAA +norecurse +noedns
dig @15.222.19.97 naufragio-heavensgate.duckdns.org CAA +norecurse +noedns
dig @99.79.143.35 naufragio-heavensgate.duckdns.org CAA +norecurse +edns=0
dig @99.79.143.35 duckdns.org CAA +norecurse
dig @99.79.143.35 naufragio-heavensgate.duckdns.org AAAA +norecurse
dig @99.79.143.35 naufragio-heavensgate.duckdns.org CAA +tcp +time=3 +tries=1
dig @8.8.8.8 api.naufragio.net CAA
```

**Texto preparado, no enviado:**

> CAA queries (QTYPE 257, class IN, RD=0) for naufragio-heavensgate.duckdns.org return an authoritative NOERROR response containing an A RR in ANSWER, no CAA, and NS records instead of SOA in AUTHORITY. Reproduced against ns1–ns9.duckdns.org on 2026-10-31 around 09:05–09:08 UTC, with and without EDNS0, using separate Node.js and Python implementations. Apex CAA and the hostname's AAAA queries return proper empty answers with SOA. Google Public DNS reports SERVFAIL with “Suspicious or confusing response received”, also when CD=1. Please investigate QTYPE handling for existing dynamic hostnames and return a valid CAA RRset or authoritative NODATA with SOA.

No contiene tokens DuckDNS, claves SSH ni credenciales. No se ha enviado ningún mensaje a terceros.

## 6. Alternativa estudiada: A dinámico de STRATO, sin aplicarla

Se mantiene **`api.naufragio.net → naufragio-heavensgate.duckdns.org`**. La alternativa se estudia únicamente por si el proveedor no corrige el fallo.

**Mecanismo soportado identificado:** STRATO ofrece DynDNS para dominios y subdominios en determinados paquetes, con protocolo **DynDNS v2**, endpoint HTTPS **`https://dyndns.strato.com/nic/update`**, nombre objetivo y contraseña DynDNS independiente. No es necesario suponer que la API DNS de IONOS sea válida para esta cuenta STRATO. [Documentación oficial STRATO](https://www.strato.es/faq/hosting/como-configurar-dyndns-para-tus-dominios/).

El diseño futuro sería actualizar exclusivamente el A de `api.naufragio.net` mediante ese servicio, desde un cliente aislado: IP pública IPv4 validada, credencial fuera del repositorio y de argumentos/logs, ejecución al arrancar y comprobación periódica, reintentos limitados con backoff y verificación DNS posterior. Se conservaría el actualizador DuckDNS de los sitios existentes. No dejar un A manual fijo con la IP observada hoy.

**Pendiente, sin cambios:** comprobar que el paquete concreto permite DynDNS en ese subdominio, su alcance de credenciales, efectos sobre MX/AAAA y la frecuencia/cliente adecuados. Activar DynDNS limita otras opciones DNS del nombre; debe revisarse antes de sustituir el CNAME. [STRATO: comportamiento de DynDNS](https://www.strato-hosting.co.uk/faq/hosting/what-settings-can-i-configure-in-the-dynamic-dns-dyndns-configuration-dialog/).

No se ha consultado el endpoint de actualización, accedido al panel ni implementado o instalado el cliente. La emisión HTTPS, aun eliminando la dependencia CAA del CNAME, seguiría requiriendo probar acceso exterior y preparar el vhost/challenge de HTTP-01. El cambio a A dinámico no se propone ejecutar sin un plan revisado y autorización expresa.

## 7. Decisión

**Mantener STRATO y CNAME sin cambios. Bloqueo CAA localizado en las respuestas obtenidas de los autoritativos de DuckDNS; emisión HTTPS todavía no validada.**

Hay evidencia reproducible para una incidencia al proveedor y una vía documentada de actualización automática si más adelante se decide usar A dinámico. No queda trabajo de configuración urgente para el propietario en STRATO. Los scripts locales fueron temporales y las consultas remotas se ejecutaron por stdin, sin archivos, instalaciones ni procesos persistentes en Raspberry. No se modificó código del VTT ni se hizo commit, merge o push en esta investigación.
