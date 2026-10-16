/* ===========================================================
   RACK 3D — VISOR CONECTADO AL INVENTARIO REAL (Firestore)
   -----------------------------------------------------------
   Este archivo NO inventa datos: dibuja exactamente los racks
   y cajas que existen en la base (colecciones "racks" y "cajas").

   Se comunica con app.js mediante estas funciones globales:
     window.entradaRapida(ubicacion, nombre, pn, cantidad, coment)
     window.salidaRapida(ubicacion, nombre, cantidad, coment)
     window.crearCajaEnSlot(rack, nivel, slot)
     window.eliminarCaja(ubicacion)
     window.irAEntrada(ubicacion)
     window.isAdminUser()
   =========================================================== */

(function () {

  let scene, camera, renderer, controls;
  let worldGroup, highlightMesh, areaGlowMesh, hoverLight, backdropPlane, backdropMat;
  let container, overlay, canvasHost, pisoMesh;
  let iniciado = false;

  let raycastTargets = [];
  let racksData = [];
  let allBoxes = [];

  let currentLevel = 0;      // 0 global · 1 rack · 2 slot · 3 caja
  let hoveredObject = null;
  let activeSlot = null;
  let inspectedBox = null;
  const navStack = [];

  let blinkInterval = null;
  let blinkState = false;

  let vistaGuardada = null;  // para restaurar tras recargar datos

  /* Material de migración: cajas pendientes de acomodar (a un lado de los racks) */
  let pendBoxes = [];            // cajas pendientes dibujadas en el área de pendientes
  let pendZona = null;           // medidas/posición del área de pendientes
  let enPendientes = false;      // la cámara está viendo el área de pendientes
  let pendPanel = { abierto: false, filtro: "" };
  let pendModal = null;          // { ubicacionActual, caja, slotId } mientras se confirma un acomodo
  let pendConfirmando = false;
  let vistaGlobal = null;        // cámara de la vista general (se ajusta para incluir el área de pendientes)
  let ajusteInicial = false;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tempV = new THREE.Vector3();

  /* =====================
     MEDIDAS
  ===================== */
  const SLOT_W = 0.58;
  const NIVEL_H = 0.75;
  const SHELF_DEPTH = 0.8;
  const GAP_RACKS = 0;   // racks pegados (comparten parales)
  const Y_BASE = 0.1;

  /* =====================
     MATERIALES
  ===================== */
  let matGreenIndustrial, matOrangeBeam, matWireMesh, matBoxSide, matFloor, sheetMat;

  function pad2(n) { return String(n).padStart(2, "0"); }

  /* Estados de caja (el usuario los cambia manualmente en cada caja).
     El estado define SOLO el color; el tamaño físico se elige aparte. */
  const ESTADOS = {
    vacia: { key: 'vacia', label: 'Caja vacía',      color: '#f87171' },
    bajo:  { key: 'bajo',  label: 'Poco contenido',  color: '#38bdf8' },
    medio: { key: 'medio', label: 'Contenido medio', color: '#fb923c' },
    lleno: { key: 'lleno', label: 'Caja llena',      color: '#4ade80' }
  };

  /* Tamaños físicos de caja: lo que se ve en el modelo 3D */
  const TAMANOS = {
    chica:   { key: 'chica',   label: 'Chica',   dims: { w: 0.12, h: 0.12, d: 0.17 } },
    mediana: { key: 'mediana', label: 'Mediana', dims: { w: 0.17, h: 0.17, d: 0.21 } },
    grande:  { key: 'grande',  label: 'Grande',  dims: { w: 0.22, h: 0.22, d: 0.24 } }
  };

  function tamanoDeCaja(caja) {
    const guardado = String(caja.tamano || "").toLowerCase();
    return TAMANOS[guardado] || TAMANOS.mediana;   // sin tamaño guardado = mediana
  }

  /* Si la caja tiene estado guardado se respeta; si no, se calcula por contenido */
  function estadoDeCaja(caja) {
    const guardado = String(caja.estado || "").toLowerCase();
    if (ESTADOS[guardado]) return ESTADOS[guardado];

    const n = (caja.componentes || []).length;
    if (n === 0) return ESTADOS.vacia;
    if (n >= 6) return ESTADOS.lleno;
    if (n >= 3) return ESTADOS.medio;
    return ESTADOS.bajo;
  }

  /* =====================
     APILADO FÍSICO EN EL SLOT
     Las cajas se acomodan en una rejilla sobre la repisa (columnas x filas)
     y, cuando ya no caben en el piso, se colocan ENCIMA de la caja de abajo:
     la altura de cada pila se acumula con la altura real de cada caja, así
     nunca quedan flotando. Si hay muchas cajas, todas se reducen de forma
     uniforme para que quepan dentro del slot (auto-ajustable).
  ===================== */
  const SLOT_AREA = { w: 0.50, d: 0.72, h: 0.64 };   // espacio útil de un slot
  /* Tarimas: Tarima 1 a la izquierda del rack; Tarimas 2, 3 y 4 a la derecha. */
  const TARIMA = { w: 1.0, d: 0.9, h: 0.12 };          // tarima (alto = cubierta donde se apoyan las cajas)
  const TARIMA_AREA = { w: 0.9, d: 0.8, h: 0.95 };     // espacio útil para cajas sobre la tarima
  const TARIMA_GAP = 0.45;                             // separación entre el rack y la tarima junto a él
  const TARIMA_GAP_ENTRE = 0.3;                        // separación entre tarimas
  const CAJA_GAP_H = 0.014;   // separación horizontal/profundidad entre columnas (para que se vean distintas)
  const CAJA_GAP_V = 0;       // separación vertical: 0 = las cajas quedan literalmente pegadas, sin flotar

  function planificarSlot(cajasSlot, slotX, yRepisa, area) {
    area = area || SLOT_AREA;
    const n = cajasSlot.length;
    if (n === 0) return { escala: 1, items: [] };

    const dims = cajasSlot.map(c => tamanoDeCaja(c).dims);
    const maxW = Math.max(...dims.map(d => d.w));
    const maxD = Math.max(...dims.map(d => d.d));
    const maxH = Math.max(...dims.map(d => d.h));

    // escala uniforme más grande con la que caben las n cajas
    let esc = 1, cols = 1, rows = 1, capas = 1;
    for (;;) {
      cols  = Math.max(1, Math.floor(area.w / (maxW * esc + CAJA_GAP_H)));
      rows  = Math.max(1, Math.floor(area.d / (maxD * esc + CAJA_GAP_H)));
      capas = Math.max(1, Math.floor(area.h / (maxH * esc + CAJA_GAP_V)));
      if (cols * rows * capas >= n || esc <= 0.25) break;
      esc = Math.round((esc - 0.05) * 100) / 100;
    }

    const cellW = maxW * esc + CAJA_GAP_H;
    const cellD = maxD * esc + CAJA_GAP_H;

    const colsUsadas = Math.min(cols, n);
    const rowsUsadas = Math.min(rows, Math.ceil(n / colsUsadas));
    const porCapa = colsUsadas * rowsUsadas;

    const alturaPila = {};          // altura acumulada por posición (col,fila) — sin espacio: la de arriba se apoya justo en el tope de la de abajo
    const items = cajasSlot.map((c, i) => {
      const idx = i % porCapa;
      const col = idx % colsUsadas;
      const row = Math.floor(idx / colsUsadas);
      const d = dims[i];
      const w = d.w * esc, h = d.h * esc, dp = d.d * esc;

      const key = col + ',' + row;
      const base = alturaPila[key] || 0;          // tope exacto de la caja de abajo (0 de espacio = pegadas)
      alturaPila[key] = base + h + CAJA_GAP_V;

      return {
        x: slotX + (col - (colsUsadas - 1) / 2) * cellW,
        y: yRepisa + base + h / 2,                // apoyada exactamente sobre la de abajo, sin hueco
        z: (row - (rowsUsadas - 1) / 2) * cellD,
        dims: { w, h, d: dp }
      };
    });

    return { escala: esc, items };
  }

  function esPend(c) {
    return typeof window.esCajaPendiente === "function" ? window.esCajaPendiente(c) : false;
  }

  function esAdmin() {
    return typeof window.isAdminUser === "function" ? window.isAdminUser() : false;
  }

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escJs(s) {
    return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  /* =====================
     TEXTURAS
  ===================== */
  function createFloorLabelTexture(text, fontPx) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#000000'; ctx.font = '900 ' + (fontPx || 44) + 'px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);
    return new THREE.CanvasTexture(canvas);
  }

  function createSignTexture(l1, l2) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#facc15'; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#78350f'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 502, 150);
    ctx.fillStyle = '#1c1917'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 44px "Segoe UI", Arial, sans-serif';
    ctx.fillText(l1, 256, 60);
    ctx.font = '700 36px "Segoe UI", Arial, sans-serif';
    ctx.fillText(l2, 256, 116);
    return new THREE.CanvasTexture(canvas);
  }

  function createFrontLabelMaterial(boxNumberText, labelColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#b08455'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(160, 110, 60, 0.15)';
    for (let i = 0; i < 256; i += 4) ctx.fillRect(0, i, 256, 2);

    ctx.fillStyle = 'rgba(217, 119, 6, 0.35)'; ctx.fillRect(0, 110, 256, 35);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(40, 70, 176, 115);
    ctx.fillStyle = labelColor; ctx.fillRect(40, 70, 176, 26);

    ctx.fillStyle = '#0f172a';
    let txt = String(boxNumberText || "");
    let size = 20;
    ctx.font = 'bold ' + size + 'px sans-serif';
    while (ctx.measureText(txt).width > 166 && size > 9) {
      size--; ctx.font = 'bold ' + size + 'px sans-serif';
    }
    ctx.textAlign = 'center';
    ctx.fillText(txt, 128, 112);

    ctx.fillStyle = '#1e293b';
    for (let x = 55; x < 195; x += 7) ctx.fillRect(x, 130, 4, 42);

    const tex = new THREE.CanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  }

  /* =====================
     INICIALIZACIÓN
  ===================== */
  function init(hostId) {
    if (iniciado) return;

    container = document.getElementById(hostId);
    if (!container || typeof THREE === "undefined") return;

    canvasHost = container.querySelector(".r3d-canvas");
    overlay = container.querySelector(".r3d-overlay");

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    scene.fog = new THREE.FogExp2(0x0a0e17, 0.018);

    const w = canvasHost.clientWidth || 800;
    const h = canvasHost.clientHeight || 520;

    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    camera.position.set(6, 4.5, 7.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    canvasHost.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(1.5, 1.2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xf1f5f9, 0.85));

    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    hoverLight = new THREE.PointLight(0x38bdf8, 0, 4);
    scene.add(hoverLight);

    sheetMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.5, metalness: 0.2 });
    matGreenIndustrial = new THREE.MeshStandardMaterial({ color: 0x2d5b5a, roughness: 0.5, metalness: 0.3 });
    matOrangeBeam = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.4, metalness: 0.3 });
    matWireMesh = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7, wireframe: true });
    matFloor = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.1 });

    const cardboardSideCanvas = document.createElement('canvas');
    cardboardSideCanvas.width = 128; cardboardSideCanvas.height = 128;
    const ctxSide = cardboardSideCanvas.getContext('2d');
    ctxSide.fillStyle = '#b08455'; ctxSide.fillRect(0, 0, 128, 128);
    ctxSide.fillStyle = 'rgba(160, 110, 60, 0.15)';
    for (let i = 0; i < 128; i += 4) ctxSide.fillRect(0, i, 128, 2);
    matBoxSide = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cardboardSideCanvas), roughness: 0.8 });

    backdropMat = new THREE.MeshBasicMaterial({ color: 0x080a0f, transparent: true, opacity: 0, depthWrite: false });
    backdropPlane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), backdropMat);
    backdropPlane.position.set(0, 0, 0.5); backdropPlane.renderOrder = 5;
    scene.add(backdropPlane);

    highlightMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.6 }));
    highlightMesh.visible = false; scene.add(highlightMesh);

    areaGlowMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    areaGlowMesh.visible = false; scene.add(areaGlowMesh);

    worldGroup = new THREE.Group();
    scene.add(worldGroup);

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerStart);
    renderer.domElement.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('resize', onResize);

    const searchInput = document.getElementById('r3d-search');
    if (searchInput) searchInput.addEventListener('input', updateSuggestionsList);

    const legend = container.querySelector('.r3d-legend');
    if (legend) {
      legend.innerHTML = Object.values(ESTADOS)
        .map(e => `<span><i style="background:${e.color}"></i> ${e.label}</span>`)
        .join('');
    }

    vistaGlobal = { pos: new THREE.Vector3(6, 4.5, 7.5), target: new THREE.Vector3(1.5, 1.2, 0) };

    iniciado = true;
    animate();
  }

  function onResize() {
    if (!renderer || !canvasHost) return;
    const w = canvasHost.clientWidth || 800;
    const h = canvasHost.clientHeight || 520;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (currentLevel === 2) ajustarZonaGaleria();   // la barra superior puede cambiar de alto
  }

  /* =====================
     LIMPIEZA DE ESCENA
  ===================== */
  function limpiarMundo() {
    stopBlink();
    if (overlay) overlay.innerHTML = "";

    while (worldGroup.children.length) {
      const obj = worldGroup.children.pop();
      obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
      worldGroup.remove(obj);
    }

    raycastTargets = [];
    racksData = [];
    allBoxes = [];
    pendBoxes = [];
    pendZona = null;
    enPendientes = false;
    activeSlot = null;
    inspectedBox = null;
    hoveredObject = null;
    navStack.length = 0;
    currentLevel = 0;
    if (backdropMat) backdropMat.opacity = 0;
    if (highlightMesh) highlightMesh.visible = false;
    if (areaGlowMesh) areaGlowMesh.visible = false;
  }

  function buildUpright(x, alturaRack) {
    const group = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.06, alturaRack, 0.06);

    const p1 = new THREE.Mesh(postGeo, matGreenIndustrial);
    p1.position.set(x, alturaRack / 2, -SHELF_DEPTH / 2); p1.castShadow = true;
    const p2 = new THREE.Mesh(postGeo, matGreenIndustrial);
    p2.position.set(x, alturaRack / 2, SHELF_DEPTH / 2); p2.castShadow = true;
    group.add(p1, p2);

    const secH = alturaRack / 4;
    for (let i = 0; i < 4; i++) {
      const horiz = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, SHELF_DEPTH), matGreenIndustrial);
      horiz.position.set(x, i * secH, 0); horiz.rotation.x = Math.PI / 2;
      group.add(horiz);
    }
    return group;
  }

  /* =====================
     CONSTRUCCIÓN DESDE DATOS REALES
  ===================== */
  /* Área de pendientes de acomodar: una tarima a la derecha del último rack con las
     cajas de migración en rejilla (y apiladas si son muchas). */
  const PEND_COLS = 6, PEND_CELL_W = 0.25, PEND_CELL_D = 0.27, PEND_MAX_ROWS = 5;
  function medidasZonaPend(n) {
    if (n <= 0) return null;
    const cols = Math.min(PEND_COLS, n);
    const rowsCapa = Math.min(PEND_MAX_ROWS, Math.ceil(n / cols));
    return { cols, rowsCapa, porCapa: cols * rowsCapa, w: cols * PEND_CELL_W + 0.2, d: rowsCapa * PEND_CELL_D + 0.2 };
  }

  function construir(racks, cajas) {

    limpiarMundo();

    const activos = (racks || []).filter(r => r.status === "active");
    const racksFis = activos.filter(r => !r.tarima);
    const tarimas = activos.filter(r => r.tarima)
      .sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), undefined, { numeric: true }));
    const tarimaIzq = tarimas.filter(t => String(t.nombre).toUpperCase() === "T1");   // Tarima 1: a la izquierda del rack
    const tarimasDer = tarimas.filter(t => String(t.nombre).toUpperCase() !== "T1");  // Tarimas 2, 3 y 4: a la derecha

    // cajas de migración pendientes de acomodar (no están en ningún slot todavía)
    const pend = (cajas || []).filter(esPend)
      .sort((a, b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion), undefined, { numeric: true }));
    const medPend = medidasZonaPend(pend.length);

    // --- distribución a lo largo del almacén (vista de frente, X crece hacia la derecha) ---
    const anchoRacks = racksFis.reduce((acc, r) => acc + (Math.max(1, parseInt(r.slots) || 1)) * SLOT_W + GAP_RACKS, 0);
    const minX = tarimaIzq.length ? -(TARIMA_GAP + tarimaIzq.length * TARIMA.w + (tarimaIzq.length - 1) * TARIMA_GAP_ENTRE) : 0;
    const anchoDer = tarimasDer.length ? TARIMA_GAP + tarimasDer.length * TARIMA.w + (tarimasDer.length - 1) * TARIMA_GAP_ENTRE : 0;
    const finTarimasX = anchoRacks + anchoDer;
    const pendX0 = finTarimasX + 0.7;                    // el área de pendientes queda DESPUÉS de las tarimas
    const maxX = medPend ? pendX0 + medPend.w : finTarimasX;
    const centroX = (minX + maxX) / 2;
    const anchoMundo = Math.max(12, (maxX - minX) + 6);

    // --- piso y pared ---
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(anchoMundo + 10, 25), matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centroX, 0, 0);
    floor.receiveShadow = true;
    worldGroup.add(floor);
    pisoMesh = floor;

    const wallZ = -0.55;
    const alturaPared = 8;
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(anchoMundo + 10, alturaPared), sheetMat);
    backWall.position.set(centroX, alturaPared / 2, wallZ);
    backWall.receiveShadow = true;
    worldGroup.add(backWall);

    const spacing = 0.5;
    const countRibs = Math.floor((anchoMundo + 10) / spacing);
    for (let i = 0; i < countRibs; i++) {
      const posX = centroX - ((anchoMundo + 10) / 2) + i * spacing;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.12, alturaPared, 0.05), sheetMat);
      rib.position.set(posX, alturaPared / 2, wallZ + 0.025);
      worldGroup.add(rib);
    }


    let cursorX = 0;
    const paralesPuestos = [];

    function ponerParal(x, altura) {
      const yaEsta = paralesPuestos.some(p => Math.abs(p.x - x) < 0.001 && p.altura >= altura - 0.001);
      if (yaEsta) return;
      paralesPuestos.push({ x, altura });
      worldGroup.add(buildUpright(x, altura));
    }

    racksFis.forEach(rack => {

      const nNiveles = Math.max(1, parseInt(rack.niveles) || 1);
      const nSlots = Math.max(1, parseInt(rack.slots) || 1);
      const shelfWidth = nSlots * SLOT_W;
      const alturaRack = Y_BASE + nNiveles * NIVEL_H;
      const rackX = cursorX;

      const rackObj = {
        id: `Rack ${rack.nombre}`,
        rackIndex: rack.nombre,
        niveles: nNiveles,
        slots: nSlots,
        position: new THREE.Vector3(rackX + shelfWidth / 2, alturaRack / 2, 0)
      };

      ponerParal(rackX, alturaRack);
      ponerParal(rackX + shelfWidth, alturaRack);

      // etiqueta en el piso
      const labelMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(1.4, shelfWidth * 0.9), 0.6),
        new THREE.MeshBasicMaterial({ map: createFloorLabelTexture("RACK " + rack.nombre), transparent: true, opacity: 0.9 })
      );
      labelMesh.rotation.x = -Math.PI / 2;
      labelMesh.position.set(rackX + shelfWidth / 2, 0.005, 0.85);
      worldGroup.add(labelMesh);

      for (let nivel = 1; nivel <= nNiveles; nivel++) {

        const y = Y_BASE + (nivel - 1) * NIVEL_H;

        const bFront = new THREE.Mesh(new THREE.BoxGeometry(shelfWidth, 0.08, 0.04), matOrangeBeam);
        bFront.position.set(rackX + shelfWidth / 2, y, SHELF_DEPTH / 2); bFront.castShadow = true;
        const bBack = bFront.clone(); bBack.position.z = -SHELF_DEPTH / 2;
        worldGroup.add(bFront, bBack);

        for (let slot = 1; slot <= nSlots; slot++) {

          const slotX = rackX + (slot - 0.5) * SLOT_W;

          const slotMesh = new THREE.Mesh(
            new THREE.BoxGeometry(SLOT_W - 0.04, 0.02, SHELF_DEPTH - 0.04), matWireMesh);
          slotMesh.position.set(slotX, y + 0.01, 0);
          worldGroup.add(slotMesh);

          const slotHitbox = new THREE.Mesh(
            new THREE.BoxGeometry(SLOT_W, NIVEL_H * 0.75, SHELF_DEPTH),
            new THREE.MeshBasicMaterial({ visible: false }));
          slotHitbox.position.set(slotX, y + 0.28, 0);
          worldGroup.add(slotHitbox);

          const slotIdCode = `${rack.nombre}-${pad2(nivel)}-${pad2(slot)}`;

          const slotData = {
            id: slotIdCode,
            rackIndex: rack.nombre,
            level: nivel,
            slotIndex: slot,
            position: new THREE.Vector3(slotX, y + 0.2, 0),
            hitbox: slotHitbox,
            boxes: []
          };

          // --- CAJAS REALES DE ESTE SLOT ---
          const cajasSlot = (cajas || []).filter(c =>
            !esPend(c) &&
            c.rack === rack.nombre &&
            Number(c.nivel) === nivel &&
            Number(c.slot) === slot
          ).sort((a, b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion), undefined, { numeric: true }));

          // la repisa (malla del slot) termina en y + 0.02
          const plan = planificarSlot(cajasSlot, slotX, y + 0.02);

          cajasSlot.forEach((c, i) => {

            const comps = c.componentes || [];
            const bConfig = estadoDeCaja(c);
            const tConfig = tamanoDeCaja(c);
            const estadoManual = !!ESTADOS[String(c.estado || "").toLowerCase()];

            const p = plan.items[i];
            const posX = p.x, posY = p.y, posZ = p.z;
            const dimsCaja = p.dims;

            const etiqueta = String(c.caja || c.ubicacion);

            const boxMaterials = [
              matBoxSide, matBoxSide, matBoxSide, matBoxSide,
              createFrontLabelMaterial(etiqueta, bConfig.color),
              matBoxSide
            ];

            const boxMesh = new THREE.Mesh(
              new THREE.BoxGeometry(dimsCaja.w, dimsCaja.h, dimsCaja.d),
              boxMaterials
            );

            const homePos = new THREE.Vector3(posX, posY, posZ);
            boxMesh.position.copy(homePos);
            boxMesh.castShadow = true;
            worldGroup.add(boxMesh);

            const glowMesh = new THREE.Mesh(
              new THREE.BoxGeometry(dimsCaja.w * 1.08, dimsCaja.h * 1.08, dimsCaja.d * 1.08),
              new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0 })
            );
            glowMesh.position.copy(homePos);
            glowMesh.visible = false;
            worldGroup.add(glowMesh);

            const glowLight = new THREE.PointLight(0x38bdf8, 0, 1.2);
            glowLight.position.copy(homePos);
            worldGroup.add(glowLight);

            const dashLine = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([homePos.clone(), homePos.clone()]),
              new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.05, gapSize: 0.03 })
            );
            dashLine.visible = false;
            worldGroup.add(dashLine);

            const originTag = document.createElement('div');
            originTag.className = 'origin-label';
            originTag.innerText = slotIdCode;
            overlay.appendChild(originTag);

            const boxData = {
              id: c.ubicacion,             // ID real en Firestore
              etiqueta,
              slotCode: slotIdCode,
              rack: rack.nombre,
              nivel,
              slot,
              estado: bConfig.key,
              estadoLabel: bConfig.label,
              estadoManual,
              tamano: tConfig.key,
              tamanoLabel: tConfig.label,
              visualEscala: plan.escala,      // <1 cuando el slot está muy lleno
              fly: { t: 0 },                  // avance de la animación hacia la galería
              stageElem: null,
              homePos: homePos.clone(),
              floatingPos: new THREE.Vector3(),
              mesh: boxMesh,
              glowMesh, glowLight, dashLine, originTag,
              cardElem: null,
              parentSlot: slotData,
              capacidad: (typeof c.capacidad === "number") ? c.capacidad : null,
              items: comps.map(x => ({
                name: x.nombre,
                pn: x.pn,
                qty: Number(x.cantidad) || 0,
                responsable: x.responsable,
                comentarios: x.comentarios,
                categoria: x.categoria || "",
                espacio: Number(x.espacio) || 0
              }))
            };

            boxMesh.userData = { type: 'box', data: boxData, parentSlot: slotData };
            slotData.boxes.push(boxData);
            allBoxes.push(boxData);
            raycastTargets.push(boxMesh);
          });

          slotHitbox.userData = { type: 'slot', data: slotData };
          raycastTargets.push(slotHitbox);
        }
      }

      const rackHitbox = new THREE.Mesh(
        new THREE.BoxGeometry(shelfWidth + 0.1, alturaRack + 0.4, SHELF_DEPTH + 0.1),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      rackHitbox.position.copy(rackObj.position);
      rackHitbox.userData = { type: 'rack', data: rackObj };
      worldGroup.add(rackHitbox);
      raycastTargets.push(rackHitbox);
      racksData.push(rackObj);

      cursorX += shelfWidth + GAP_RACKS;
    });

    // --- TARIMAS: la 1 a la izquierda del rack, la 2, 3 y 4 a la derecha ---
    tarimaIzq.forEach((t, i) => {
      const x0 = -(TARIMA_GAP + (tarimaIzq.length - i) * TARIMA.w + (tarimaIzq.length - 1 - i) * TARIMA_GAP_ENTRE);
      construirTarima(t, x0, cajas);
    });
    tarimasDer.forEach((t, i) => {
      const x0 = anchoRacks + TARIMA_GAP + i * (TARIMA.w + TARIMA_GAP_ENTRE);
      construirTarima(t, x0, cajas);
    });

    // --- ÁREA DE PENDIENTES (después de las tarimas) ---
    const fv = Math.max(1, (maxX - minX) / 6);
    vistaGlobal = {
      target: new THREE.Vector3(centroX, 1.0, 0),
      pos: new THREE.Vector3(centroX + 1.5 * fv, 1.2 + 3.0 * fv, 6.8 * fv)
    };
    if (medPend) construirPendientes(pend, medPend, pendX0);
  }

  /* Tarima: ubicación de 1 nivel y 1 slot (T1-01-01 ... T4-01-01) donde se registran cajas
     igual que en un slot de rack. Al hacer clic se abre directo el slot de la tarima. */
  function construirTarima(t, x0, cajas) {

    const nombre = String(t.nombre).toUpperCase();
    const numero = nombre.replace(/^T/, "");
    const etiquetaTar = "TARIMA " + numero;
    const cx = x0 + TARIMA.w / 2;
    const yDeck = TARIMA.h;                          // cara superior de la tarima

    const madera = new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.85 });
    const maderaOsc = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 });

    // cubierta superior (tablones) y base (largueros + tablones inferiores)
    const nTablones = 6;
    const anchoTab = (TARIMA.d - 0.05 * (nTablones - 1)) / nTablones;
    for (let i = 0; i < nTablones; i++) {
      const z = -TARIMA.d / 2 + anchoTab / 2 + i * (anchoTab + 0.05);
      const tab = new THREE.Mesh(new THREE.BoxGeometry(TARIMA.w, 0.025, anchoTab), madera);
      tab.position.set(cx, yDeck - 0.0125, z);
      tab.receiveShadow = true; tab.castShadow = true;
      worldGroup.add(tab);
    }
    [-1, 0, 1].forEach(k => {
      const larguero = new THREE.Mesh(new THREE.BoxGeometry(TARIMA.w, TARIMA.h - 0.05, 0.1), maderaOsc);
      larguero.position.set(cx, 0.025 + (TARIMA.h - 0.05) / 2, k * (TARIMA.d / 2 - 0.07));
      larguero.castShadow = true;
      worldGroup.add(larguero);
    });
    [-1, 0, 1].forEach(k => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, TARIMA.d), maderaOsc);
      base.position.set(cx + k * (TARIMA.w / 2 - 0.08), 0.0125, 0);
      worldGroup.add(base);
    });

    // etiqueta en el piso, frente a la tarima
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.5),
      new THREE.MeshBasicMaterial({ map: createFloorLabelTexture(etiquetaTar, 34), transparent: true, opacity: 0.9 })
    );
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.set(cx, 0.005, TARIMA.d / 2 + 0.4);
    worldGroup.add(labelMesh);

    // slot de la tarima (1 nivel, 1 slot)
    const slotCode = `${nombre}-01-01`;
    const slotPos = new THREE.Vector3(cx, yDeck + 0.18, 0);
    const slotHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(TARIMA.w, 0.9, TARIMA.d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    slotHitbox.position.set(cx, yDeck + 0.45, 0);
    worldGroup.add(slotHitbox);

    const slotData = {
      id: slotCode,
      rackIndex: nombre,
      level: 1,
      slotIndex: 1,
      tarima: true,
      tarimaLabel: etiquetaTar,
      position: slotPos,
      hitbox: slotHitbox,
      boxes: []
    };

    const cajasSlot = (cajas || []).filter(c =>
      !esPend(c) &&
      String(c.rack).toUpperCase() === nombre &&
      Number(c.nivel) === 1 &&
      Number(c.slot) === 1
    ).sort((a, b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion), undefined, { numeric: true }));

    const plan = planificarSlot(cajasSlot, cx, yDeck, TARIMA_AREA);

    cajasSlot.forEach((c, i) => {
      const comps = c.componentes || [];
      const bConfig = estadoDeCaja(c);
      const tConfig = tamanoDeCaja(c);
      const estadoManual = !!ESTADOS[String(c.estado || "").toLowerCase()];

      const p = plan.items[i];
      const dimsCaja = p.dims;
      const etiqueta = String(c.caja || c.ubicacion);

      const boxMaterials = [
        matBoxSide, matBoxSide, matBoxSide, matBoxSide,
        createFrontLabelMaterial(etiqueta, bConfig.color),
        matBoxSide
      ];
      const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(dimsCaja.w, dimsCaja.h, dimsCaja.d), boxMaterials);
      const homePos = new THREE.Vector3(p.x, p.y, p.z);
      boxMesh.position.copy(homePos);
      boxMesh.castShadow = true;
      worldGroup.add(boxMesh);

      const glowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(dimsCaja.w * 1.08, dimsCaja.h * 1.08, dimsCaja.d * 1.08),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0 })
      );
      glowMesh.position.copy(homePos);
      glowMesh.visible = false;
      worldGroup.add(glowMesh);

      const glowLight = new THREE.PointLight(0x38bdf8, 0, 1.2);
      glowLight.position.copy(homePos);
      worldGroup.add(glowLight);

      const dashLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([homePos.clone(), homePos.clone()]),
        new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.05, gapSize: 0.03 })
      );
      dashLine.visible = false;
      worldGroup.add(dashLine);

      const originTag = document.createElement('div');
      originTag.className = 'origin-label';
      originTag.innerText = etiquetaTar;
      overlay.appendChild(originTag);

      const boxData = {
        id: c.ubicacion,
        etiqueta,
        slotCode,
        rack: nombre,
        nivel: 1,
        slot: 1,
        estado: bConfig.key,
        estadoLabel: bConfig.label,
        estadoManual,
        tamano: tConfig.key,
        tamanoLabel: tConfig.label,
        visualEscala: plan.escala,
        fly: { t: 0 },
        stageElem: null,
        homePos: homePos.clone(),
        floatingPos: new THREE.Vector3(),
        mesh: boxMesh,
        glowMesh, glowLight, dashLine, originTag,
        cardElem: null,
        parentSlot: slotData,
        capacidad: (typeof c.capacidad === "number") ? c.capacidad : null,
        items: comps.map(x => ({
          name: x.nombre,
          pn: x.pn,
          qty: Number(x.cantidad) || 0,
          responsable: x.responsable,
          comentarios: x.comentarios,
          categoria: x.categoria || "",
          espacio: Number(x.espacio) || 0
        }))
      };

      boxMesh.userData = { type: 'box', data: boxData, parentSlot: slotData };
      slotData.boxes.push(boxData);
      allBoxes.push(boxData);
      raycastTargets.push(boxMesh);
    });

    slotHitbox.userData = { type: 'slot', data: slotData };
    raycastTargets.push(slotHitbox);

    // zona clicable de toda la tarima (vista general): abre directo su slot
    const altoZona = Math.max(0.7, plan.items.reduce((m, it) => Math.max(m, it.y + it.dims.h / 2), 0) + 0.15);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(TARIMA.w + 0.1, altoZona, TARIMA.d + 0.1),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(cx, altoZona / 2, 0);
    hit.userData = { type: 'tarima', data: { slot: slotData, nombre, etiqueta: etiquetaTar } };
    worldGroup.add(hit);
    raycastTargets.push(hit);

    // letrero en la pared con el nombre y el total de cajas
    const nTxt = cajasSlot.length + (cajasSlot.length === 1 ? " CAJA" : " CAJAS");
    const letrero = new THREE.Mesh(
      new THREE.PlaneGeometry(TARIMA.w, TARIMA.w * 160 / 512),
      new THREE.MeshBasicMaterial({ map: createSignTexture(etiquetaTar, nTxt) })
    );
    letrero.position.set(cx, 1.25, -0.5);
    worldGroup.add(letrero);
  }

  function construirPendientes(pend, med, x0) {

    const zIni = -0.45;                       // la tarima arranca pegada a la pared
    const zCentro = zIni + med.d / 2;
    const cx = x0 + med.w / 2;

    // tarima
    const tarimaGeo = new THREE.BoxGeometry(med.w, 0.04, med.d);
    const tarima = new THREE.Mesh(tarimaGeo, new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 }));
    tarima.position.set(cx, 0.02, zCentro);
    tarima.receiveShadow = true;
    worldGroup.add(tarima);
    const borde = new THREE.LineSegments(new THREE.EdgesGeometry(tarimaGeo), new THREE.LineBasicMaterial({ color: 0xfacc15 }));
    borde.position.copy(tarima.position);
    worldGroup.add(borde);

    // letrero
    const nTxt = pend.length + (pend.length === 1 ? " CAJA" : " CAJAS");
    const letrero = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(med.w, 1.5), Math.max(med.w, 1.5) * 160 / 512),
      new THREE.MeshBasicMaterial({ map: createSignTexture("PENDIENTES DE ACOMODAR", nTxt) })
    );
    letrero.position.set(cx, 1.25, -0.5);
    worldGroup.add(letrero);

    // cajas (en rejilla; si son más de las que caben en el piso, se apilan)
    const alturaPila = {};
    let alturaMax = 0;

    pend.forEach((c, i) => {
      const idx = i % med.porCapa;
      const col = idx % med.cols;
      const row = Math.floor(idx / med.cols);
      const tConfig = tamanoDeCaja(c);
      const d = tConfig.dims;

      const key = col + ',' + row;
      const base = alturaPila[key] || 0;
      alturaPila[key] = base + d.h;
      alturaMax = Math.max(alturaMax, alturaPila[key]);

      const posX = x0 + 0.1 + (col + 0.5) * PEND_CELL_W;
      const posZ = zIni + 0.1 + (row + 0.5) * PEND_CELL_D;
      const posY = 0.04 + base + d.h / 2;

      const etiqueta = String(c.caja || c.ubicacion);
      const boxMaterials = [
        matBoxSide, matBoxSide, matBoxSide, matBoxSide,
        createFrontLabelMaterial(etiqueta, '#facc15'),
        matBoxSide
      ];

      const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), boxMaterials);
      const homePos = new THREE.Vector3(posX, posY, posZ);
      boxMesh.position.copy(homePos);
      boxMesh.castShadow = true;
      worldGroup.add(boxMesh);

      const glowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(d.w * 1.08, d.h * 1.08, d.d * 1.08),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0 })
      );
      glowMesh.position.copy(homePos);
      glowMesh.visible = false;
      worldGroup.add(glowMesh);

      const glowLight = new THREE.PointLight(0xfacc15, 0, 1.2);
      glowLight.position.copy(homePos);
      worldGroup.add(glowLight);

      const dashLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([homePos.clone(), homePos.clone()]),
        new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 0.05, gapSize: 0.03 })
      );
      dashLine.visible = false;
      worldGroup.add(dashLine);

      const originTag = document.createElement('div');
      originTag.className = 'origin-label';
      originTag.innerText = 'PENDIENTE · CAJA ' + etiqueta;
      overlay.appendChild(originTag);

      const boxData = {
        id: c.ubicacion,            // ID real en Firestore (posición provisional de la migración)
        etiqueta,
        pendiente: true,
        slotCode: 'PENDIENTES',
        homePos: homePos.clone(),
        mesh: boxMesh,
        glowMesh, glowLight, dashLine, originTag,
        cardElem: null,
        items: (c.componentes || []).map(x => ({
          name: x.nombre,
          pn: x.pn,
          qty: Number(x.cantidad) || 0,
          categoria: x.categoria || ""
        }))
      };

      boxMesh.userData = { type: 'pbox', data: boxData };
      pendBoxes.push(boxData);
      allBoxes.push(boxData);
      raycastTargets.push(boxMesh);
    });

    // zona clicable (toda la tarima con sus cajas)
    const altoZona = Math.max(0.6, alturaMax + 0.45);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(med.w, altoZona, med.d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(cx, altoZona / 2, zCentro);

    pendZona = { x0, w: med.w, d: med.d, cx, zCentro, alto: altoZona };
    hit.userData = { type: 'pzone', data: pendZona };
    worldGroup.add(hit);
    raycastTargets.push(hit);
  }

  /* =====================
     HOVER / CLICK
  ===================== */
  function onPointerMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (currentLevel === 2 || currentLevel === 3) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(raycastTargets);

    if (intersects.length > 0) {
      let hit = null;
      const searchInput = document.getElementById('r3d-search');
      const searchTerm = searchInput ? searchInput.value.trim() : "";

      if (currentLevel === 0) {
        if (searchTerm) {
          hit = intersects.find(i => (i.object.userData.type === 'box' || i.object.userData.type === 'pbox') && i.object.userData.data.dashLine.visible)?.object;
        }
        // lo más cercano entre un rack y el área de pendientes
        if (!hit) hit = intersects.find(i => ['rack', 'pzone', 'tarima'].includes(i.object.userData.type))?.object;
      } else if (currentLevel === 1 && enPendientes) {
        hit = intersects.find(i => i.object.userData.type === 'pbox')?.object;
      } else if (currentLevel === 1) {
        hit = intersects.find(i => i.object.userData.type === 'slot')?.object;
      }

      if (hit && hoveredObject !== hit) {
        hoveredObject = hit;
        renderer.domElement.style.cursor = 'pointer';

        const bbox = new THREE.Box3().setFromObject(hit);
        const size = new THREE.Vector3(); bbox.getSize(size);
        const center = new THREE.Vector3(); bbox.getCenter(center);

        highlightMesh.scale.set(size.x * 1.03, size.y * 1.03, size.z * 1.03);
        highlightMesh.position.copy(center);
        highlightMesh.visible = true;

        areaGlowMesh.scale.set(size.x * 1.02, size.y * 1.02, size.z * 1.02);
        areaGlowMesh.position.copy(center);
        areaGlowMesh.visible = true;

        hoverLight.intensity = 4;
        hoverLight.position.copy(center);
      } else if (!hit) {
        clearHover();
      }
    } else {
      clearHover();
    }
  }

  function clearHover() {
    hoveredObject = null;
    if (renderer) renderer.domElement.style.cursor = 'default';
    if (highlightMesh) highlightMesh.visible = false;
    if (areaGlowMesh) areaGlowMesh.visible = false;
    if (hoverLight) hoverLight.intensity = 0;
  }

  let dragStart = null;

  function onPointerStart(e) {
    dragStart = { x: e.clientX, y: e.clientY };
  }

  function onPointerEnd(e) {
    if (!dragStart) return;
    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);
    dragStart = null;
    if (dx > 5 || dy > 5) return;   // fue un giro de cámara, no un clic
    onPointerDown(e);
  }

  function onPointerDown(e) {
    if (!hoveredObject) return;

    const type = hoveredObject.userData.type;
    const data = hoveredObject.userData.data;

    if (type === 'box') inspectSingleBox(data);
    else if (type === 'pzone') zoomToPendientes();
    else if (type === 'pbox') { if (!enPendientes) zoomToPendientes(); abrirPanelPend(data.etiqueta); enfocarPendiente(data.etiqueta); }
    else if (currentLevel === 0 && type === 'rack') zoomToRack(data);
    else if (currentLevel === 0 && type === 'tarima') zoomToSlotAndSpreadBoxes(data.slot);
    else if (currentLevel === 1 && type === 'slot') zoomToSlotAndSpreadBoxes(data);
  }

  /* =====================
     CÁMARA Y NAVEGACIÓN
  ===================== */
  function animateCamera(targetPos, lookAtPos, duration, onComplete) {
    duration = duration || 1.0;
    gsap.to(camera.position, { x: targetPos.x, y: targetPos.y, z: targetPos.z, duration, ease: "power2.inOut" });
    gsap.to(controls.target, {
      x: lookAtPos.x, y: lookAtPos.y, z: lookAtPos.z, duration, ease: "power2.inOut",
      onUpdate: () => controls.update(), onComplete
    });
  }

  function hud(t, s, p) {
    const a = document.getElementById('r3d-title');
    const b = document.getElementById('r3d-sub');
    const c = document.getElementById('r3d-path');
    if (a) a.innerText = t;
    if (b) b.innerText = s;
    if (c) c.innerText = p;
  }

  function pushState() {
    navStack.push({
      level: currentLevel,
      camPos: camera.position.clone(),
      target: controls.target.clone(),
      hudTitle: document.getElementById('r3d-title').innerText,
      hudSub: document.getElementById('r3d-sub').innerText,
      hudPath: document.getElementById('r3d-path').innerText,
      slotRef: activeSlot,
      boxRef: inspectedBox
    });
    const b = document.getElementById('r3d-back');
    if (b) b.disabled = false;
  }

  function zoomToRack(rack, push) {
    if (push !== false) pushState();
    currentLevel = 1;
    enPendientes = false;
    cerrarPanelPend();
    clearHover();

    const camDist = Math.max(4.1, rack.slots * 1.1);
    const camY = Math.max(1.4, (rack.niveles * NIVEL_H) / 2);

    animateCamera(new THREE.Vector3(rack.position.x, camY, camDist), new THREE.Vector3(rack.position.x, camY, 0));

    hud(`Rack ${rack.rackIndex}`, "Viendo los niveles completos. Selecciona un slot.", `RACK ${rack.rackIndex}`);
    vistaGuardada = { level: 1, rack: rack.rackIndex };
  }

  function zoomToPendientes() {
    if (!pendZona) return;
    pushState();
    currentLevel = 1;
    enPendientes = true;
    clearHover();

    animateCamera(
      new THREE.Vector3(pendZona.cx + 0.5, 1.5, pendZona.zCentro + 3.1),
      new THREE.Vector3(pendZona.cx, 0.35, pendZona.zCentro)
    );

    hud("Pendientes de acomodar",
      "Material de migración. Para acomodar una caja, abre la rejilla (slot) del rack donde va y escribe su número.",
      "PENDIENTES");
    vistaGuardada = { level: 'pend' };
    abrirPanelPend();
  }

  /* ---------- panel con la lista de pendientes ---------- */
  function cerrarPanelPend() {
    pendPanel.abierto = false;
    if (overlay) overlay.querySelectorAll('.pend-panel').forEach(e => e.remove());
  }

  function cerrarModalPend() {
    pendModal = null;
    if (overlay) overlay.querySelectorAll('.pend-modal').forEach(e => e.remove());
  }

  function abrirPanelPend(filtro) {
    if (!overlay) return;
    pendPanel.abierto = true;
    if (filtro !== undefined) pendPanel.filtro = String(filtro || "");

    overlay.querySelectorAll('.pend-panel').forEach(e => e.remove());

    const p = document.createElement('div');
    p.className = 'pend-panel';
    p.innerHTML = `
      <div class="pend-head">
        <b>📦 Pendientes de acomodar</b>
        <span class="pend-count" id="pend-count">${pendBoxes.length}</span>
        <button class="pend-x" onclick="Rack3D.cerrarPanelPend()" title="Cerrar">✕</button>
      </div>
      <div class="pend-hint">Para acomodar una caja: entra al rack, abre la rejilla (slot) donde va y escribe aquí su número.</div>
      <input type="text" id="pend-filter" class="pend-filter" placeholder="Filtrar por caja o material..." autocomplete="off"
        value="${esc(pendPanel.filtro)}" oninput="Rack3D.filtrarPend(this.value)">
      <div class="pend-list" id="pend-rows"></div>`;
    overlay.appendChild(p);
    pintarFilasPend();
  }

  function pintarFilasPend() {
    const cont = document.getElementById('pend-rows');
    if (!cont) return;
    const q = String(pendPanel.filtro || "").toLowerCase().trim();

    const lista = pendBoxes.filter(b => !q ||
      String(b.etiqueta).toLowerCase().includes(q) ||
      b.items.some(i => String(i.name || "").toLowerCase().includes(q) || String(i.pn || "").toLowerCase().includes(q)));

    if (lista.length === 0) {
      cont.innerHTML = '<div class="pend-empty">' + (pendBoxes.length ? 'Sin coincidencias' : 'No quedan cajas pendientes 🎉') + '</div>';
      return;
    }

    cont.innerHTML = lista.map(b => {
      const total = b.items.reduce((t, i) => t + i.qty, 0);
      const mats = b.items.slice(0, 5).map(i => `${esc(i.name)} ×${i.qty}`).join(' · ')
        + (b.items.length > 5 ? ` · +${b.items.length - 5} más` : '');
      return `
        <div class="pend-row" onclick="Rack3D.enfocarPendiente('${escJs(b.etiqueta)}')">
          <div class="pend-row-top"><b>CAJA ${esc(b.etiqueta)}</b><span>${total} pzs</span></div>
          <div class="pend-mat">${mats || '<i>Vacía</i>'}</div>
        </div>`;
    }).join('');
  }

  function filtrarPend(v) {
    pendPanel.filtro = String(v || "");
    pintarFilasPend();
  }

  /* destello de una caja pendiente en el área */
  function enfocarPendiente(etiqueta) {
    const b = pendBoxes.find(x => x.etiqueta === etiqueta);
    if (!b) return;
    const searchInput = document.getElementById('r3d-search');
    if (searchInput && searchInput.value.trim()) return;   // no pelear con la búsqueda activa
    let n = 0;
    const t = setInterval(() => {
      n++;
      const on = n % 2 === 1;
      b.glowMesh.visible = on;
      b.glowMesh.material.opacity = on ? 0.9 : 0;
      b.glowLight.intensity = on ? 6 : 0;
      if (n >= 7) { clearInterval(t); b.glowMesh.visible = false; b.glowLight.intensity = 0; }
    }, 300);
  }

  /* ---------- acomodar una caja pendiente en el slot abierto ---------- */
  function asignarHtml() {
    if (!pendBoxes.length) return '';
    const opts = pendBoxes.map(b => `<option value="${esc(b.etiqueta)}"></option>`).join('');
    return `
      <div class="pend-assign">
        <input type="text" id="pend-num" class="pend-num" list="pend-datalist" placeholder="Nº de caja pendiente" autocomplete="off"
          onkeydown="if(event.key==='Enter'){Rack3D.buscarPendiente();}">
        <datalist id="pend-datalist">${opts}</datalist>
        <button class="btn-mini btn-pend" onclick="Rack3D.buscarPendiente()" title="Buscar la caja pendiente y acomodarla en este slot">📥 Acomodar caja aquí</button>
      </div>`;
  }

  function buscarPendiente() {
    if (!activeSlot) return;
    if (typeof window.consultarCajaMigracion !== "function") { alert("Sistema no disponible"); return; }

    const inp = document.getElementById('pend-num');
    const valor = (inp && inp.value || "").trim();
    if (!valor) { alert("Escribe el número de la caja"); return; }

    const r = window.consultarCajaMigracion(valor);

    if (r.estado === "pendiente") { abrirModalPend(r, activeSlot); return; }

    const msgs = {
      noexiste: `No existe ninguna caja con el número ${r.numero}.`,
      acomodada: `La caja ${r.numero} ya fue acomodada (está en ${r.ubicacion}).`,
      nueva: `La caja ${r.numero} es material nuevo (no es de migración): ya está registrada en ${r.ubicacion}.`
    };
    alert(msgs[r.estado] || "Número de caja inválido");
  }

  function abrirModalPend(info, slot) {
    pendModal = { ubicacionActual: info.ubicacionActual, caja: info.caja, slotId: slot.id };
    pintarModalPend(info, slot);
  }

  function pintarModalPend(info, slot) {
    overlay.querySelectorAll('.pend-modal').forEach(e => e.remove());

    const filas = info.componentes.map(x => `
      <div class="pend-crow">
        <span class="pend-cname" title="${esc(x.nombre)}">${esc(x.nombre)}${(x.pn && x.pn !== 'NO APLICA') ? ` <small>· ${esc(x.pn)}</small>` : ''}</span>
        <b>${x.cantidad} pzs</b>
      </div>`).join('');

    const m = document.createElement('div');
    m.className = 'pend-modal';
    m.innerHTML = `
      <div class="pend-dialog">
        <div class="pend-dialog-title">Confirmar acomodo de caja</div>
        <div class="pend-dest">
          CAJA <b>${esc(info.caja)}</b> &nbsp;→&nbsp; <b>${esc(slot.id)}</b>
          <small>${slot.tarima ? esc(slot.tarimaLabel) : 'Rack ' + esc(slot.rackIndex) + ' · Nivel ' + pad2(slot.level) + ' · Slot ' + pad2(slot.slotIndex)}</small>
        </div>
        <div class="pend-contents-title">Contenido registrado de esta caja</div>
        <div class="pend-contents">${filas || '<span class="pend-vacia">Caja vacía (sin material registrado)</span>'}</div>
        <div class="pend-total">${info.total} pzs en total · ${info.componentes.length} ${info.componentes.length === 1 ? 'material' : 'materiales'}</div>
        <p class="pend-ask">¿Es esta la caja que está físicamente en esta posición?</p>
        <div class="pend-actions">
          <button class="btn-mini" onclick="Rack3D.cancelarPendiente()">Cancelar</button>
          <button class="btn-mini btn-pend-ok" id="pend-ok" onclick="Rack3D.confirmarPendiente()">✔ Confirmar y guardar</button>
        </div>
      </div>`;
    overlay.appendChild(m);
  }

  function cancelarPendiente() { cerrarModalPend(); }

  async function confirmarPendiente() {
    if (!pendModal || pendConfirmando) return;
    const st = pendModal;
    const slot = activeSlot;
    if (!slot || slot.id !== st.slotId) { cerrarModalPend(); return; }
    if (typeof window.acomodarCajaMigrada !== "function") { alert("Sistema no disponible"); return; }

    const btn = document.getElementById('pend-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    pendConfirmando = true;
    vistaGuardada = { level: 2, slot: slot.id };   // al guardar, el visor se queda en este slot
    let ok = false;
    try {
      ok = await window.acomodarCajaMigrada(st.ubicacionActual, slot.rackIndex, slot.level, slot.slotIndex);
    } finally {
      pendConfirmando = false;
    }

    if (ok) {
      cerrarModalPend();
    } else {
      const b2 = document.getElementById('pend-ok');
      if (b2) { b2.disabled = false; b2.textContent = '✔ Confirmar y guardar'; }
    }
  }

  function zoomToSlotAndSpreadBoxes(slot, push) {
    if (push !== false) pushState();
    currentLevel = 2;
    activeSlot = slot;
    enPendientes = false;
    cerrarPanelPend();
    clearHover();

    backdropPlane.position.set(slot.position.x, slot.position.y + 0.1, 0.5);
    gsap.to(backdropMat, { opacity: 0.95, duration: 0.5 });

    renderSlotBoxes();

    if (slot.tarima) {
      hud(slot.tarimaLabel.charAt(0) + slot.tarimaLabel.slice(1).toLowerCase(), "Gestión de cajas e inventario en tiempo real.", slot.tarimaLabel);
    } else {
      hud(`Slot ${slot.id}`, "Gestión de cajas e inventario en tiempo real.",
        `RACK ${slot.rackIndex} > NIVEL ${pad2(slot.level)} > SLOT ${pad2(slot.slotIndex)}`);
    }

    vistaGuardada = { level: 2, slot: slot.id };
  }

  function inspectSingleBox(box, push) {
    if (push !== false) pushState();
    currentLevel = 3;
    inspectedBox = box;
    clearHover();
    quitarGaleria();

    // posición donde se inspecciona la caja
    const centro = box.mesh.position.clone();

    if (activeSlot && box.parentSlot === activeSlot) {
      // viene de la galería del slot: la caja se pone de frente y las demás se ocultan
      centro.set(activeSlot.position.x, activeSlot.position.y + 0.1, 0.95);
      gsap.killTweensOf(box.fly);
      gsap.killTweensOf(box.mesh.position);
      gsap.to(box.mesh.position, { x: centro.x, y: centro.y, z: centro.z, duration: 0.4, ease: "power2.out" });
      gsap.to(box.mesh.scale, {
        x: 1 / (box.visualEscala || 1), y: 1 / (box.visualEscala || 1), z: 1 / (box.visualEscala || 1),
        duration: 0.4
      });
      activeSlot.boxes.forEach(b => { if (b !== box) b.mesh.visible = false; });
    }

    backdropPlane.position.set(centro.x, centro.y, centro.z - 0.2);
    gsap.to(backdropMat, { opacity: 0.88, duration: 0.5 });

    gsap.to(box.mesh.rotation, { y: 0, x: 0, z: 0, duration: 0.4, ease: "power2.out" });

    animateCamera(
      new THREE.Vector3(centro.x, centro.y, centro.z + 0.85),
      new THREE.Vector3(centro.x, centro.y, centro.z),
      0.8
    );

    overlay.querySelectorAll('.box-summary-card, .slot-empty-card').forEach(c => c.remove());
    cerrarModalPend();

    const card = document.createElement('div');
    card.className = 'box-summary-card';
    card.innerHTML = cardHtml(box);
    overlay.appendChild(card);
    box.cardElem = card;

    setTimeout(() => card.classList.add('active'), 100);

    hud(`Caja ${box.etiqueta}`, `Ubicación: ${box.id}. Inspeccionando contenido.`, `INSPECCIÓN > ${box.id}`);
    vistaGuardada = { level: 3, box: box.id, slot: box.slotCode };
  }

  /* =====================
     TARJETAS HTML (conectadas a Firestore)
  ===================== */
  const catOptions = (selected) =>
    `<option value="" ${!selected ? 'selected' : ''}>Sin categoría</option>` +
    (window.CATEGORIAS_MATERIAL || []).map(c =>
      `<option value="${esc(c)}" ${selected === c ? 'selected' : ''}>${esc(c)}</option>`
    ).join('');

  function cardHtml(box) {
    const itemsHtml = box.items.map((item, idx) => `
      <div class="box-item-row">
        <div class="item-row-top">
          <span title="${esc(item.pn && item.pn !== 'NO APLICA' ? item.name + ' · ' + item.pn : item.name)}">${esc(item.name)}</span>
          <div class="sub-controls">
            <span class="qty">${item.qty} pcs</span>
            <input type="number" id="sub-qty-${esc(box.id)}-${idx}" class="sub-input" value="1" min="1" max="${item.qty}">
            <button class="btn-sub" onclick="Rack3D.salida('${escJs(box.id)}','${escJs(item.name)}',${idx})" title="Registrar salida">-</button>
          </div>
        </div>
        <select class="cat-select" onchange="Rack3D.cambiarCategoriaItem('${escJs(box.id)}','${escJs(item.name)}', this.value)" title="Categoría del material">
          ${catOptions(item.categoria || '')}
        </select>
      </div>`).join('');

    const btnDel = esAdmin()
      ? `<button class="btn-del-caja" onclick="Rack3D.eliminarCaja('${escJs(box.id)}')" title="Eliminar caja">🗑</button>`
      : "";

    const opt = (k, txt) =>
      `<option value="${k}" ${box.estado === k ? 'selected' : ''}>${txt}</option>`;

    const optT = (k, txt) =>
      `<option value="${k}" ${box.tamano === k ? 'selected' : ''}>${txt}</option>`;

    return `
      <div class="box-card-header">
        <span class="num-caja">Caja ${esc(box.etiqueta)}</span>
        <span class="tag">${esc(box.slotCode)}</span>
      </div>
      <div class="estado-row">
        <span class="estado-dot" style="background:${ESTADOS[box.estado].color}"></span>
        <select class="estado-select" onchange="Rack3D.cambiarEstado('${escJs(box.id)}', this.value)" title="Status de la caja">
          ${opt('vacia', 'Caja vacía')}
          ${opt('bajo', 'Caja con poco contenido')}
          ${opt('medio', 'Contenido medio')}
          ${opt('lleno', 'Caja llena')}
        </select>
      </div>
      <div class="tamano-row">
        <span class="tamano-label">Tamaño de caja</span>
        <select class="estado-select tamano-select" onchange="Rack3D.cambiarTamano('${escJs(box.id)}', this.value)" title="Tamaño físico de la caja">
          ${optT('chica', 'Chica')}
          ${optT('mediana', 'Mediana')}
          ${optT('grande', 'Grande')}
        </select>
      </div>
      <div class="box-item-list">
        ${itemsHtml || '<span style="color:#94a3b8;">Vacía</span>'}
      </div>
      <div class="add-product-form">
        <div class="mat-input-wrap">
          <input type="text" id="input-name-${esc(box.id)}" placeholder="Componente..." autocomplete="off"
            oninput="Rack3D.buscarMaterial('${escJs(box.id)}')"
            onblur="setTimeout(()=>Rack3D.cerrarSugerencias('${escJs(box.id)}'),150)">
          <div class="mat-suggest" id="mat-suggest-${esc(box.id)}"></div>
        </div>
        <input type="text" id="input-pn-${esc(box.id)}" placeholder="PN" style="width:50px;">
        <input type="number" id="input-qty-${esc(box.id)}" placeholder="Cant" value="1" min="1" style="width:44px;">
        <button class="btn-add" onclick="Rack3D.entrada('${escJs(box.id)}')" title="Registrar entrada">+</button>
      </div>
      <div class="tamano-row add-cat-row">
        <span class="tamano-label">Categoría</span>
        <select id="input-cat-${esc(box.id)}" class="estado-select cat-select-new" title="Categoría del material (opcional)">
          ${catOptions('')}
        </select>
      </div>
      <div class="card-foot">
        <button class="btn-mini" onclick="Rack3D.abrirEntrada('${escJs(box.id)}')">Formulario entrada</button>
        ${btnDel}
      </div>`;
  }

  /* =====================
     GALERÍA DEL SLOT (nivel 2)
     Las cajas se reparten en una rejilla de pantalla: cada celda tiene su
     caja 3D girando y, debajo, su tarjeta con el contenido. Si hay muchas
     cajas la galería se desplaza con la rueda del mouse; el número de
     columnas se ajusta solo al ancho disponible.
  ===================== */
  const GALERIA_PROFUNDIDAD = 1.3;   // distancia de la cámara al plano donde flotan las cajas
  const GALERIA_BARRA_INF = 64;      // franja inferior (leyenda + botón nueva caja)
  let scrollGaleria = { slot: null, top: 0 };
  let galeriaRefDim = 0.22;          // lado de la caja más grande del slot (define el tamaño en pantalla)
  const _dir = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _cel = new THREE.Vector3();

  function quitarGaleria() {
    if (overlay) overlay.querySelectorAll('.slot-gallery').forEach(g => g.remove());
    if (canvasHost) canvasHost.style.clipPath = '';
    if (container) container.classList.remove('r3d-gallery-mode');
    allBoxes.forEach(b => { b.stageElem = null; });
  }

  /* zona (en px dentro del visor) donde vive la galería: debajo de la barra superior */
  function zonaGaleria() {
    const host = container.getBoundingClientRect();
    const tb = container.querySelector('.r3d-topbar');
    const top = tb ? Math.ceil(tb.getBoundingClientRect().bottom - host.top) + 6 : 90;
    return { top, bottom: GALERIA_BARRA_INF };
  }

  function ajustarZonaGaleria() {
    const gal = overlay && overlay.querySelector('.slot-gallery');
    if (!gal) return;
    const zona = zonaGaleria();
    gal.style.top = zona.top + 'px';
    gal.style.bottom = zona.bottom + 'px';
    canvasHost.style.clipPath = `inset(${zona.top}px 0 ${zona.bottom}px 0)`;
  }

  function renderSlotBoxes() {
    if (!activeSlot) return;

    const slot = activeSlot;
    quitarGaleria();
    overlay.querySelectorAll('.box-summary-card, .slot-empty-card, .slot-tools').forEach(c => c.remove());

    const count = slot.boxes.length;

    // la cámara queda de frente al slot; las cajas se colocan por pantalla, no por el mundo
    animateCamera(
      new THREE.Vector3(slot.position.x, slot.position.y + 0.1, 2.1),
      new THREE.Vector3(slot.position.x, slot.position.y + 0.1, 0.95),
      1.0
    );

    if (count === 0) {
      const empty = document.createElement('div');
      empty.className = 'box-summary-card slot-empty-card active';
      empty.style.left = "50%";
      empty.style.top = "50%";
      empty.style.transform = "translate(-50%,-50%)";
      empty.innerHTML = `
        <div class="box-card-header"><span class="num-caja">Slot ${esc(slot.id)}</span></div>
        <div class="box-item-list"><span style="color:#64748b;">Sin cajas en este slot</span></div>
        <div class="card-foot">
          <button class="btn-mini" onclick="Rack3D.crearCaja('${escJs(slot.rackIndex)}',${slot.level},${slot.slotIndex})">+ Crear caja aquí</button>
        </div>
        ${asignarHtml()}`;
      overlay.appendChild(empty);
      return;
    }

    // la caja más grande del slot ocupa su celda; las demás se ven proporcionales a ella
    galeriaRefDim = Math.max(...slot.boxes.map(b => (TAMANOS[b.tamano] || TAMANOS.mediana).dims.w));

    // tamaño de la caja 3D según cuántas hay (menos cajas = más grandes, para que siempre se vea bien)
    const stageH = count <= 3 ? 210 : (count <= 8 ? 180 : (count <= 16 ? 155 : 130));

    const zona = zonaGaleria();
    const gal = document.createElement('div');
    gal.className = 'slot-gallery';
    gal.dataset.slot = slot.id;
    gal.style.top = zona.top + 'px';
    gal.style.bottom = zona.bottom + 'px';
    gal.style.setProperty('--stage-h', stageH + 'px');

    const grid = document.createElement('div');
    grid.className = 'slot-grid';
    gal.appendChild(grid);

    slot.boxes.forEach((box, i) => {
      const cell = document.createElement('div');
      cell.className = 'slot-cell';

      const stage = document.createElement('div');
      stage.className = 'cell-stage';

      const card = document.createElement('div');
      card.className = 'box-summary-card in-grid';
      card.innerHTML = cardHtml(box);

      cell.appendChild(stage);
      cell.appendChild(card);
      grid.appendChild(cell);

      box.stageElem = stage;
      box.cardElem = card;

      // la caja sale de la repisa hacia su celda
      gsap.killTweensOf(box.fly);
      gsap.killTweensOf(box.mesh.rotation);
      box.mesh.visible = true;
      box.mesh.renderOrder = 10;
      box.mesh.rotation.set(0.28, (i * 0.9) % (Math.PI * 2), 0);   // inclinada para verse la tapa
      box.fly.t = 0;
      gsap.to(box.fly, { t: 1, duration: 0.9, delay: Math.min(i * 0.03, 0.6), ease: "power2.out" });

      setTimeout(() => card.classList.add('active'), 250 + Math.min(i * 20, 500));
    });

    gal.addEventListener('scroll', () => { scrollGaleria = { slot: slot.id, top: gal.scrollTop }; });

    overlay.appendChild(gal);
    if (scrollGaleria.slot === slot.id) gal.scrollTop = scrollGaleria.top;   // no perder el lugar al guardar
    else scrollGaleria = { slot: slot.id, top: 0 };

    // solo se ve el 3D dentro de la zona de la galería
    canvasHost.style.clipPath = `inset(${zona.top}px 0 ${zona.bottom}px 0)`;
    container.classList.add('r3d-gallery-mode');

    // botón para agregar otra caja al slot
    const addCard = document.createElement('div');
    addCard.className = 'slot-tools active';
    addCard.innerHTML = `<button class="btn-mini" onclick="Rack3D.crearCaja('${escJs(slot.rackIndex)}',${slot.level},${slot.slotIndex})">+ Nueva caja en ${esc(slot.id)}</button>${asignarHtml()}`;
    overlay.appendChild(addCard);
  }

  /* Cada cuadro: la caja 3D sigue a su celda del DOM (aunque se desplace la galería) */
  function posicionarCajasEnGaleria() {
    if (currentLevel !== 2 || !activeSlot) return;
    const gal = overlay.querySelector('.slot-gallery');
    if (!gal) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    camera.getWorldDirection(_fwd);
    const unidadesPorPx =
      (2 * GALERIA_PROFUNDIDAD * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / rect.height;

    activeSlot.boxes.forEach(box => {
      const st = box.stageElem;
      if (!st || !st.isConnected) return;

      const sr = st.getBoundingClientRect();
      const nx = ((sr.left + sr.width / 2 - rect.left) / rect.width) * 2 - 1;
      const ny = -((sr.top + sr.height / 2 - rect.top) / rect.height) * 2 + 1;

      // punto de la celda, a profundidad constante frente a la cámara
      _dir.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
      const dist = GALERIA_PROFUNDIDAD / Math.max(0.2, _dir.dot(_fwd));
      _cel.copy(camera.position).addScaledVector(_dir, dist);

      // tamaño en pantalla: el mismo factor para todas, así chica/mediana/grande se distinguen
      const refPx = Math.min(sr.width, sr.height) * 0.9;
      const escalaGaleria = (refPx * unidadesPorPx) / (0.36 * galeriaRefDim / 0.22) / (box.visualEscala || 1);

      const e = box.fly.t;
      box.mesh.position.lerpVectors(box.homePos, _cel, e);
      box.mesh.scale.setScalar(1 + (escalaGaleria - 1) * e);
    });
  }

  /* =====================
     AUTOCOMPLETADO DE MATERIALES (mientras escribo en una caja)
  ===================== */
  function buscarMaterial(ubicacion) {
    const input = document.getElementById(`input-name-${ubicacion}`);
    const cont = document.getElementById(`mat-suggest-${ubicacion}`);
    if (!input || !cont) return;

    const q = input.value.trim().toLowerCase();
    cont.innerHTML = "";

    if (!q || typeof window.getMaterialesCatalogo !== "function") {
      cont.style.display = "none";
      return;
    }

    const catalogo = window.getMaterialesCatalogo();
    const matches = catalogo.filter(m =>
      m.nombre.toLowerCase().includes(q) ||
      (m.pn && m.pn !== "NO APLICA" && m.pn.toLowerCase().includes(q))
    ).slice(0, 6);

    if (!matches.length) {
      cont.style.display = "none";
      return;
    }

    cont.style.display = "block";
    matches.forEach(m => {
      const item = document.createElement("div");
      item.className = "mat-suggest-item";
      item.innerHTML = `<span>${esc(m.nombre)}</span>` +
        (m.pn && m.pn !== "NO APLICA" ? `<small>${esc(m.pn)}</small>` : "<small>Sin PN</small>");
      item.onmousedown = (e) => e.preventDefault(); // evita perder el foco antes del click
      item.onclick = () => {
        const nameInput = document.getElementById(`input-name-${ubicacion}`);
        const pnInput = document.getElementById(`input-pn-${ubicacion}`);
        if (nameInput) nameInput.value = m.nombre;
        if (pnInput) pnInput.value = (m.pn && m.pn !== "NO APLICA") ? m.pn : "";
        cont.innerHTML = "";
        cont.style.display = "none";
        const qtyInput = document.getElementById(`input-qty-${ubicacion}`);
        if (qtyInput) qtyInput.focus();
      };
      cont.appendChild(item);
    });
  }

  function cerrarSugerencias(ubicacion) {
    const cont = document.getElementById(`mat-suggest-${ubicacion}`);
    if (cont) { cont.innerHTML = ""; cont.style.display = "none"; }
  }

  /* =====================
     ACCIONES → FIRESTORE
  ===================== */
  async function entrada(ubicacion) {
    const nameInput = document.getElementById(`input-name-${ubicacion}`);
    const pnInput = document.getElementById(`input-pn-${ubicacion}`);
    const qtyInput = document.getElementById(`input-qty-${ubicacion}`);
    const catInput = document.getElementById(`input-cat-${ubicacion}`);
    if (!nameInput) return;

    const nombre = nameInput.value.trim();
    const pn = (pnInput?.value || "").trim() || "NO APLICA";
    const cantidad = parseInt(qtyInput.value) || 0;
    const categoria = catInput?.value || "";

    if (!nombre) { alert("Escribe el nombre del componente"); return; }
    if (cantidad <= 0) { alert("Cantidad inválida"); return; }

    if (typeof window.entradaRapida !== "function") { alert("Sistema no disponible"); return; }

    const ok = await window.entradaRapida(ubicacion, nombre, pn, cantidad, "Registrado desde vista 3D", categoria, 0);
    if (ok) await window.renderRacksPage();
  }

  async function salida(ubicacion, nombre, idx) {
    const subInput = document.getElementById(`sub-qty-${ubicacion}-${idx}`);
    const cantidad = parseInt(subInput?.value) || 1;

    if (typeof window.salidaRapida !== "function") { alert("Sistema no disponible"); return; }

    const ok = await window.salidaRapida(ubicacion, nombre, cantidad, "Salida desde vista 3D");
    if (ok) await window.renderRacksPage();
  }

  /* Cambiar la categoría de un material ya registrado, directamente desde
     el selector que aparece junto a cada componente en la caja abierta
     dentro del visor 3D (indirecto, en SAP, validación de Scrap, etc.). */
  async function cambiarCategoriaItem(ubicacion, nombre, categoria) {
    if (typeof window.setCategoriaMaterial !== "function") { alert("Sistema no disponible"); return; }
    const ok = await window.setCategoriaMaterial(ubicacion, nombre, categoria || "");
    if (ok) await window.renderRacksPage();
  }

  async function cambiarEstado(ubicacion, estado) {    if (typeof window.setEstadoCaja !== "function") return;
    const ok = await window.setEstadoCaja(ubicacion, estado);
    if (ok) await window.renderRacksPage();
  }

  async function cambiarTamano(ubicacion, tamano) {
    if (typeof window.setTamanoCaja !== "function") return;
    const ok = await window.setTamanoCaja(ubicacion, tamano);
    if (ok) await window.renderRacksPage();
  }

  async function crearCaja(rack, nivel, slot) {
    if (typeof window.crearCajaEnSlot !== "function") return;
    await window.crearCajaEnSlot(rack, nivel, slot);
  }

  async function eliminarCajaProxy(ubicacion) {
    if (typeof window.eliminarCaja !== "function") return;
    vistaGuardada = activeSlot ? { level: 2, slot: activeSlot.id } : null;
    await window.eliminarCaja(ubicacion);
  }

  function abrirEntrada(ubicacion) {
    if (typeof window.irAEntrada === "function") window.irAEntrada(ubicacion);
  }

  /* =====================
     BUSCADOR
  ===================== */
  function clearSearch() {
    const searchInput = document.getElementById('r3d-search');
    const btnClear = document.getElementById('r3d-clear');
    const sug = document.getElementById('r3d-suggestions');
    if (searchInput) searchInput.value = '';
    if (btnClear) btnClear.style.display = 'none';
    if (sug) sug.style.display = 'none';
    stopBlinkingAndResetBoxes();
  }

  function updateSuggestionsList() {
    const searchInput = document.getElementById('r3d-search');
    const btnClear = document.getElementById('r3d-clear');
    const suggestionsBox = document.getElementById('r3d-suggestions');
    if (!searchInput) return;

    const query = searchInput.value.toLowerCase().trim();
    suggestionsBox.innerHTML = '';

    if (query.length > 0) {
      btnClear.style.display = 'block';
    } else {
      btnClear.style.display = 'none';
      suggestionsBox.style.display = 'none';
      stopBlinkingAndResetBoxes();
      return;
    }

    const encontrados = new Set();
    allBoxes.forEach(b => {
      b.items.forEach(i => {
        const n = String(i.name || "");
        const p = String(i.pn || "");
        if (n.toLowerCase().includes(query) || p.toLowerCase().includes(query)) encontrados.add(n);
      });
      const idTxt = b.pendiente ? b.etiqueta : b.id;
      if (String(idTxt).toLowerCase().includes(query)) encontrados.add(idTxt);
    });

    if (encontrados.size > 0) {
      suggestionsBox.style.display = 'block';
      encontrados.forEach(prod => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'suggestion-item';
        const boxCount = allBoxes.filter(b =>
          b.items.some(i => i.name === prod) || b.id === prod || (b.pendiente && b.etiqueta === prod)).length;
        itemDiv.innerHTML = `<span>${esc(prod)}</span> <small style="color:#38bdf8">${boxCount} caja(s)</small>`;
        itemDiv.onclick = () => {
          searchInput.value = prod;
          suggestionsBox.style.display = 'none';
          triggerSearch();
        };
        suggestionsBox.appendChild(itemDiv);
      });
    } else {
      suggestionsBox.style.display = 'none';
    }

    triggerSearch();
  }

  function triggerSearch() {
    const searchInput = document.getElementById('r3d-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
    if (!query) { stopBlinkingAndResetBoxes(); return; }
    if (currentLevel !== 0) resetToGlobal(true);
    startBlinkingAndPullFront(query);
  }

  function coincide(box, query) {
    const idTxt = box.pendiente ? box.etiqueta : box.id;   // la ubicación provisional de una caja pendiente no cuenta
    if (String(idTxt).toLowerCase().includes(query)) return true;
    return box.items.some(i =>
      String(i.name || "").toLowerCase().includes(query) ||
      String(i.pn || "").toLowerCase().includes(query) ||
      String(i.categoria || "").toLowerCase().includes(query));
  }

  function startBlinkingAndPullFront(query) {
    stopBlinkingAndResetBoxes();
    const matchesBySlot = {};

    allBoxes.forEach(box => {
      if (coincide(box, query)) {
        (matchesBySlot[box.slotCode] = matchesBySlot[box.slotCode] || []).push(box);
      }
    });

    Object.keys(matchesBySlot).forEach(slotCode => {
      const matching = matchesBySlot[slotCode];
      const count = matching.length;

      matching.forEach((box, index) => {
        const xOffset = (index - (count - 1) / 2) * 0.32;
        const frontPos = box.homePos.clone().add(new THREE.Vector3(xOffset, 0, 0.75));

        gsap.to(box.mesh.position, { x: frontPos.x, y: frontPos.y, z: frontPos.z, duration: 0.6, ease: "power2.out" });

        box.glowMesh.position.copy(frontPos);
        box.glowMesh.visible = true;

        box.dashLine.geometry.setFromPoints([box.homePos.clone(), frontPos.clone()]);
        box.dashLine.geometry.computeBoundingSphere();
        box.dashLine.computeLineDistances();
        box.dashLine.visible = true;

        box.originTag.style.display = 'block';
      });
    });

    blinkInterval = setInterval(() => {
      blinkState = !blinkState;
      allBoxes.forEach(box => {
        if (coincide(box, query)) {
          box.glowLight.intensity = blinkState ? 6 : 0;
          box.glowLight.position.copy(box.mesh.position);
          box.glowMesh.position.copy(box.mesh.position);
          box.glowMesh.material.opacity = blinkState ? 0.8 : 0.1;
        } else {
          box.glowLight.intensity = 0;
          box.glowMesh.visible = false;
        }
      });
    }, 400);
  }

  function stopBlink() {
    if (blinkInterval) clearInterval(blinkInterval);
    blinkInterval = null;
  }

  function stopBlinkingAndResetBoxes() {
    stopBlink();

    allBoxes.forEach(box => {
      if (box.glowLight) box.glowLight.intensity = 0;
      if (box.glowMesh) { box.glowMesh.visible = false; box.glowMesh.material.opacity = 0; }
      if (box.dashLine) box.dashLine.visible = false;
      if (box.originTag) box.originTag.style.display = 'none';

      if (currentLevel !== 2 && currentLevel !== 3) {
        box.mesh.visible = true;
        box.mesh.renderOrder = 0;
        gsap.killTweensOf(box.mesh.rotation);
        gsap.killTweensOf(box.mesh.position);
        gsap.killTweensOf(box.mesh.scale);
        gsap.to(box.mesh.position, { x: box.homePos.x, y: box.homePos.y, z: box.homePos.z, duration: 0.5, ease: "power2.out" });
        gsap.to(box.mesh.rotation, { x: 0, y: 0, z: 0, duration: 0.5 });
        gsap.to(box.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.5 });
      }
    });
  }

  /* =====================
     OVERLAY (proyección)
  ===================== */
  function updateFloatingOverlay() {
    const searchInput = document.getElementById('r3d-search');
    const isSearching = searchInput ? searchInput.value.trim().length > 0 : false;
    const isCardActive = currentLevel === 2 || currentLevel === 3;
    if (!isSearching && !isCardActive) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const w = rect.width, h = rect.height;

    allBoxes.forEach(box => {
      if (isSearching && box.dashLine && box.dashLine.visible) {
        tempV.copy(box.mesh.position).project(camera);
        const x = (tempV.x * .5 + .5) * w;
        const y = (tempV.y * -.5 + .5) * h;
        box.originTag.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }

      if (isCardActive && box.cardElem && box.cardElem.isConnected && !box.stageElem) {
        tempV.copy(box.mesh.position).project(camera);
        const x = (tempV.x * .5 + .5) * w;
        const y = (tempV.y * -.5 + .5) * h;
        // La tarjeta de contenido queda un poco arriba de la caja/letrero,
        // nunca encima, para que se vea la caja girando debajo del texto.
        const altoCard = box.cardElem.offsetHeight || 0;
        const yy = (currentLevel === 3) ? Math.max(y, altoCard + 34 + 8) : y;   // no cortar la tarjeta por arriba
        box.cardElem.style.transform = `translate3d(${x}px, ${yy}px, 0) translate(-50%, calc(-100% - 34px))`;
      }
    });
  }

  /* =====================
     BACK / RESET
  ===================== */
  function limpiarTarjetas() {
    quitarGaleria();
    cerrarModalPend();
    cerrarPanelPend();
    if (overlay) overlay.querySelectorAll('.box-summary-card, .slot-tools, .slot-empty-card').forEach(c => c.remove());
    allBoxes.forEach(b => { b.cardElem = null; });
  }

  function devolverCajasACasa(slot) {
    if (!slot) return;
    slot.boxes.forEach(box => {
      box.mesh.renderOrder = 0;
      box.mesh.visible = true;
      gsap.killTweensOf(box.fly);
      gsap.killTweensOf(box.mesh.rotation);
      gsap.killTweensOf(box.mesh.position);
      gsap.to(box.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.5 });
      gsap.to(box.mesh.rotation, { x: 0, y: 0, z: 0, duration: 0.5 });
      gsap.to(box.mesh.position, { x: box.homePos.x, y: box.homePos.y, z: box.homePos.z, duration: 0.6 });
    });
  }

  function goBack() {
    if (navStack.length === 0) return;

    const state = navStack.pop();
    limpiarTarjetas();

    // --- volver a un slot (desde la inspección de una caja) ---
    if (state.level === 2 && state.slotRef) {
      inspectedBox = null;
      activeSlot = state.slotRef;
      currentLevel = 2;
      zoomToSlotAndSpreadBoxes(state.slotRef, false);
      hud(state.hudTitle, state.hudSub, state.hudPath);
      vistaGuardada = { level: 2, slot: state.slotRef.id };
      if (navStack.length === 0) {
        const bb = document.getElementById('r3d-back');
        if (bb) bb.disabled = true;
      }
      return;
    }

    // --- volver a rack o vista global ---
    devolverCajasACasa(activeSlot);
    activeSlot = null;
    inspectedBox = null;
    enPendientes = false;
    gsap.to(backdropMat, { opacity: 0, duration: 0.4 });

    currentLevel = state.level;
    vistaGuardada = (currentLevel === 1) ? { level: 1, rack: state.hudPath.replace("RACK ", "").trim() } : null;

    animateCamera(state.camPos, state.target, 0.9, () => {
      const searchInput = document.getElementById('r3d-search');
      const activeQuery = searchInput ? searchInput.value.trim().toLowerCase() : "";
      if (currentLevel === 0 && activeQuery) startBlinkingAndPullFront(activeQuery);
      else if (currentLevel === 0) stopBlinkingAndResetBoxes();
    });

    hud(state.hudTitle, state.hudSub, state.hudPath);

    if (navStack.length === 0) {
      const b = document.getElementById('r3d-back');
      if (b) b.disabled = true;
    }
  }

  function resetToGlobal(silencioso) {
    inspectedBox = null;
    activeSlot = null;
    vistaGuardada = null;

    limpiarTarjetas();
    if (backdropMat) gsap.to(backdropMat, { opacity: 0, duration: 0.4 });

    navStack.length = 0;
    currentLevel = 0;
    enPendientes = false;
    clearHover();

    const searchInput = document.getElementById('r3d-search');
    const activeQuery = searchInput ? searchInput.value.trim().toLowerCase() : "";

    const vg = vistaGlobal || { pos: new THREE.Vector3(6, 4.5, 7.5), target: new THREE.Vector3(1.5, 1.2, 0) };
    animateCamera(vg.pos.clone(), vg.target.clone(), silencioso ? 0.1 : 1.0, () => {
      if (activeQuery) startBlinkingAndPullFront(activeQuery);
      else stopBlinkingAndResetBoxes();
    });

    hud("ALMACEN L10 TE", "Pasa el puntero para destacar y haz clic para explorar.", "GLOBAL");
    const b = document.getElementById('r3d-back');
    if (b) b.disabled = true;
  }

  /* =====================
     LOOP
  ===================== */
  function animate() {
    requestAnimationFrame(animate);
    if (!renderer) return;
    controls.enabled = currentLevel !== 2;   // en la galería la cámara queda fija
    if (pisoMesh) pisoMesh.visible = currentLevel !== 2;   // sin piso claro detrás de la galería
    controls.update();
    if (currentLevel !== 2 && (canvasHost.style.clipPath || container.classList.contains('r3d-gallery-mode'))) quitarGaleria();
    rotarCajasDelSlot();
    posicionarCajasEnGaleria();
    updateFloatingOverlay();
    renderer.render(scene, camera);
  }

  /* Mientras se ve un slot (nivel 2) las cajas giran despacio sobre su
     propio eje, como en la vista clásica. Al inspeccionar una caja
     (nivel 3) o al salir del slot, dejan de girar. */
  function rotarCajasDelSlot() {
    if (currentLevel !== 2 || !activeSlot) return;
    activeSlot.boxes.forEach(box => {
      if (box === inspectedBox) return;
      box.mesh.rotation.y += 0.0035;
    });
  }

  /* =====================
     API PÚBLICA
  ===================== */
  function restaurarVista(v) {
    if (!v) return;

    if (v.level === 'pend') {
      if (pendZona) zoomToPendientes();
      return;
    }

    if (v.level === 1) {
      const rack = racksData.find(r => r.rackIndex === v.rack);
      if (rack) zoomToRack(rack);
      return;
    }

    if (v.level === 2 || v.level === 3) {
      let slotEncontrado = null;
      // reconstruir referencia de slot desde las cajas
      for (const b of allBoxes) {
        if (b.slotCode === v.slot) { slotEncontrado = b.parentSlot; break; }
      }
      if (!slotEncontrado) {
        // slot vacío: buscar en raycastTargets
        const hb = raycastTargets.find(o => o.userData.type === 'slot' && o.userData.data.id === v.slot);
        if (hb) slotEncontrado = hb.userData.data;
      }
      if (!slotEncontrado) return;

      const rack = slotEncontrado.tarima ? null : racksData.find(r => r.rackIndex === slotEncontrado.rackIndex);
      if (rack) zoomToRack(rack);
      zoomToSlotAndSpreadBoxes(slotEncontrado);

      if (v.level === 3) {
        const box = allBoxes.find(b => b.id === v.box);
        if (box) inspectSingleBox(box);
      }
    }
  }

  window.Rack3D = {
    init,
    resize: onResize,

    /* Recarga completa desde los datos reales */
    rebuild: function (racks, cajas, mantenerVista) {
      if (!iniciado) return;

      const v = mantenerVista ? vistaGuardada : null;
      const searchInput = document.getElementById('r3d-search');
      const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

      construir(racks, cajas);
      hud("ALMACEN L10 TE", "Pasa el puntero para destacar y haz clic para explorar.", "GLOBAL");
      const b = document.getElementById('r3d-back');
      if (b) b.disabled = true;

      if (!v && !ajusteInicial && vistaGlobal) {
        // primera vez: encuadrar los racks y el área de pendientes
        camera.position.copy(vistaGlobal.pos);
        controls.target.copy(vistaGlobal.target);
        controls.update();
      }
      ajusteInicial = true;

      if (v) restaurarVista(v);
      else if (query) startBlinkingAndPullFront(query);

      // si había una confirmación de acomodo abierta, se vuelve a mostrar (si la caja sigue pendiente)
      if (pendModal && !pendConfirmando) {
        const slotAbierto = (currentLevel === 2 && activeSlot && activeSlot.id === pendModal.slotId) ? activeSlot : null;
        const info = (slotAbierto && typeof window.consultarCajaMigracion === "function")
          ? window.consultarCajaMigracion(pendModal.caja) : null;
        if (slotAbierto && info && info.estado === "pendiente") {
          pendModal.ubicacionActual = info.ubicacionActual;
          pintarModalPend(info, slotAbierto);
        } else {
          pendModal = null;
        }
      }
    },

    entrada,
    salida,
    cambiarCategoriaItem,
    cambiarEstado,
    cambiarTamano,
    buscarMaterial,
    cerrarSugerencias,
    crearCaja,
    eliminarCaja: eliminarCajaProxy,
    abrirEntrada,
    buscarPendiente,
    confirmarPendiente,
    cancelarPendiente,
    cerrarPanelPend,
    filtrarPend,
    enfocarPendiente,
    clearSearch,
    goBack,
    resetToGlobal: function () { resetToGlobal(false); },
    buscar: function (texto) {
      const s = document.getElementById('r3d-search');
      if (!s) return;
      s.value = texto || "";
      updateSuggestionsList();
    }
  };

})();
