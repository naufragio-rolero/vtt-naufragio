# Naufragio VTT

Tablero virtual ligero para El Naufragio, inspirado en la sencillez de Owlbear Rodeo 1.0. Esta rama integra la mesa local con salas multijugador de tokens públicos; las imágenes compartidas y el MVP completo siguen pendientes.

**[Requisitos completos y plan de trabajo](docs/REQUISITOS.md)** — arquitectura, alcance del MVP y decisiones confirmadas.

**[Referencias funcionales de Owlbear Rodeo](docs/REFERENCIAS-OWLBEAR.md)** — equivalencias con Owlbear 1.0/2.0, fuentes oficiales y criterios para conservar una experiencia sencilla.

**[Plan de backend multijugador y despliegue portable](docs/BACKEND-RASPBERRY.md)** — frontend configurable para GitHub Pages u otro servidor. **Fase 5 de integración del frontend implementada y validada localmente en Firefox y Edge; no existe backend público ni se han publicado estos cambios en Pages.**

## Probar el multijugador en Windows

Seguir la [guía de Fase 5](docs/FASE5-FRONTEND.md): preparar el backend con Node 22/24 y el administrador inicial; ejecutar `npm run start:env` y, en otra terminal dentro de `backend/`, `npm run frontend`. Abrir `http://127.0.0.1:8080/`, configurar los destinos desde **Multijugador → Configuración del sitio** y acceder. El administrador provisiona dirección; el director crea la partida, invita cuentas registradas y asigna tokens. Alta de cuenta y código de sala son independientes.

El Canvas conserva rejilla, zoom, desplazamiento y temas. Solo dirección mueve cualquier token de la sala; los jugadores necesitan asignación y permiso expreso. Se confirma un movimiento por arrastre terminado. El director guarda el estado oficial en IndexedDB y debe probarlo al reconectar. La mesa local y sus mapas se conservan al entrar/salir. Las salas usan un conjunto fijo de hasta 64 tokens genéricos, sin transmisión de imágenes.

[Contrato backend](backend/README.md), [Fase 4 y protocolo](docs/FASE4-BACKEND.md), [validación ARMv7 de Fase 2](docs/VALIDACION-ARMV7.md) e históricos de [Fase 1](docs/FASE1-BACKEND.md), [Fase 2](docs/FASE2-BACKEND.md) y [Fase 3](docs/FASE3-BACKEND.md).

## Funciones de la mesa local

- Identificación **local** por nombre (sin cuentas ni contraseñas).
- Rejilla ajustable y opción de mostrarla u ocultarla.
- Cuatro tokens genéricos iniciales y posibilidad de añadir, renombrar, recolorear y eliminar otros.
- Arrastrar tokens con ratón o pantalla táctil; ajuste opcional a casillas.
- Desplazar el tablero, hacer zoom y centrar la vista.
- Mover el token seleccionado con las flechas del teclado.
- Guardado automático de tokens y ajustes mediante localStorage, y del mapa importado mediante IndexedDB.
- Importación de imágenes PNG/JPEG/WebP como fondo, con posición y dimensiones independientes en casillas.
- Edición manual de los mapas arrastrando los ocho tiradores de bordes y esquinas, también en pantallas táctiles.
- Selector de **tema claro u oscuro**. El claro se muestra por defecto; la elección se guarda en este navegador.
- Interfaz adaptable a escritorio y móvil, sin dependencias externas.

## Importar y alinear un mapa

1. Desde **Mapa de fondo**, selecciona una imagen de tu dispositivo (hasta 12 MB y 20 megapíxeles, con 8000 píxeles como máximo por lado).
2. Ajusta **Anchura / Altura (casillas)** según la rejilla que tenga la imagen; la proporción original se aplica inicialmente.
3. Usa **Mover imagen** para desplazarla. Activa **Estirar imagen** para ver los ocho tiradores y arrastra esquinas o bordes hasta hacer coincidir el fondo con la rejilla (la imagen puede deformarse intencionadamente).
4. Ajusta **Posición X/Y** para calibrar con precisión o pulsa **Encajar vista** para ver todo el mapa. Los tokens quedan por encima.
5. Desde **La mesa → Apariencia**, elige entre tema claro y oscuro.
6. Recarga la página para comprobar que se conservan fondo, tamaño, posición, tema y tokens.

Esta iteración admite **un mapa local**. Las salas compartidas sincronizan únicamente posiciones de tokens; no envían ese mapa a otros participantes.

**[Documento de trabajo y pruebas: importación de mapas](docs/PLAN-MAPAS.md).**

## Probar en local

El tablero básico se puede abrir como archivo local. Para módulos multijugador, WebCrypto e IndexedDB, servirlo por localhost o HTTPS; se proporciona `npm run frontend` desde `backend/`, con una lista explícita de archivos públicos. También funciona como sitio estático en raíz o subruta, con configuración relativa al despliegue.

## Publicar en GitHub Pages

1. En el repositorio, abrir **Settings → Pages**.
2. En **Build and deployment**, elegir **Deploy from a branch**.
3. Seleccionar la rama `main` y la carpeta `/(root)`.
4. Guardar. La URL prevista es https://naufragio-rolero.github.io/vtt-naufragio/.

**Estado actual:** el repositorio es público. El código y la web publicada son accesibles públicamente; el prototipo no tiene control de acceso.

El proyecto no necesita un workflow personalizado de GitHub Actions.

## Límites deliberados del MVP

**La web publicada aún conserva el prototipo local; esta entrega permanece en la rama de trabajo.** GitHub Pages solo aloja archivos estáticos. El backend de desarrollo se ejecuta por separado y el código de esta rama permite conectarlo expresamente desde la interfaz, sin publicar nada automáticamente.

La mesa local conserva tokens/ajustes en localStorage y su mapa en IndexedDB. Las salas tienen un diario separado en IndexedDB del director; el servidor solo conserva identidad, permisos y metadatos de continuidad, nunca posiciones ni imágenes. Limpiar los datos del navegador puede hacer perder la autoridad local de una sala: no hay transferencia entre dispositivos ni recuperación automática desde servidor.

## Próximas fases

Consultar el [documento de requisitos](docs/REQUISITOS.md). La arquitectura considera el navegador del máster como fuente oficial del estado de la partida, cachés autorizadas en los navegadores de jugadores y el backend de autenticación/retransmisión, **sin persistir partidas en el servidor**. Imágenes compartidas, exportaciones y operación pública siguen pendientes.

No se incluyen claves, cuentas de demostración falsas ni secretos en el frontend.
