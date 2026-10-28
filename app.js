"use strict";

(() => {
  const STORAGE_KEY = "naufragio-vtt-mvp-v1";
  const ASSET_DB = "naufragio-vtt-local-assets";
  const ASSET_STORE = "media";
  const MAP_BLOB_KEY = "active-map-image";
  const MAX_MAP_BYTES = 12 * 1024 * 1024;
  const MAX_MAP_PIXELS = 20000000;
  const MIN_ZOOM = 0.12;
  const PALETTE = ["#85dcd2", "#e7c47e", "#dd8e88", "#a6a1e9", "#a8c984", "#90b7e7"];
  const STARTER_TOKENS = [
    { id: "starter-1", code: "T1", name: "Token 1", color: PALETTE[0], x: -2, y: -1 },
    { id: "starter-2", code: "T2", name: "Token 2", color: PALETTE[1], x: 0, y: -1 },
    { id: "starter-3", code: "T3", name: "Token 3", color: PALETTE[2], x: -2, y: 1 },
    { id: "starter-4", code: "T4", name: "Token 4", color: PALETTE[3], x: 0, y: 1 }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function freshState() {
    return {
      playerName: "",
      tokens: STARTER_TOKENS.map((token) => ({ ...token })),
      cellSize: 64,
      gridOpacity: 0.55,
      theme: "light",
      map: null,
      showGrid: true,
      snap: true,
      zoom: 1,
      cameraX: 0,
      cameraY: 0
    };
  }

  function loadState() {
    const base = freshState();
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!stored || typeof stored !== "object") return base;
      if (typeof stored.playerName === "string") base.playerName = stored.playerName.trim().slice(0, 24);
      if (Array.isArray(stored.tokens)) {
        base.tokens = stored.tokens.slice(0, 100).filter((token) => token && typeof token === "object").map((token, index) => ({
          id: typeof token.id === "string" && token.id.length < 80 ? token.id : "imported-" + index,
          code: typeof token.code === "string" ? token.code.slice(0, 4) : "T" + (index + 1),
          name: typeof token.name === "string" ? token.name.slice(0, 32) : "Token " + (index + 1),
          color: PALETTE.includes(token.color) ? token.color : PALETTE[0],
          x: clamp(finiteOr(token.x, 0), -1000, 1000),
          y: clamp(finiteOr(token.y, 0), -1000, 1000)
        }));
      }
      base.cellSize = clamp(finiteOr(stored.cellSize, 64), 32, 96);
      base.gridOpacity = clamp(finiteOr(stored.gridOpacity, 0.55), 0.1, 1);
      base.theme = stored.theme === "dark" ? "dark" : "light";
      if (stored.map && typeof stored.map === "object") {
        const map = stored.map;
        const widthPx = clamp(finiteOr(map.widthPx, 0), 0, 8000);
        const heightPx = clamp(finiteOr(map.heightPx, 0), 0, 8000);
        if (widthPx > 0 && heightPx > 0) {
          base.map = {
            name: typeof map.name === "string" ? map.name.slice(0, 100) : "Mapa",
            widthPx, heightPx,
            widthCells: clamp(finiteOr(map.widthCells, 20), 1, 200),
            heightCells: clamp(finiteOr(map.heightCells, clamp(finiteOr(map.widthCells, 20), 1, 200) * heightPx / widthPx), 1, 200),
            xCells: clamp(finiteOr(map.xCells, -10), -1000, 1000),
            yCells: clamp(finiteOr(map.yCells, -10), -1000, 1000)
          };
        }
      }
      base.showGrid = stored.showGrid !== false;
      base.snap = stored.snap !== false;
      base.zoom = clamp(finiteOr(stored.zoom, 1), MIN_ZOOM, 2.5);
      base.cameraX = clamp(finiteOr(stored.cameraX, 0), -20000, 20000);
      base.cameraY = clamp(finiteOr(stored.cameraY, 0), -20000, 20000);
    } catch {
      return base;
    }
    return base;
  }

  const state = loadState();
  let selectedId = null;
  let drag = null;
  let toastTimeout = null;
  let mapImage = null;
  let mapEditMode = null;
  let mapLoadGeneration = 0;
  let sharedMode = false;
  let localBackup = null;
  let multiplayer = null;
  let sharedVisuals = new Map();
  let sharedTokenImages = new Map();
  const editable = () => !sharedMode;
  const canMove = tokenId => !sharedMode || Boolean(multiplayer?.canMove(tokenId));

  const canvas = document.getElementById("boardCanvas");
  const context = canvas.getContext("2d");
  const refs = {
    tokenList: document.getElementById("tokenList"),
    tokenCount: document.getElementById("tokenCount"),
    noSelection: document.getElementById("noSelection"),
    selectionEditor: document.getElementById("selectionEditor"),
    tokenName: document.getElementById("tokenName"),
    tokenPalette: document.getElementById("tokenPalette"),
    deleteToken: document.getElementById("deleteToken"),
    gridSize: document.getElementById("gridSize"),
    gridSizeValue: document.getElementById("gridSizeValue"),
    gridOpacity: document.getElementById("gridOpacity"),
    gridOpacityValue: document.getElementById("gridOpacityValue"),
    mapUpload: document.getElementById("mapUpload"),
    mapEmpty: document.getElementById("mapEmpty"),
    mapControls: document.getElementById("mapControls"),
    mapFilename: document.getElementById("mapFilename"),
    mapResolution: document.getElementById("mapResolution"),
    mapColumns: document.getElementById("mapColumns"),
    mapRows: document.getElementById("mapRows"),
    mapOffsetX: document.getElementById("mapOffsetX"),
    mapOffsetY: document.getElementById("mapOffsetY"),
    mapMoveToggle: document.getElementById("mapMoveToggle"),
    mapResizeToggle: document.getElementById("mapResizeToggle"),
    themeSelect: document.getElementById("themeSelect"),
    boardHint: document.getElementById("boardHint"),
    gridToggle: document.getElementById("gridToggle"),
    snapToggle: document.getElementById("snapToggle"),
    zoomValue: document.getElementById("zoomValue"),
    coordinates: document.getElementById("coordinates"),
    profileName: document.getElementById("profileName"),
    profileAvatar: document.getElementById("profileAvatar"),
    identityDialog: document.getElementById("identityDialog"),
    identityForm: document.getElementById("identityForm"),
    identityName: document.getElementById("identityName"),
    sidebar: document.getElementById("sidebar"),
    menuToggle: document.getElementById("menuToggle"),
    toast: document.getElementById("toast")
  };

  function save() {
    if (sharedMode) return; // A shared room must never replace the legacy local table.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast("El navegador no permite guardar cambios.");
    }
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => refs.toast.classList.remove("visible"), 2600);
  }


  function assetRequest(action, value) {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Este navegador no dispone de IndexedDB."));
        return;
      }
      const opening = indexedDB.open(ASSET_DB, 1);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains(ASSET_STORE)) {
          opening.result.createObjectStore(ASSET_STORE);
        }
      };
      opening.onerror = () => reject(opening.error || new Error("No se puede abrir el almacén."));
      opening.onsuccess = () => {
        const db = opening.result;
        let transaction;
        try {
          transaction = db.transaction(ASSET_STORE, action === "get" ? "readonly" : "readwrite");
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        const store = transaction.objectStore(ASSET_STORE);
        let request;
        if (action === "get") request = store.get(MAP_BLOB_KEY);
        else if (action === "put") request = store.put(value, MAP_BLOB_KEY);
        else request = store.delete(MAP_BLOB_KEY);
        transaction.oncomplete = () => {
          const result = action === "get" ? request.result : undefined;
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          const error = transaction.error || new Error("No se pudieron guardar los datos.");
          db.close();
          reject(error);
        };
        transaction.onabort = () => {
          db.close();
          reject(new Error("Operación de almacenamiento interrumpida."));
        };
      };
    });
  }

  function decodeMapImage(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("El archivo no contiene una imagen compatible."));
      };
      image.src = objectUrl;
    });
  }

  function imageIsWithinLimits(image) {
    return image.naturalWidth > 0 && image.naturalHeight > 0
      && image.naturalWidth <= 8000 && image.naturalHeight <= 8000
      && image.naturalWidth * image.naturalHeight <= MAX_MAP_PIXELS;
  }

  function mapHeightCells() {
    return state.map ? state.map.heightCells : 0;
  }

  function refreshMapControls() {
    const map = state.map;
    refs.mapEmpty.hidden = Boolean(map);
    refs.mapControls.hidden = !map;
    refs.mapMoveToggle.classList.toggle("active", mapEditMode === "move");
    refs.mapMoveToggle.setAttribute("aria-pressed", String(mapEditMode === "move"));
    refs.mapResizeToggle.classList.toggle("active", mapEditMode === "resize");
    refs.mapResizeToggle.setAttribute("aria-pressed", String(mapEditMode === "resize"));
    canvas.classList.toggle("map-align", mapEditMode === "move");
    canvas.classList.toggle("map-resize", mapEditMode === "resize");
    canvas.style.cursor = "";
    refs.boardHint.textContent = mapEditMode === "move"
      ? "✥ Mover mapa: arrastra la imagen para alinearla con la rejilla."
      : mapEditMode === "resize"
        ? "⤢ Estirar mapa: arrastra los tiradores de esquinas o bordes para cambiar su tamaño."
        : "✥ Arrastra los tokens para moverlos · Arrastra el fondo para desplazarte";
    if (!map) return;
    refs.mapFilename.textContent = map.name;
    refs.mapResolution.textContent = map.widthPx + " × " + map.heightPx + " píxeles";
    refs.mapColumns.value = String(Math.round(map.widthCells * 100) / 100);
    refs.mapRows.value = String(Math.round(map.heightCells * 100) / 100);
    refs.mapOffsetX.value = String(Math.round(map.xCells * 100) / 100);
    refs.mapOffsetY.value = String(Math.round(map.yCells * 100) / 100);
  }

  function fitMapIntoViewport() {
    if (!state.map || !mapImage) return;
    const { width, height } = getDimensions();
    const map = state.map;
    const worldWidth = map.widthCells * state.cellSize;
    const worldHeight = mapHeightCells() * state.cellSize;
    const margin = width < 600 ? 28 : 100;
    state.zoom = clamp(Math.min((width - margin) / worldWidth, (height - margin) / worldHeight), MIN_ZOOM, 2.5);
    state.cameraX = -(map.xCells * state.cellSize + worldWidth / 2) * state.zoom;
    state.cameraY = -(map.yCells * state.cellSize + worldHeight / 2) * state.zoom;
    save();
    draw();
  }

  async function importMap(file) {
    if (!editable()) return;
    if (!file) return;
    const validType = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || (file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name));
    if (!validType) {
      showToast("Solo admitimos PNG, JPEG o WebP.");
      return;
    }
    if (file.size > MAX_MAP_BYTES) {
      showToast("El mapa supera el límite de 12 MB.");
      return;
    }
    const generation = ++mapLoadGeneration;
    try {
      const image = await decodeMapImage(file);
      if (!imageIsWithinLimits(image)) {
        showToast("Imagen demasiado grande: máximo 20 Mpx y 8000 px por lado.");
        return;
      }
      await assetRequest("put", file);
      if (generation !== mapLoadGeneration) return;
      const widthCells = 20;
      const heightCells = widthCells * image.naturalHeight / image.naturalWidth;
      state.map = {
        name: file.name.slice(0, 100) || "Mapa importado",
        widthPx: image.naturalWidth,
        heightPx: image.naturalHeight,
        widthCells,
        heightCells: clamp(heightCells, 1, 200),
        xCells: -widthCells / 2,
        yCells: -heightCells / 2
      };
      mapImage = image;
      mapEditMode = null;
      refreshMapControls();
      fitMapIntoViewport();
      save();
      showToast("Mapa guardado en este navegador.");
    } catch (error) {
      showToast("No se pudo guardar el mapa. Comprueba el almacenamiento disponible.");
    }
  }

  async function restoreMapImage() {
    if (!state.map) return;
    const generation = ++mapLoadGeneration;
    try {
      const blob = await assetRequest("get");
      if (generation !== mapLoadGeneration) return;
      if (!blob) {
        showToast("No se encontró la imagen guardada.");
        return;
      }
      const image = await decodeMapImage(blob);
      if (generation !== mapLoadGeneration) return;
      if (!imageIsWithinLimits(image)) throw new Error("Dimensiones no permitidas.");
      mapImage = image;
      state.map.widthPx = image.naturalWidth;
      state.map.heightPx = image.naturalHeight;
      refreshMapControls();
      draw();
    } catch {
      showToast("No se pudo recuperar el mapa local.");
    }
  }

  function mapScreenRect() {
    if (!state.map || !mapImage) return null;
    const point = worldToScreen(state.map.xCells * state.cellSize, state.map.yCells * state.cellSize);
    return {
      x: point.x, y: point.y,
      width: state.map.widthCells * state.cellSize * state.zoom,
      height: mapHeightCells() * state.cellSize * state.zoom
    };
  }

  function mapResizeHandles() {
    const rect = mapScreenRect();
    if (!rect) return [];
    const { x, y, width, height } = rect;
    return [
      { key: "nw", x, y }, { key: "n", x: x + width / 2, y }, { key: "ne", x: x + width, y },
      { key: "w", x, y: y + height / 2 }, { key: "e", x: x + width, y: y + height / 2 },
      { key: "sw", x, y: y + height }, { key: "s", x: x + width / 2, y: y + height },
      { key: "se", x: x + width, y: y + height }
    ];
  }

  function findResizeHandle(point) {
    if (mapEditMode !== "resize") return null;
    let nearest = null;
    let distance = 18;
    for (const handle of mapResizeHandles()) {
      const next = Math.hypot(point.x - handle.x, point.y - handle.y);
      if (next < distance) {
        nearest = handle;
        distance = next;
      }
    }
    return nearest;
  }

  function drawMap() {
    const rect = mapScreenRect();
    if (!rect) return;
    context.drawImage(mapImage, rect.x, rect.y, rect.width, rect.height);
    if (mapEditMode) {
      context.save();
      context.setLineDash([9, 5]);
      context.lineWidth = 2;
      context.strokeStyle = state.theme === "light" ? "#0b7769" : "#a5ffde";
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.setLineDash([]);
      if (mapEditMode === "resize") {
        for (const handle of mapResizeHandles()) {
          context.beginPath();
          context.arc(handle.x, handle.y, 7, 0, Math.PI * 2);
          context.fillStyle = state.theme === "light" ? "#ffffff" : "#122b37";
          context.fill();
          context.lineWidth = 2.5;
          context.stroke();
        }
      }
      context.restore();
    }
  }

  function pointIsOnMap(point) {
    const rect = mapScreenRect();
    return Boolean(rect && point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height);
  }

  function resizeMapFromDrag(drag, dx, dy) {
    if (!state.map) return;
    const scale = state.cellSize * state.zoom;
    const horizontal = dx / scale;
    const vertical = dy / scale;
    const west = drag.handle.includes("w");
    const east = drag.handle.includes("e");
    const north = drag.handle.includes("n");
    const south = drag.handle.includes("s");
    let width = drag.width + (east ? horizontal : west ? -horizontal : 0);
    let height = drag.height + (south ? vertical : north ? -vertical : 0);
    width = Math.round(clamp(width, 1, 200) * 100) / 100;
    height = Math.round(clamp(height, 1, 200) * 100) / 100;
    state.map.widthCells = width;
    state.map.heightCells = height;
    state.map.xCells = clamp(west ? drag.x + drag.width - width : drag.x, -1000, 1000);
    state.map.yCells = clamp(north ? drag.y + drag.height - height : drag.y, -1000, 1000);
  }

  function updateMapSetting(property, rawValue) {
    if (!editable()) return;
    if (!state.map) return;
    const value = Number.parseFloat(rawValue);
    if (!Number.isFinite(value)) {
      refreshMapControls();
      return;
    }
    state.map[property] = property === "widthCells" || property === "heightCells"
      ? clamp(value, 1, 200) : clamp(value, -1000, 1000);
    refreshMapControls();
    save();
    draw();
  }

  async function removeMap() {
    if (!editable()) return;
    if (!state.map || !window.confirm("¿Retirar la imagen del mapa? Los tokens se conservarán.")) return;
    const generation = ++mapLoadGeneration;
    try {
      await assetRequest("delete");
      if (generation !== mapLoadGeneration) return;
      state.map = null;
      mapImage = null;
      mapEditMode = null;
      refreshMapControls();
      save();
      draw();
      showToast("Imagen retirada. Los tokens siguen en su sitio.");
    } catch {
      showToast("No se pudo eliminar la imagen guardada.");
    }
  }

  function selectedToken() {
    return state.tokens.find((token) => token.id === selectedId) || null;
  }

  function getDimensions() {
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  function worldToScreen(x, y) {
    const { width, height } = getDimensions();
    return {
      x: width / 2 + state.cameraX + x * state.zoom,
      y: height / 2 + state.cameraY + y * state.zoom
    };
  }

  function screenToWorld(x, y) {
    const { width, height } = getDimensions();
    return {
      x: (x - width / 2 - state.cameraX) / state.zoom,
      y: (y - height / 2 - state.cameraY) / state.zoom
    };
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawGrid(width, height) {
    if (!state.showGrid) return;
    const spacing = state.cellSize * state.zoom;
    const origin = worldToScreen(0, 0);
    const firstX = Math.floor(-origin.x / spacing);
    const lastX = Math.ceil((width - origin.x) / spacing);
    const firstY = Math.floor(-origin.y / spacing);
    const lastY = Math.ceil((height - origin.y) / spacing);

    const gridInk = state.theme === "light" ? "49,73,97" : "165,203,218";
    const strongGrid = state.theme === "light" ? 0.55 : 0.62;
    const fineGrid = state.theme === "light" ? 0.27 : 0.30;
    for (let i = firstX; i <= lastX; i++) {
      const x = Math.round(origin.x + i * spacing) + 0.5;
      context.strokeStyle = "rgba(" + gridInk + "," + ((i % 5 === 0 ? strongGrid : fineGrid) * state.gridOpacity) + ")";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let i = firstY; i <= lastY; i++) {
      const y = Math.round(origin.y + i * spacing) + 0.5;
      context.strokeStyle = "rgba(" + gridInk + "," + ((i % 5 === 0 ? strongGrid : fineGrid) * state.gridOpacity) + ")";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  function drawToken(token) {
    if (sharedMode && drag?.type === "token" && drag.tokenId === token.id && drag.preview) {
      token = { ...token, ...drag.preview };
      context.globalAlpha = 0.55;
    } else context.globalAlpha = 1;
    const point = worldToScreen((token.x + 0.5) * state.cellSize, (token.y + 0.5) * state.cellSize);
    const radius = state.cellSize * state.zoom * 0.34 * (sharedMode ? clamp(token.size || 1, 0.25, 4) : 1);
    const selected = selectedId === token.id;
    context.save();
    context.shadowColor = "rgba(0,0,0,.5)";
    context.shadowBlur = selected ? 19 : 10;
    context.shadowOffsetY = 4;
    context.fillStyle = "#081522";
    context.beginPath();
    context.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
    context.fill();
    context.restore();

    if (selected) {
      context.strokeStyle = "rgba(131,229,207,.3)";
      context.lineWidth = 6;
      context.beginPath();
      context.arc(point.x, point.y, radius + 8, 0, Math.PI * 2);
      context.stroke();
    }

    const gradient = context.createRadialGradient(point.x - radius * 0.4, point.y - radius * 0.6, 1, point.x, point.y, radius * 1.5);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.01, token.color);
    gradient.addColorStop(1, "#182b3d");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    const tokenImage = sharedMode && sharedTokenImages.get(token.id);
    if (tokenImage) {
      context.save();
      context.beginPath(); context.arc(point.x, point.y, radius - 1, 0, Math.PI * 2); context.clip();
      context.drawImage(tokenImage, point.x - radius, point.y - radius, radius * 2, radius * 2);
      context.restore();
    }
    context.lineWidth = selected ? 3 : 2;
    context.strokeStyle = selected ? "#c6fff0" : "rgba(241,249,255,.7)";
    context.stroke();

    context.fillStyle = "#0b1a2a";
    context.font = "800 " + clamp(radius * 0.72, 10, 23) + "px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (!tokenImage) context.fillText(token.code, point.x, point.y + 1, radius * 1.6);

    if (selected) {
      const label = token.name || token.code;
      context.font = "600 12px system-ui, sans-serif";
      const textWidth = context.measureText(label).width;
      const boxWidth = Math.min(240, textWidth + 22);
      const labelY = point.y + radius + 13;
      context.fillStyle = "#193c42";
      context.strokeStyle = "#498f87";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(point.x - boxWidth / 2, labelY, boxWidth, 27, 7);
      context.fill();
      context.stroke();
      context.fillStyle = "#ddfff4";
      context.fillText(label, point.x, labelY + 14, boxWidth - 14);
    }
    context.globalAlpha = 1;
  }

  function draw() {
    if (!context) return;
    const { width, height } = getDimensions();
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = state.theme === "light" ? "#e7edf3" : "#0a1422";
    context.fillRect(0, 0, width, height);
    const haze = context.createRadialGradient(width * 0.52, height * 0.45, 0, width * 0.52, height * 0.45, Math.max(width, height) * .85);
    haze.addColorStop(0, state.theme === "light" ? "rgba(255,255,255,.65)" : "rgba(27,50,68,.35)");
    haze.addColorStop(1, state.theme === "light" ? "rgba(213,225,233,0)" : "rgba(4,12,23,0)");
    context.fillStyle = haze;
    context.fillRect(0, 0, width, height);

    drawMap();
    drawGrid(width, height);
    for (const token of state.tokens) if (token.id !== selectedId) drawToken(token);
    const selected = selectedToken();
    if (selected) drawToken(selected);
    refs.zoomValue.textContent = Math.round(state.zoom * 100) + " %";
  }

  function resizeCanvas() {
    const size = getDimensions();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function findTokenAt(point) {
    const radius = state.cellSize * state.zoom * 0.34 + 7;
    for (const token of [...state.tokens].reverse()) {
      const screen = worldToScreen((token.x + .5) * state.cellSize, (token.y + .5) * state.cellSize);
      if (Math.hypot(screen.x - point.x, screen.y - point.y) <= radius * (sharedMode ? clamp(token.size || 1, 0.25, 4) : 1)) return token;
    }
    return null;
  }

  function selectToken(id) {
    selectedId = id;
    refreshTokenList();
    refreshSelectionEditor();
    draw();
  }

  function refreshTokenList() {
    refs.tokenList.replaceChildren();
    refs.tokenCount.textContent = String(state.tokens.length);
    const fragment = document.createDocumentFragment();
    for (const token of state.tokens) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "token-item" + (selectedId === token.id ? " selected" : "");
      button.dataset.tokenId = token.id;
      button.setAttribute("aria-pressed", String(selectedId === token.id));
      const swatch = document.createElement("span");
      swatch.className = "token-swatch";
      swatch.style.backgroundColor = token.color;
      swatch.textContent = token.code;
      const name = document.createElement("span");
      name.className = "token-item-text";
      name.textContent = token.name;
      const position = document.createElement("span");
      position.className = "token-item-coord";
      position.textContent = (Math.round(token.x * 10) / 10) + "," + (Math.round(token.y * 10) / 10);
      button.append(swatch, name, position);
      button.addEventListener("click", () => {
        selectToken(token.id);
        if (window.innerWidth <= 720) closeMenu();
      });
      fragment.append(button);
    }
    refs.tokenList.append(fragment);
  }

  function refreshSelectionEditor() {
    const token = selectedToken();
    refs.noSelection.hidden = Boolean(token);
    refs.selectionEditor.hidden = !token;
    if (!token) return;
    refs.tokenName.value = token.name;
    refs.tokenPalette.replaceChildren();
    for (const color of PALETTE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-button" + (token.color === color ? " selected" : "");
      button.style.backgroundColor = color;
      button.setAttribute("aria-label", "Color " + color);
      button.setAttribute("aria-pressed", String(token.color === color));
      button.addEventListener("click", () => {
        if (!editable()) return;
        token.color = color;
        refreshTokenList();
        refreshSelectionEditor();
        save();
        draw();
      });
      refs.tokenPalette.append(button);
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    refs.themeSelect.value = state.theme;
    const browserColor = document.querySelector('meta[name="theme-color"]');
    if (browserColor) browserColor.content = state.theme === "light" ? "#f5f7fa" : "#0b1420";
  }

  function refreshControls() {
    applyTheme();
    refs.gridSize.value = String(state.cellSize);
    refs.gridSizeValue.textContent = state.cellSize + " px";
    refs.gridOpacity.value = String(Math.round(state.gridOpacity * 100));
    refs.gridOpacityValue.textContent = Math.round(state.gridOpacity * 100) + " %";
    refreshMapControls();
    for (const [button, on] of [[refs.gridToggle, state.showGrid], [refs.snapToggle, state.snap]]) {
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    }
    const name = sharedMode ? multiplayer.identityName : state.playerName;
    refs.profileName.textContent = name || "Sin identificar";
    refs.profileAvatar.textContent = (name || "?").trim().charAt(0).toUpperCase();
    document.querySelector(".profile-caption").textContent = sharedMode ? multiplayer.roleLabel : "Jugando como";
    refreshTokenList();
    refreshSelectionEditor();
    draw();
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const point = pointerPosition(event);
    const token = findTokenAt(point);
    const handle = findResizeHandle(point);
    canvas.focus({ preventScroll: true });
    if (handle && state.map) {
      selectToken(null);
      drag = {
        pointerId: event.pointerId, type: "map-resize", point, handle: handle.key,
        x: state.map.xCells, y: state.map.yCells,
        width: state.map.widthCells, height: state.map.heightCells
      };
    } else if (mapEditMode === "move" && pointIsOnMap(point)) {
      selectToken(null);
      drag = { pointerId: event.pointerId, type: "map", point, x: state.map.xCells, y: state.map.yCells };
    } else if (token) {
      selectToken(token.id);
      if (!canMove(token.id)) { showToast("Sin permiso para mover este token, o sala en espera."); return; }
      drag = { pointerId: event.pointerId, type: "token", point, x: token.x, y: token.y, tokenId: token.id };
    } else {
      selectToken(null);
      drag = { pointerId: event.pointerId, type: "pan", point, x: state.cameraX, y: state.cameraY };
    }
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
  }

  function pointerMove(event) {
    const point = pointerPosition(event);
    const world = screenToWorld(point.x, point.y);
    refs.coordinates.textContent = "X " + Math.floor(world.x / state.cellSize) + " · Y " + Math.floor(world.y / state.cellSize);
    if (!drag) {
      const handle = findResizeHandle(point);
      const cursors = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize" };
      canvas.style.cursor = handle ? cursors[handle.key] : "";
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const dx = point.x - drag.point.x;
    const dy = point.y - drag.point.y;
    if (drag.type === "pan") {
      state.cameraX = drag.x + dx;
      state.cameraY = drag.y + dy;
    } else if (drag.type === "map" && state.map) {
      state.map.xCells = clamp(Math.round((drag.x + dx / (state.cellSize * state.zoom)) * 100) / 100, -1000, 1000);
      state.map.yCells = clamp(Math.round((drag.y + dy / (state.cellSize * state.zoom)) * 100) / 100, -1000, 1000);
    } else if (drag.type === "map-resize") {
      resizeMapFromDrag(drag, dx, dy);
    } else if (drag.type === "token") {
      const token = state.tokens.find((item) => item.id === drag.tokenId);
      if (!token) return;
      const point = { x: clamp(drag.x + dx / (state.cellSize * state.zoom), -1000, 1000),
        y: clamp(drag.y + dy / (state.cellSize * state.zoom), -1000, 1000) };
      if (sharedMode) drag.preview = point;
      else Object.assign(token, point);
    }
    draw();
  }

  function pointerEnd(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.type === "token") {
      const token = state.tokens.find((item) => item.id === drag.tokenId);
      if (sharedMode) {
        const proposed = drag.preview;
        drag = null;
        canvas.classList.remove("dragging");
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (event.type !== "pointercancel" && event.type !== "lostpointercapture" && token && proposed && canMove(token.id)) {
          void multiplayer.move(token.id, { x: state.snap ? Math.round(proposed.x) : Math.round(proposed.x * 100) / 100,
            y: state.snap ? Math.round(proposed.y) : Math.round(proposed.y * 100) / 100 });
        }
        draw(); return;
      }
      if (token) {
        token.x = state.snap ? Math.round(token.x) : Math.round(token.x * 100) / 100;
        token.y = state.snap ? Math.round(token.y) : Math.round(token.y * 100) / 100;
      }
      refreshTokenList();
    } else if (drag.type === "map" || drag.type === "map-resize") {
      refreshMapControls();
    }
    drag = null;
    canvas.classList.remove("dragging");
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    save();
    draw();
  }

  function setZoom(next, anchor) {
    const { width, height } = getDimensions();
    const point = anchor || { x: width / 2, y: height / 2 };
    const world = screenToWorld(point.x, point.y);
    state.zoom = clamp(next, MIN_ZOOM, 2.5);
    state.cameraX = point.x - width / 2 - world.x * state.zoom;
    state.cameraY = point.y - height / 2 - world.y * state.zoom;
    save();
    draw();
  }

  function makeToken() {
    if (!editable()) { showToast("La sala utiliza únicamente sus tokens iniciales."); return; }
    if (state.tokens.length >= 100) {
      showToast("Límite de 100 tokens en la versión de prueba.");
      return;
    }
    const used = new Set(state.tokens.map((token) => token.code));
    let number = 1;
    while (used.has("T" + number)) number++;
    const center = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const token = {
      id: "token-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9),
      code: "T" + number,
      name: "Token " + number,
      color: PALETTE[(number - 1) % PALETTE.length],
      x: Math.round(center.x / state.cellSize - .5),
      y: Math.round(center.y / state.cellSize - .5)
    };
    state.tokens.push(token);
    selectToken(token.id);
    save();
    showToast("Token añadido al tablero.");
  }

  function openIdentity() {
    refs.identityName.value = state.playerName;
    if (!refs.identityDialog.open) refs.identityDialog.showModal();
    refs.identityName.focus();
    refs.identityName.select();
  }

  function closeMenu() {
    refs.sidebar.classList.remove("open");
    refs.menuToggle.setAttribute("aria-expanded", "false");
    refs.menuToggle.setAttribute("aria-label", "Mostrar herramientas");
  }

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);
  canvas.addEventListener("lostpointercapture", (event) => {
    if (drag && event.pointerId === drag.pointerId) pointerEnd(event);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(state.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), pointerPosition(event));
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      selectToken(null);
      return;
    }
    const token = selectedToken();
    if (!token) return;
    const amount = state.snap ? 1 : .25;
    const movement = { ArrowUp: [0, -amount], ArrowDown: [0, amount], ArrowLeft: [-amount, 0], ArrowRight: [amount, 0] };
    if (movement[event.key]) {
      event.preventDefault();
      if (sharedMode) {
        if (!canMove(token.id)) showToast("Sin permiso para mover este token, o sala en espera.");
        else if (!event.repeat) void multiplayer.move(token.id, { x: token.x + movement[event.key][0], y: token.y + movement[event.key][1] });
        return;
      }
      token.x = clamp(Math.round((token.x + movement[event.key][0]) * 100) / 100, -1000, 1000);
      token.y = clamp(Math.round((token.y + movement[event.key][1]) * 100) / 100, -1000, 1000);
      refreshTokenList();
      save();
      draw();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      document.getElementById("deleteToken").click();
    }
  });

  refs.gridOpacity.addEventListener("input", (event) => {
    state.gridOpacity = clamp(Number(event.target.value) / 100, 0.1, 1);
    refs.gridOpacityValue.textContent = Math.round(state.gridOpacity * 100) + " %";
    save();
    draw();
  });
  refs.mapUpload.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    refs.mapUpload.disabled = true;
    try {
      await importMap(file);
    } finally {
      refs.mapUpload.disabled = false;
      refs.mapUpload.value = "";
    }
  });
  for (const [id, property] of [["mapColumns", "widthCells"], ["mapRows", "heightCells"], ["mapOffsetX", "xCells"], ["mapOffsetY", "yCells"]]) {
    refs[id].addEventListener("change", (event) => updateMapSetting(property, event.target.value));
  }
  refs.mapMoveToggle.addEventListener("click", () => {
    if (!editable()) return;
    if (!state.map || !mapImage) return;
    mapEditMode = mapEditMode === "move" ? null : "move";
    refreshMapControls();
    draw();
  });
  refs.mapResizeToggle.addEventListener("click", () => {
    if (!editable()) return;
    if (!state.map || !mapImage) return;
    mapEditMode = mapEditMode === "resize" ? null : "resize";
    refreshMapControls();
    draw();
  });
  refs.themeSelect.addEventListener("change", (event) => {
    state.theme = event.target.value === "dark" ? "dark" : "light";
    applyTheme();
    save();
    draw();
  });
  document.getElementById("fitMap").addEventListener("click", fitMapIntoViewport);
  document.getElementById("removeMap").addEventListener("click", removeMap);

  refs.gridSize.addEventListener("input", (event) => {
    state.cellSize = Number(event.target.value);
    refs.gridSizeValue.textContent = state.cellSize + " px";
    draw();
    save();
  });
  refs.gridToggle.addEventListener("click", () => {
    state.showGrid = !state.showGrid;
    refreshControls();
    save();
  });
  refs.snapToggle.addEventListener("click", () => {
    state.snap = !state.snap;
    refreshControls();
    save();
  });
  refs.tokenName.addEventListener("input", () => {
    if (!editable()) return;
    const token = selectedToken();
    if (!token) return;
    token.name = refs.tokenName.value.slice(0, 32);
    refreshTokenList();
    save();
    draw();
  });
  refs.deleteToken.addEventListener("click", () => {
    if (!editable()) return;
    const token = selectedToken();
    if (!token || !window.confirm("¿Eliminar " + (token.name || token.code) + " del tablero?")) return;
    state.tokens = state.tokens.filter((item) => item.id !== token.id);
    selectToken(null);
    save();
    showToast("Token eliminado.");
  });
  document.getElementById("addToken").addEventListener("click", makeToken);
  document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom * 1.2));
  document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom / 1.2));
  document.getElementById("resetView").addEventListener("click", () => {
    state.zoom = 1;
    state.cameraX = 0;
    state.cameraY = 0;
    save();
    draw();
    showToast("Vista centrada.");
  });
  document.getElementById("changeIdentity").addEventListener("click", openIdentity);
  refs.identityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = refs.identityName.value.trim().slice(0, 24);
    if (value.length < 2) {
      refs.identityName.setCustomValidity("Escribe al menos dos caracteres.");
      refs.identityName.reportValidity();
      return;
    }
    refs.identityName.setCustomValidity("");
    state.playerName = value;
    refs.identityDialog.close();
    refreshControls();
    save();
    showToast("¡Bienvenid@, " + value + "!");
  });
  refs.identityName.addEventListener("input", () => refs.identityName.setCustomValidity(""));
  refs.identityDialog.addEventListener("cancel", (event) => {
    if (!state.playerName) event.preventDefault();
  });
  refs.menuToggle.addEventListener("click", () => {
    const expanded = refs.sidebar.classList.toggle("open");
    refs.menuToggle.setAttribute("aria-expanded", String(expanded));
    refs.menuToggle.setAttribute("aria-label", expanded ? "Ocultar herramientas" : "Mostrar herramientas");
  });
  document.getElementById("workspace").addEventListener("pointerdown", () => {
    if (window.innerWidth <= 720) closeMenu();
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  refreshControls();
  resizeCanvas();
  void restoreMapImage();
  window.NaufragioBoard = Object.freeze({
    localTokens: () => structuredClone((localBackup || state).tokens),
    async localResources() {
      if (sharedMode) throw new Error("LOCAL_BOARD_REQUIRED");
      const map = state.map ? structuredClone(state.map) : null;
      const blob = map ? await assetRequest("get") : null;
      return { map: map && blob instanceof Blob ? map : null, blob: blob instanceof Blob ? blob : null,
        tokens: structuredClone(state.tokens) };
    },
    tokens: () => structuredClone(state.tokens),
    sharedView: () => sharedMode ? { map: state.map && structuredClone(state.map), portraits: [...sharedTokenImages.keys()] } : null,
    notify: showToast,
    enterShared(callbacks) {
      if (!sharedMode) localBackup = structuredClone(state);
      sharedMode = true; multiplayer = callbacks; mapLoadGeneration++; mapEditMode = null;
      mapImage = null; sharedVisuals.clear(); sharedTokenImages.clear();
      state.map = null; state.tokens = []; selectedId = null; drag = null;
      document.body.dataset.mode = "shared"; refreshControls();
    },
    applyShared(tokens) {
      if (!sharedMode) return;
      state.tokens = structuredClone(tokens).map(token => ({ ...token, ...(sharedVisuals.get(token.id) || {}) })); drag = null;
      canvas.classList.remove("dragging");
      if (!state.tokens.some(token => token.id === selectedId)) selectedId = null;
      refreshTokenList(); refreshSelectionEditor(); draw();
    },
    async applySharedResources(data) {
      if (!sharedMode) return;
      const version = ++mapLoadGeneration;
      const visuals = new Map(data.manifest?.tokens?.map(token => [token.id, {
        name: token.name, color: token.color, size: token.size
      }]) || []);
      sharedVisuals = visuals;
      state.tokens = state.tokens.map(token => ({ ...token, ...(visuals.get(token.id) || {}) }));
      sharedTokenImages.clear(); state.map = null; mapImage = null;
      const blobs = data.blobs || new Map();
      for (const item of data.manifest?.tokens || []) {
        const blob = item.imageId && blobs.get(item.imageId);
        if (!blob) continue;
        try {
          const image = await decodeMapImage(blob);
          if (version !== mapLoadGeneration || !sharedMode) return;
          if (imageIsWithinLimits(image)) sharedTokenImages.set(item.id, image);
        } catch { /* Unusable remote image stays hidden; never draw unverified bytes. */ }
      }
      const sourceMap = data.manifest?.map;
      if (sourceMap && blobs.get('map')) {
        try {
          const image = await decodeMapImage(blobs.get('map'));
          if (version !== mapLoadGeneration || !sharedMode) return;
          if (imageIsWithinLimits(image) && image.naturalWidth === sourceMap.widthPx &&
              image.naturalHeight === sourceMap.heightPx) {
            state.map = structuredClone(sourceMap);
            mapImage = image;
          }
        } catch { /* A malformed image cannot become the active map. */ }
      }
      if (version !== mapLoadGeneration || !sharedMode) return;
      refreshMapControls(); refreshTokenList(); draw();
    },
    exitShared() {
      if (!sharedMode) return;
      sharedMode = false; multiplayer = null; sharedVisuals.clear(); sharedTokenImages.clear(); mapImage = null;
      Object.assign(state, localBackup); localBackup = null;
      mapLoadGeneration++; selectedId = null; drag = null; document.body.dataset.mode = "local";
      canvas.classList.remove("dragging"); refreshControls(); void restoreMapImage();
    }
  });
  window.dispatchEvent(new Event("naufragio:board:ready"));
})();
