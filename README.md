# Naufragio VTT

Prototipo 0.1.2 de un tablero virtual ligero para El Naufragio, inspirado en la sencillez de Owlbear Rodeo 1.0.

**[Requisitos completos y plan de trabajo](docs/REQUISITOS.md)** — arquitectura, alcance del MVP y decisiones confirmadas.

**[Referencias funcionales de Owlbear Rodeo](docs/REFERENCIAS-OWLBEAR.md)** — equivalencias con Owlbear 1.0/2.0, fuentes oficiales y criterios para conservar una experiencia sencilla.

**[Plan de backend multijugador y despliegue portable](docs/BACKEND-RASPBERRY.md)** — frontend configurable para GitHub Pages u otro servidor; invitaciones de alta, roles y permisos, salas, exportación/importación del MVP y piloto Raspberry con Codex por SSH. **Fase 4 de sincronización autoritativa de tokens implementada localmente; no existe aún backend en producción.**

## Backend local en desarrollo

[Instrucciones de `backend/`](backend/README.md): Node.js 22/24, SQLite para identidad y metadatos de acceso, sesiones revocables, invitaciones separadas de alta/partida y permisos en backend. [Pruebas y alcance de Fase 4](docs/FASE4-BACKEND.md): solicitudes y confirmaciones de movimientos, asignaciones, versiones y prueba de estado local del director al reconectar. Incluye un cliente de protocolo separado y una prueba con director/dos jugadores. El tablero publicado conserva su funcionamiento local y no se conecta al backend; imágenes y otras herramientas siguen pendientes. [Validación temporal ARMv7 de Fase 2](docs/VALIDACION-ARMV7.md), históricos de [Fase 1](docs/FASE1-BACKEND.md), [Fase 2](docs/FASE2-BACKEND.md) y [Fase 3](docs/FASE3-BACKEND.md).

## Funciones actuales

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

Esta iteración admite **un mapa local**. La colección de mapas y las partidas compartidas llegarán después.

**[Documento de trabajo y pruebas: importación de mapas](docs/PLAN-MAPAS.md).**

## Probar en local

Abrir el fichero `index.html` en un navegador moderno. Para servirlo como web estática se puede usar cualquier servidor de archivos local.

## Publicar en GitHub Pages

1. En el repositorio, abrir **Settings → Pages**.
2. En **Build and deployment**, elegir **Deploy from a branch**.
3. Seleccionar la rama `main` y la carpeta `/(root)`.
4. Guardar. La URL prevista es https://naufragio-rolero.github.io/vtt-naufragio/.

**Estado actual:** el repositorio es público. El código y la web publicada son accesibles públicamente; el prototipo no tiene control de acceso.

El proyecto no necesita un workflow personalizado de GitHub Actions.

## Límites deliberados del MVP

**El tablero publicado no tiene autenticación real, servidor conectado ni multijugador.** El nombre elegido en pantalla solo identifica al usuario en *ese navegador* y no impide que nadie visite la web. GitHub Pages no ejecuta PHP ni WebSockets. La base de backend de desarrollo se ejecuta por separado.

Los tokens y ajustes se guardan en localStorage; la imagen importada, en IndexedDB. Nada se comparte entre dispositivos y limpiar los datos del sitio puede hacer perder el mapa y su configuración. Evitar usar información privada o material sensible.

## Próximas fases

Consultar el [documento de requisitos](docs/REQUISITOS.md). La arquitectura acordada considera el navegador del máster como fuente oficial del estado de la partida, cachés autorizadas en los navegadores de jugadores y un backend futuro para autenticación y sincronización, **sin persistir partidas en el servidor**.

No se incluyen claves, cuentas de demostración falsas ni secretos en el frontend.
