# Cliente de navegador

`socket.io-4.8.4.esm.min.js` es la distribución ESM independiente de `socket.io-client` **4.8.4**, ya fijada en `backend/package-lock.json`. Se conserva sin modificar y con su licencia MIT (`socket.io-LICENSE.txt`). El frontend no descarga código de un CDN ni del host de autenticación.

Para reproducir, desde `backend/`:

```text
npm ci --ignore-scripts
npm run sync:browser-client
```

Una prueba compara el archivo público y la licencia con la dependencia instalada. Revisar versión, contrato y nombre del artefacto antes de actualizarlo.
