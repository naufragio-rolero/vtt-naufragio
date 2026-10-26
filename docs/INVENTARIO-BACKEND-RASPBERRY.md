# Inventario del backend en Raspberry

> Fase 0, consultas remotas de solo lectura. Inventario realizado el 26 de octubre de 2026. No autoriza instalaciones ni cambios de servicios.

Actualización de decisión para Fase 1: el usuario ha seleccionado **Node.js 22** para compatibilidad con ARMv7 y ha solicitado mantener compatibilidad con Node 24+. La base se implementó y probó localmente en esas dos ramas ([resultados](FASE1-BACKEND.md)); los datos de este inventario conservan su carácter de instantánea. Node sigue sin instalarse en la Raspberry y se mantiene pendiente planificar la actualización antes de su EOL.

## Resumen ejecutivo

La conexión SSH llegó al host esperado. Es Raspbian GNU/Linux 13 (Debian 13 “trixie”), kernel Raspberry Pi 6.18, arquitectura de usuario ARM de 32 bits (`armv7l`). Apache 2.4.69 es el proxy web activo y atiende HTTP/HTTPS en los puertos 80 y 443; TLS negocia localmente. El proxy ya contiene una aplicación existente en `127.0.0.1:8787`. Node.js y npm no están instalados. Hay aproximadamente 920 MiB de RAM, de los que 491 MiB estaban disponibles al medir; el SSD montado en `/mnt/ssd` es ext4, 110 GB, con 83 GB libres.

**Bloqueo técnico principal:** elegir un runtime Node LTS que se pueda mantener en ARMv7. Node 22 publica binario Linux ARMv7, pero su fin de soporte está previsto para abril de 2027; Node 24 es LTS, pero ARMv7 está clasificado como experimental y el archivo oficial no ofrece allí binario ARMv7. Para un backend nuevo conviene confirmar una estrategia de runtime con soporte suficiente (por ejemplo, host ARM64/x64 compatible) antes de instalar.

Apache tiene `mod_proxy`, `mod_proxy_http`, SSL y rewrite habilitados. No se encontró una regla de upgrade WebSocket en la configuración habilitada. Por versión, Apache puede tramitar WebSocket a través de `mod_proxy_http` si se configura explícitamente (`upgrade=websocket`), pero **la ruta de Naufragio no está configurada ni se hizo una conexión WebSocket de extremo a extremo**.

## Resultados observados

| Área | Evidencia saneada | Conclusión / bloqueo |
| --- | --- | --- |
| Conectividad | SSH autenticó contra el hostname esperado; usuario y direcciones de red se omiten de este inventario. | Conectividad local verificada. No se evaluó desde Internet. |
| Sistema | Raspbian GNU/Linux 13 (trixie), Debian 13.6; kernel `6.18.50+rpt-rpi-v7`; arquitectura `armv7l`; glibc 2.41. | Sistema ARMv7 de 32 bits. Verificar su horizonte de soporte y estrategia de runtime antes de comprometer despliegue. |
| Node.js / npm | Los comandos no existen y `dpkg-query` no encontró los paquetes `nodejs` ni `npm`. | No instalados. La instalación queda fuera de esta fase. |
| Runtime LTS y arquitectura | Node 22 está en Maintenance LTS y el calendario oficial fija EOL el 30-04-2027; la distribución oficial incluye binario `linux-armv7l`. Node 24 está en Active LTS hasta 30-04-2028, pero Node clasifica Linux ARMv7 como experimental desde Node 24 y el archivo oficial de Node 24 solo lista binario Linux x64. | No asumir compatibilidad de producción de Node 24 en esta Pi. Node 22 podría ejecutarse con binario oficial ARMv7, pero su ventana de soporte es corta. Elegir host/runtime y estrategia de actualización antes de implementar el despliegue. |
| HTTP / TLS | Apache 2.4.69 activo; listener en 80 y 443 en todas las interfaces. SSL habilitado. La petición HTTPS local completó TLS y obtuvo HTTP 403 del vhost por defecto. | Apache termina HTTPS. El 403 es una respuesta del vhost por defecto a la prueba sin nombre de sitio; no indica por sí solo un fallo de TLS. No se verificó certificado para cada dominio ni exposición exterior. |
| Proxy existente | `mod_proxy`, `mod_proxy_http`, `mod_rewrite`, `mod_headers` y SSL están habilitados. Hay una ruta proxy ya configurada a un servicio local existente en el puerto 8787. | Proxy compartido con otras aplicaciones. No reutilizar esa ruta ni editar/reiniciar Apache sin revisar el vhost exacto, probar configuración y acordar una ventana que preserve Heaven's Gate. |
| WebSockets | Apache 2.4.69 satisface el requisito de versión para upgrade con `mod_proxy_http`; módulo cargado. No aparece una directiva WebSocket/upgrade específica en la configuración habilitada. | Capacidad disponible en Apache, soporte efectivo de una ruta nueva aún no probado/configurado. La futura ruta Socket.IO requiere regla explícita de proxy y prueba real de handshake, incluida la política de origen. |
| Servicios | `apache2` activo; `nginx`, `caddy` y `docker` no están cargados/activos. Apache corre con master root y workers `www-data`. | Patrón actual: Apache en `systemd`; no hay indicio de despliegue Docker. El backend debería ser otro servicio aislado, no un módulo de la aplicación web existente. |
| Puertos y propietarios | 80/443 Apache; 22 SSH; 139/445 SMB; 3306 MariaDB solo en loopback; 8787 Python solo en loopback; 9090 Python ligado a la interfaz Ethernet. Las direcciones se omiten. | 3400 no estaba ocupado durante la consulta, pero sigue siendo una propuesta, no una reserva. Confirmar de nuevo junto con bind a loopback y firewall antes del despliegue. No publicar SMB, DB ni puertos de aplicaciones. |
| Memoria | Total 920 MiB; disponible 491 MiB; swap 919 MiB, con 624 MiB libres en ese momento. | Recurso limitado, aunque la carga prevista es pequeña. Medir el consumo base/estable de Apache y las demás aplicaciones antes de fijar límites del servicio Node. |
| SSD | `/mnt/ssd`: `/dev/sdb1`, ext4, 110 GB total, 22 GB usados, 83 GB disponibles (21 %). Montado `rw,noatime`; raíz del montaje pertenece al usuario de operación. No existe `/mnt/ssd/services`. | Hay capacidad disponible. El dispositivo observado (`/dev/sdb1`) difiere del indicado en `RASPBERRY_SSH.md` (`/dev/sda1`); confirmar si cambió el orden de dispositivos o si la documentación quedó obsoleta. No se creó directorio. |
| Firewall / exposición | `ufw` activo; unidades `nftables` y `firewalld` inactivas. | No se leyeron reglas detalladas ni se probó acceso externo. No abrir puertos ni cambiar reglas como parte del inventario. Administración debe confirmar allowlist/redirecciones, DNS, CG-NAT y exposición. |
| Recuperación | `RASPBERRY_SSH.md` declara una cápsula cifrada automática en NAS como sistema adoptado; no se verificó su última ejecución, restauración ni cobertura del SSD. | Confirmar salud del backup de metadatos y un simulacro antes del despliegue. El backend nunca será respaldo del contenido de partida. |
| Heaven's Gate | No se leyó, cambió ni probó `/mnt/ssd/html/hg`. | La ruta de proxy actual evidencia configuración compartida, pero no se intentó atribuirla a Heaven's Gate ni inspeccionar su sitio. Una medición agregada de uso del SSD pudo recorrer metadatos del árbol `/mnt/ssd/html`; no se leyeron archivos de Heaven's Gate ni se modificó su contenido. Preservar aislamiento y no hacer reload durante el MVP sin plan de impacto aprobado. |

### Nota sobre las comprobaciones

Los listeners se enumeraron con `ss`; se usó `sudo -n` solo para obtener propietarios de sockets y leer resúmenes/configuración habilitada. Las salidas de Apache se filtraron para omitir nombres de sitios, IPs y rutas internas. No se imprimieron claves, certificados, `.env`, credenciales ni configuraciones completas. La prueba TLS local no validó certificados (`curl -k`) y no equivale a una comprobación externa del dominio.

## Arquitectura de despliegue recomendada

1. **Mantener el frontend estático separado del backend.** Servir el mismo artefacto en GitHub Pages o cualquier servidor convencional, con endpoints públicos en `site.config.json` y sin URLs, secretos ni rutas de Raspberry fijadas en el código.
2. **Ejecutar Node como servicio independiente de privilegios mínimos.** Bind exclusivo a `127.0.0.1`; puerto interno elegido después de una nueva comprobación. Usar `systemd` si la operación lo confirma; no introducir Docker solo para este servicio. Configuración sensible fuera del repositorio y separada de la aplicación Apache.
3. **Usar Apache como proxy TLS existente únicamente mediante un cambio aislado y revisado.** Añadir una ruta dedicada de API y otra de Socket.IO/WebSocket a un puerto loopback reservado; no solapar la aplicación actual en 8787. Hacer validación de sintaxis y plan de rollback en una futura fase autorizada, con comprobación de Heaven's Gate antes/después. Sin exposición directa del puerto Node.
4. **Resolver primero el runtime.** La aplicación debe ser portable y dependiente de Node LTS, no de ARM/Apache. Dado ARMv7, escoger entre host compatible de 64 bits, cambio planificado de plataforma, o una solución transitoria aceptada con fecha de salida; no instalar a ciegas un runtime ni compilar en producción durante Fase 0.
5. **Persistir solo identidad y metadatos mínimos.** SQLite puede almacenar cuentas, hash seguro de contraseñas, roles, invitaciones de alta de un uso, pertenencias y metadatos de salas. No guardar mapas, imágenes, niebla, tokens, posiciones ni estado de partida. Las colas y fragmentos de transmisión son temporales y acotados.
6. **Conservar autoridad y límites de producto.** El navegador del máster mantiene el estado oficial en IndexedDB; el backend autentica, verifica sala/permisos y retransmite. Desconectado el máster, la sala queda en espera. Los participantes solo reciben el mapa activo y los datos autorizados.
7. **Conservar roles, invitaciones y portabilidad.** IDs internos estables `admin`, `director`, `user`, separados de etiquetas visibles configurables. Invitación de alta para cuenta ordinaria y código de sala son mecanismos distintos. Usuario ordinario no crea salas ni sube recursos; solo entra autorizado, mueve tokens asignados y tira dados si el director concede ese permiso.
8. **Incluir exportación del MVP desde el navegador del director.** Exportar/importar partida completa, mapa individual y token/recurso con imágenes, manifiesto versionado y validación. Esto permite recuperación portable sin convertir el backend o la Raspberry en almacenamiento de partidas.

## Bloqueos y decisiones previas a instalación o despliegue

1. Elegir la plataforma y el runtime con soporte suficiente para la vida prevista del servicio; evaluar la condición ARMv7 y el horizonte EOL de Node 22.
2. Confirmar si `/dev/sdb1` es el SSD productivo actual y corregir, en su caso, la documentación operativa (fuera del alcance de este inventario). Acordar directorio y usuario aislado; `/mnt/ssd/services` aún no existe.
3. Decidir origen HTTPS público/API y mecanismo de exposición (proxy actual, VPN/túnel aprobado o red); validar DNS, CG-NAT, reglas UFW y certificados desde una red externa.
4. Revisar con la persona responsable la ubicación de la ruta nueva en Apache, convivencia con los vhosts y con Heaven's Gate, regla explícita de Socket.IO/WebSocket y procedimiento/ventana de validación, reload y rollback.
5. Confirmar puerto loopback libre al implementar, memoria de carga base y límites de proceso. No considerar el puerto 3400 asignado.
6. Confirmar responsable de cuentas administrativas, provisión segura de secretos y salud/restauración de la cápsula cifrada de metadatos.
7. Fijar origen(es) exactos del frontend, ubicación de `site.config.json` y allowlist CORS/Origin para HTTP y Socket.IO.

## Fuentes de compatibilidad

- [Calendario oficial de Node.js](https://github.com/nodejs/Release#release-schedule): estado LTS y EOL de Node 22/24.
- [Archivo de Node.js 22](https://nodejs.org/en/download/archive/v22): incluye artefactos Linux ARMv7.
- [Archivo de Node.js 24](https://nodejs.org/en/download/archive/v24) y [matriz de plataformas Node.js](https://github.com/nodejs/node/blob/main/BUILDING.md): Node 24 y estado experimental de ARMv7.
- [Apache mod_proxy, WebSocket Upgrade](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#examples): `mod_proxy_http` admite upgrade desde Apache 2.4.47 con configuración explícita.

## Alcance de esta fase

Se realizaron conexiones SSH y consultas remotas de lectura para completar el inventario. No se instalaron paquetes, modificaron archivos, cambiaron servicios, abrieron puertos, editaron DNS/firewall, recargaron o reiniciaron procesos, ni se leyeron archivos de `/mnt/ssd/html/hg`; la medición agregada del SSD pudo recorrer metadatos del árbol `/mnt/ssd/html`, como se indica arriba. El único cambio del repositorio por este trabajo es este documento, dentro de la rama `feat/backend-multijugador`.
