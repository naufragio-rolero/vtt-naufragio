"use strict";

(() => {
  const STORAGE_KEY = "naufragio-vtt-mvp-v1";
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
      base.showGrid = stored.showGrid !== false;
      base.snap = stored.snap !== false;
      base.zoom = clamp(finiteOr(stored.zoom, 1), 0.5, 2.5);
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

    for (let i = firstX; i <= lastX; i++) {
      const x = Math.round(origin.x + i * spacing) + 0.5;
      context.strokeStyle = i % 5 === 0 ? "rgba(139,170,193,.20)" : "rgba(139,170,193,.09)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let i = firstY; i <= lastY; i++) {
      const y = Math.round(origin.y + i * spacing) + 0.5;
      context.strokeStyle = i % 5 === 0 ? "rgba(139,170,193,.20)" : "rgba(139,170,193,.09)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  function drawToken(token) {
    const point = worldToScreen((token.x + 0.5) * state.cellSize, (token.y + 0.5) * state.cellSize);
    const radius = state.cellSize * state.zoom * 0.34;
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
    context.lineWidth = selected ? 3 : 2;
    context.strokeStyle = selected ? "#c6fff0" : "rgba(241,249,255,.7)";
    context.stroke();

    context.fillStyle = "#0b1a2a";
    context.font = "800 " + clamp(radius * 0.72, 10, 23) + "px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(token.code, point.x, point.y + 1, radius * 1.6);

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
  }

  function draw() {
    if (!context) return;
    const { width, height } = getDimensions();
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0a1422";
    context.fillRect(0, 0, width, height);
    const haze = context.createRadialGradient(width * 0.52, height * 0.45, 0, width * 0.52, height * 0.45, Math.max(width, height) * .85);
    haze.addColorStop(0, "rgba(27,50,68,.35)");
    haze.addColorStop(1, "rgba(4,12,23,0)");
    context.fillStyle = haze;
    context.fillRect(0, 0, width, height);

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
      if (Math.hypot(screen.x - point.x, screen.y - point.y) <= radius) return token;
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
        token.color = color;
        refreshTokenList();
        refreshSelectionEditor();
        save();
        draw();
      });
      refs.tokenPalette.append(button);
    }
  }

  function refreshControls() {
    refs.gridSize.value = String(state.cellSize);
    refs.gridSizeValue.textContent = state.cellSize + " px";
    for (const [button, on] of [[refs.gridToggle, state.showGrid], [refs.snapToggle, state.snap]]) {
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    }
    refs.profileName.textContent = state.playerName || "Sin identificar";
    refs.profileAvatar.textContent = (state.playerName || "?").trim().charAt(0).toUpperCase();
    refreshTokenList();
    refreshSelectionEditor();
    draw();
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const point = pointerPosition(event);
    const token = findTokenAt(point);
    canvas.focus({ preventScroll: true });
    if (token) {
      selectToken(token.id);
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
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = point.x - drag.point.x;
    const dy = point.y - drag.point.y;
    if (drag.type === "pan") {
      state.cameraX = drag.x + dx;
      state.cameraY = drag.y + dy;
    } else {
      const token = state.tokens.find((item) => item.id === drag.tokenId);
      if (!token) return;
      token.x = clamp(drag.x + dx / (state.cellSize * state.zoom), -1000, 1000);
      token.y = clamp(drag.y + dy / (state.cellSize * state.zoom), -1000, 1000);
    }
    draw();
  }

  function pointerEnd(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.type === "token") {
      const token = state.tokens.find((item) => item.id === drag.tokenId);
      if (token) {
        token.x = state.snap ? Math.round(token.x) : Math.round(token.x * 100) / 100;
        token.y = state.snap ? Math.round(token.y) : Math.round(token.y * 100) / 100;
      }
      refreshTokenList();
    }
    drag = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    save();
    draw();
  }

  function setZoom(next, anchor) {
    const { width, height } = getDimensions();
    const point = anchor || { x: width / 2, y: height / 2 };
    const world = screenToWorld(point.x, point.y);
    state.zoom = clamp(next, 0.5, 2.5);
    state.cameraX = point.x - width / 2 - world.x * state.zoom;
    state.cameraY = point.y - height / 2 - world.y * state.zoom;
    save();
    draw();
  }

  function makeToken() {
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
    const token = selectedToken();
    if (!token) return;
    token.name = refs.tokenName.value.slice(0, 32);
    refreshTokenList();
    save();
    draw();
  });
  refs.deleteToken.addEventListener("click", () => {
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
  if (!state.playerName) openIdentity();
})();
