# Diagnóstico SSH del piloto privado

Fecha: 28 de octubre de 2026. Rama `feat/backend-multijugador`. El diagnóstico inicial fue de solo lectura; **el ajuste temporal y el piloto fueron autorizados después, ejecutados y revertidos íntegramente**. Se conserva a continuación la propuesta revisada antes de la autorización.

## Causa comprobada

El daemon usa la configuración estándar, sin `-f` alternativo ni overrides `-o`. `/etc/ssh/sshd_config`, línea 12, incluye `/etc/ssh/sshd_config.d/*.conf`. En `10-naufragio-hardening.conf`:

```text
AllowTcpForwarding local
PermitOpen 127.0.0.1:3306
```

Son las líneas 12 y 13 de ese include. Se revisaron las directivas relevantes del archivo principal y los includes, incluido `50-cloud-init.conf`; no se encontraron bloques `Match` existentes. La evaluación `sshd -T -C` con la cuenta y las direcciones reales de la conexión devuelve:

```text
allowtcpforwarding local
disableforwarding no
permitopen 127.0.0.1:3306
gatewayports no
pubkeyauthentication yes
passwordauthentication no
kbdinteractiveauthentication no
trustedusercakeys none
authorizedkeyscommand none
authorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2
```

La única entrada activa de `authorized_keys` coincide por huella con la clave pública local indicada en las instrucciones privadas de acceso. No tiene opciones delante de la clave; por tanto no hay `restrict`, `no-port-forwarding` ni `permitopen` adicionales en esa entrada. El archivo pertenece a la cuenta, con modo 0600; `authorized_keys2` no existe. No se imprimió material de claves ni se incluyó su huella, usuario, host o comentario en este documento público.

**Conclusión:** el rechazo procede de `PermitOpen` del include global. Una opción de clave no puede ampliar por sí sola lo que deniega el servidor. El puerto 3400 estaba libre al comprobarlo; no se inició un listener para esta investigación.

## Cambio mínimo propuesto antes de la autorización (historial)

Conservar íntegro el include global y añadir **al final** de `/etc/ssh/sshd_config`:

```text
# Naufragio: excepcion privada de piloto; MariaDB conservado
Match User <cuenta-SSH-del-piloto>
    PermitOpen 127.0.0.1:3306 127.0.0.1:3400
```

El marcador representa la cuenta exacta de la identidad en `docs/RASPBERRY_SSH.md`, documento privado ignorado por Git; no copiar literalmente el marcador. El candidato validado en memoria usó esa cuenta real. Actualmente solo admite la clave comprobada, sin contraseñas, certificados de usuario ni proveedor externo de claves.

Se coloca al final del archivo principal para no introducir contexto `Match` dentro de un include temprano que afecte a directivas globales posteriores. No cambia `authorized_keys`, las claves, `AllowTcpForwarding`, `DisableForwarding`, `GatewayPorts`, contraseñas o autenticación. No se autoriza un comodín, un destino LAN, un nombre alternativo a 127.0.0.1 ni remote forwarding. El puerto de MariaDB permanece autorizado.

### Validación previa sin escrituras

Se construyó el candidato en memoria y se envió a `sshd -t -f /dev/stdin`: **salida 0**. `sshd -T -f /dev/stdin -C ...` confirmó:

| Contexto | `PermitOpen` del candidato |
| --- | --- |
| Cuenta del piloto | `127.0.0.1:3306 127.0.0.1:3400` |
| Otra cuenta, mismos datos de conexión | `127.0.0.1:3306` |

La segunda evaluación es de configuración, no un login a otra cuenta. El daemon no se ha recargado y su configuración en disco no se ha editado. Las demás restricciones filtradas coinciden con las actuales.

## Aplicación propuesta e impacto

**Requiere autorización expresa antes de cualquier escritura remota o reload.**

1. Conservar abierta una sesión administrativa y verificar de nuevo que los archivos no han cambiado desde este diagnóstico.
2. Guardar copia privada de `/etc/ssh/sshd_config`, conservando contenido, propietario y permisos; registrar hash y ruta exacta de rollback. No guardar claves ni configuraciones completas en el repositorio.
3. Añadir exclusivamente el bloque anterior con la cuenta real y verificar diff reducido, `sshd -t` y configuración efectiva de la cuenta objetivo y otra cuenta. Ante cualquier diferencia inesperada, restaurar sin recargar.
4. Ejecutar **reload de SSH**, sin restart: la sesión existente permanece abierta y las conexiones nuevas reciben la regla. No se cambia Apache, UFW, DNS, certificados, Heaven's Gate, MariaDB ni otros servicios.
5. Abrir una segunda conexión con `IdentitiesOnly=yes` y la clave comprobada; confirmar acceso normal, preflight al 3400, MariaDB conservado y destinos no autorizados denegados. Un puerto vacío debe producir `Connection refused`, no `administratively prohibited`.

Impacto esperado: la misma identidad puede abrir forwarding local al único destino nuevo `127.0.0.1:3400`; no se abre un puerto de red ni se publica el backend. El permiso de servidor se vincula a la cuenta, que actualmente tiene una sola clave autorizada; si en el futuro se añaden identidades a esa cuenta, deberán revisarse sus permisos. Los permisos de otros usuarios permanecen como estaban.

## Rollback

- **Antes del reload:** ante validación fallida, restaurar inmediatamente la copia privada y comprobar `sshd -t`; no aplicar configuración inválida.
- **Después del reload:** desde la sesión administrativa conservada, comprobar que no hubo cambios concurrentes, restaurar el original con sus permisos, ejecutar `sshd -t` y hacer reload de SSH. No cerrar la sesión hasta verificar un nuevo login y MariaDB. Si hay cambios concurrentes, revertir solo el bloque añadido tras revisar el diff, sin sobrescribirlos.
- Confirmar `PermitOpen` original (`127.0.0.1:3306`) y denegación al 3400 desde una conexión nueva. Cerrar el túnel del piloto si existiera; una conexión ya establecida no es una prueba válida de la política restaurada.
- Tras cualquier piloto autorizado, cerrar procesos/túneles y borrar únicamente su raíz privada verificada. Por defecto, revertir también esta excepción temporal SSH al finalizar y comprobar otra vez MariaDB. No borrar la copia de rollback hasta completar las verificaciones.

## Estado

El usuario respondió **«Autorizar ajuste temporal, piloto y rollback»**. Se aplicó exactamente la excepción `Match User` validada, manteniendo la conexión administrativa abierta y con un controlador de duración máxima de 20 minutos. El preflight pasó; MariaDB siguió permitida y 3401 se mantuvo denegado.

Finalizado el [piloto real con tres clientes](PILOTO-PRIVADO-RASPBERRY.md#resultado-real-del-piloto-armv7-autorizado), el controlador restauró `sshd_config` byte a byte: SHA-256 idéntico al original, validación y reload completados. La copia privada se eliminó después de restaurar. Una conexión nueva confirmó `PermitOpen 127.0.0.1:3306`; 3400 vuelve a estar denegado y MariaDB volvió a proporcionar saludo a través de SSH sin autenticación SQL. Sin cambios en claves ni includes globales; mismo PID principal de SSH. No queda runtime, base, túnel, controlador ni árbol temporal del piloto. Otra apertura del acceso requerirá nueva autorización explícita.
