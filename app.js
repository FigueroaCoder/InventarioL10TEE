import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot, arrayUnion, writeBatch
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/* =====================
CONFIG
===================== */

const firebaseConfig = {
  apiKey: "AIzaSyAX-WKQe_AvWQzNswGC1QIMRzz3RTMZB2o",
  authDomain: "almacen-web-2026.firebaseapp.com",
  projectId: "almacen-web-2026",
  storageBucket: "almacen-web-2026.firebasestorage.app",
  messagingSenderId: "777489188342",
  appId: "1:777489188342:web:992bdeeeaa8bd89409f3d7"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

/* =====================
CATEGORÍAS DE MATERIAL
===================== */

window.CATEGORIAS_MATERIAL = [
  "Consumible indirecto",
  "Material en SAP",
  "Material recibido de Taiwán sin registro en SAP",
  "Material en validación de Scrap",
  "Material en validación de envío a Tool Crib"
];

/* =====================
UTIL
===================== */

/* identifica esta pestaña/sesión: sirve para que la notificación diga "Tú"
   solo en quien hizo el movimiento y muestre el nombre en los demás */
const SESION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

function getUser(){
  return window.currentUser?.email || "DESCONOCIDO";
}

/* Único admin del sistema: roberto.figueroa@gdl.fii-na.com (definido en auth-global.js).
   Cualquier otro usuario, sin importar lo que diga Firestore, es "user" común. */
function isAdmin(){
  return window.currentRole === "admin";
}

/* expuesto para el visor 3D (rack3d.js) */
window.isAdminUser = function(){
  return window.currentRole === "admin";
};

function bloquearSiNoAdmin(mensaje){
  if(!isAdmin()){
    alert(mensaje || "Solo el administrador (roberto.figueroa@gdl.fii-na.com) puede realizar esta acción.");
    return true;
  }
  return false;
}

function pad2(n){
  return String(n).padStart(2,"0");
}

function normCaja(c){
  c = String(c ?? "").trim();
  if(!c) return "";
  if(/^\d+$/.test(c)) return pad2(c);
  return c.toUpperCase().replace(/[\/\\]/g,"-");
}

function buildUbicacion(rack, nivel, slot, caja){
  return `${rack}-${pad2(nivel)}-${pad2(slot)}-${normCaja(caja)}`;
}

/* El número/etiqueta de una caja es único en TODO el almacén: no puede
   repetirse en otro rack, nivel o slot (ej. solo puede existir una "Caja 01"
   en total). */
function cajaNumeroDuplicado(cajaId, ubicacionAIgnorar){
  const norm = normCaja(cajaId);
  return cacheCajas.some(c =>
    normCaja(c.caja || "") === norm &&
    c.ubicacion !== ubicacionAIgnorar
  );
}

/* Si la etiqueta de la caja es puramente numérica, devuelve su valor; si no, null. */
function numeroDeCaja(cajaStr){
  const c = String(cajaStr ?? "").trim();
  if(/^\d+$/.test(c)) return parseInt(c, 10);
  return null;
}

/* Próximo número entero disponible = el entero más alto ya registrado + 1
   (solo considera cajas cuya etiqueta es un número). */
function siguienteNumeroCaja(){
  let max = 0;
  cacheCajas.forEach(c=>{
    const n = numeroDeCaja(c.caja || "");
    if(n !== null && n > max) max = n;
  });
  return pad2(max + 1);
}

/* =====================
MATERIAL DE MIGRACIÓN (cajas pendientes de acomodar)
-------------------------------------------------------
Todas las cajas que ya existían antes de este cambio son material de
migración: todavía no se sabe en qué posición real del rack están, así que
se muestran aparte (a un lado de los racks) como "pendientes de acomodar".
  - Caja de migración pendiente: migracion !== false  y  acomodada !== true
    (las cajas viejas no tienen el campo `migracion`, por eso cuentan como
    migración sin tener que modificar ningún dato guardado).
  - Toda caja NUEVA se crea con migracion:false y se maneja como siempre.
  - Al acomodar una caja de migración se guarda con acomodada:true y deja de
    ser pendiente.
===================== */
function esCajaPendiente(c){
  return !!c && c.migracion !== false && c.acomodada !== true;
}
window.esCajaPendiente = esCajaPendiente;

/* varias cajas pueden vivir dentro del mismo slot
   (las pendientes de acomodar NO cuentan: todavía no están en ningún slot) */
function cajasDeSlot(rack, nivel, slot){
  return cacheCajas.filter(c =>
    !esCajaPendiente(c) &&
    c.rack === rack &&
    Number(c.nivel) === Number(nivel) &&
    Number(c.slot) === Number(slot)
  );
}

/* =====================
CACHE
===================== */

let cacheCajas = [];        // todas las cajas (con su arreglo de componentes)
let historialCache = [];
let cacheRacks = [];

/* =====================
CARGA DE CAJAS (CORE)
===================== */

async function loadCajas(force){
  if(!force && cacheCajas.length > 0) return cacheCajas;

  const snapshot = await getDocs(collection(db,"cajas"));
  cacheCajas = snapshot.docs.map(d => ({
    idDoc: d.id,
    ...d.data()
  }));

  return cacheCajas;
}

/* devuelve todas las filas planas: una por componente dentro de cada caja */
function filasPlanas(){
  const filas = [];
  cacheCajas.forEach(c => {
    (c.componentes || []).forEach(comp => {
      filas.push({
        ubicacion: c.ubicacion,
        rack: c.rack,
        nivel: c.nivel,
        slot: c.slot,
        nombre: comp.nombre,
        pn: comp.pn,
        cantidad: comp.cantidad,
        responsable: comp.responsable,
        comentarios: comp.comentarios
      });
    });
  });
  return filas;
}

/* =====================
REGISTRAR ENTRADA
===================== */

window.registerEntry = async function(){

  const rack = document.getElementById("rackSelect")?.value;
  const nivel = document.getElementById("nivelSelect")?.value;
  const slot = document.getElementById("slotSelect")?.value;
  const ubicacion = document.getElementById("cajaSelect")?.value;

  let nombre = document.getElementById("nombre").value.trim().toUpperCase();
  let pn = document.getElementById("pn").value.trim().toUpperCase();
  let cantidad = parseInt(document.getElementById("cantidad").value);
  let comentarios = (document.getElementById("comentarios").value.trim() || "NO APLICA").toUpperCase();
  let categoria = document.getElementById("categoria")?.value || "";
  let medida = (document.getElementById("medida")?.value || "").trim().toUpperCase();

  if(!rack || !nivel || !slot || !ubicacion){
    alert("Selecciona rack, nivel, slot y caja");
    return;
  }

  if(!nombre || isNaN(cantidad) || cantidad <= 0){
    alert("Datos inválidos");
    return;
  }

  // Si no se escribió PN y el material ya existe en cualquier caja, hereda su PN
  if(!pn){
    const match = window.getMaterialesCatalogo().find(m => String(m.nombre).toLowerCase() === nombre.toLowerCase());
    pn = (match && match.pn && match.pn !== "NO APLICA") ? String(match.pn).toUpperCase() : "NO APLICA";
  }
  if(!medida){
    const mm = window.getMaterialesCatalogo().find(m => String(m.nombre).toLowerCase() === nombre.toLowerCase());
    medida = (mm && mm.medida) ? String(mm.medida).toUpperCase() : "";
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("Esa caja ya no existe. Créala de nuevo en Racks y Cajas.");
      return;
    }

    let componentes = cajaSnap.data().componentes || [];

    const idx = componentes.findIndex(c => c.nombre.toLowerCase() === nombre.toLowerCase());

    if(idx >= 0){
      componentes[idx].nombre = nombre;
      componentes[idx].cantidad = (componentes[idx].cantidad || 0) + cantidad;
      componentes[idx].pn = pn || componentes[idx].pn;
      componentes[idx].comentarios = comentarios;
      componentes[idx].responsable = getUser();
      if(categoria) componentes[idx].categoria = categoria;
      if(medida) componentes[idx].medida = medida;
    } else {
      componentes.push({
        nombre, pn, cantidad, comentarios,
        responsable: getUser(),
        categoria: categoria || "",
        medida: medida || ""
      });
    }

    await updateDoc(cajaRef, { componentes });

    // 🔥 HISTORIAL
    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ENTRADA",
      ubicacion,
      nombre,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    alert("Entrada registrada en caja " + ubicacion);

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);

    if(typeof window.resetCampos === "function") window.resetCampos();

  }catch(e){
    console.error(e);
    alert("Error en entrada");
  }

};

/* =====================
INVENTARIO (STOCK)
===================== */

/* Inventario agrupado por MATERIAL: si el mismo material está en varias
   cajas, se muestra en UNA sola fila con la cantidad total sumada y, en la
   columna de caja, el detalle de cuánto hay en cada una. */

function invClave(nombre){
  return String(nombre || "").trim().replace(/\s+/g," ").toUpperCase();
}

/* escapa un texto para usarlo dentro de onclick="fn('...')" */
function invJsq(t){
  return String(t ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,"&quot;");
}

function agruparInventario(){

  const grupos = new Map();

  cacheCajas.forEach(c => {
    (c.componentes || []).forEach(comp => {

      const clave = invClave(comp.nombre);
      if(!clave) return;

      if(!grupos.has(clave)){
        grupos.set(clave, { nombre: clave, total: 0, cajas: [], pns: new Set(), resp: new Set(), coms: new Set() });
      }

      const g = grupos.get(clave);
      const cant = Number(comp.cantidad) || 0;

      g.total += cant;
      g.cajas.push({ ubicacion: c.ubicacion, cantidad: cant, nombreOriginal: comp.nombre, pendiente: esCajaPendiente(c), caja: c.caja });

      const pn = String(comp.pn || "").trim().toUpperCase();
      if(pn && pn !== "NO APLICA") g.pns.add(pn);

      const r = String(comp.responsable || "").trim();
      if(r) g.resp.add(r);

      const com = String(comp.comentarios || "").trim().toUpperCase();
      if(com && com !== "NO APLICA") g.coms.add(com);
    });
  });

  const lista = Array.from(grupos.values());
  lista.forEach(g => g.cajas.sort((x,y) => String(x.ubicacion).localeCompare(String(y.ubicacion))));
  lista.sort((x,y) => x.nombre.localeCompare(y.nombre));
  return lista;
}

let cargandoStock = false;

window.showStock = async function(force){

  if(cargandoStock) return;
  cargandoStock = true;

  const tabla = document.getElementById("tabla");
  if(!tabla){
    cargandoStock = false;
    return;
  }

  try{

    await loadCajas(force);
    const grupos = agruparInventario();

    let html = "";

    grupos.forEach(g=>{

      /* las cajas de migración pendientes no tienen posición real todavía */
      const ubiTxt = x => x.pendiente ? `CAJA ${x.caja || x.ubicacion} · PENDIENTE DE ACOMODAR` : x.ubicacion;
      const cajaCorta = x => x.pendiente ? `CAJA ${x.caja || x.ubicacion}` : x.ubicacion;

      const cajasTd = g.cajas.map(x =>
        `<div>${trEscape(ubiTxt(x))} <span style="color:var(--ink-muted);font-weight:600;">× ${x.cantidad}</span></div>`
      ).join("");

      const accionesTd = isAdmin()
        ? g.cajas.map(x => `
<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin:2px 0;">
<span style="font-size:0.72rem;color:var(--ink-muted);min-width:78px;text-align:right;">${trEscape(cajaCorta(x))}</span>
<button style="padding:4px 9px;font-size:0.75rem;" title="Editar en la caja ${trEscape(cajaCorta(x))}" onclick="editarMaterial('${invJsq(x.ubicacion)}','${invJsq(x.nombreOriginal)}')">✏</button>
<button class="btn-danger" style="padding:4px 9px;font-size:0.75rem;" title="Eliminar de la caja ${trEscape(cajaCorta(x))}" onclick="eliminarMaterial('${invJsq(x.ubicacion)}','${invJsq(x.nombreOriginal)}')">🗑</button>
</div>`).join("")
        : `<span style="color:var(--ink-soft);">—</span>`;

      const pn = g.pns.size ? Array.from(g.pns).map(trEscape).join("<br>") : "NO APLICA";
      const resp = Array.from(g.resp).map(trEscape).join("<br>");
      const coms = g.coms.size ? Array.from(g.coms).map(trEscape).join("<br>") : "NO APLICA";

      html += `
<tr>
<td>${cajasTd}</td>
<td>${trEscape(g.nombre)}</td>
<td>${pn}</td>
<td><b>${g.total}</b></td>
<td>${resp}</td>
<td>${coms}</td>
<td>${accionesTd}</td>
</tr>`;
    });

    tabla.innerHTML = html || `<tr><td colspan="7" style="color:var(--ink-soft);">Sin existencias registradas</td></tr>`;

  }catch(e){
    console.error("Error cargando inventario:", e);
  }

  cargandoStock = false;
};

/* =====================
BUSCADOR INVENTARIO (por caja o componente)
===================== */

window.liveSearch = function(){

  const input = document.getElementById("valor").value.toLowerCase();
  const filas = document.querySelectorAll("#tabla tr");

  filas.forEach(fila => {
    const texto = fila.innerText.toLowerCase();
    fila.style.display = texto.includes(input) ? "" : "none";
  });

};

/* =====================
SALIDA
===================== */

window.registrarSalida = async function(){

  const ubicacion = document.getElementById("ubicacionSalida").value.trim();
  const nombre = document.getElementById("nombreSalida").value.trim();
  let cantidad = parseInt(document.getElementById("cantidadSalida").value);
  let comentarios = document.getElementById("comentariosSalida").value || "NO APLICA";

  if(!ubicacion || !nombre){
    alert("Busca y selecciona un componente/caja primero");
    return;
  }

  if(isNaN(cantidad) || cantidad <= 0){
    alert("Cantidad inválida");
    return;
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return;
    }

    let data = cajaSnap.data();
    let componentes = data.componentes || [];

    const idx = componentes.findIndex(c => c.nombre.toLowerCase() === nombre.toLowerCase());

    if(idx < 0){
      alert("Ese componente no está en esa caja");
      return;
    }

    if(componentes[idx].cantidad < cantidad){
      alert("Sin stock suficiente. Disponible: " + componentes[idx].cantidad);
      return;
    }

    componentes[idx].cantidad -= cantidad;

    if(componentes[idx].cantidad <= 0){
      componentes.splice(idx,1);
    }

    await updateDoc(cajaRef, { componentes });

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "SALIDA",
      ubicacion,
      nombre,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    alert("Salida registrada");

    await loadCajas(true);
    if(typeof window.resetSalidaForm === "function") window.resetSalidaForm();

  }catch(e){
    console.error(e);
    alert("Error en salida");
  }

};

/* =====================
BUSCADOR SALIDA — por número de caja o por componente
===================== */

window.suggestBoxOrProduct = async function(){

  const inputEl = document.getElementById("buscarSalida");
  const contenedor = document.getElementById("sugerenciasSalida");

  const input = inputEl.value.toLowerCase().trim();
  contenedor.innerHTML = "";

  if(!input) return;

  await loadCajas();

  const resultados = [];

  cacheCajas.forEach(c => {
    (c.componentes || []).forEach(comp => {
      const matchUbicacion = c.ubicacion.toLowerCase().includes(input);
      const matchNombre = comp.nombre?.toLowerCase().includes(input);
      const matchPn = comp.pn?.toLowerCase().includes(input);

      if(matchUbicacion || matchNombre || matchPn){
        resultados.push({ ubicacion: c.ubicacion, ...comp });
      }
    });
  });

  if(resultados.length === 0){
    contenedor.innerHTML = `<div class="suggestion" style="cursor:default;">Sin resultados</div>`;
    return;
  }

  resultados.slice(0,8).forEach(r=>{

    const item = document.createElement("div");
    item.className = "suggestion";
    item.innerHTML = `<b>${r.nombre}</b> — Caja ${r.ubicacion} · Disponible: ${r.cantidad}`;

    item.onclick = () => {
      document.getElementById("buscarSalida").value = `${r.nombre} (${r.ubicacion})`;
      document.getElementById("ubicacionSalida").value = r.ubicacion;
      document.getElementById("nombreSalida").value = r.nombre;
      document.getElementById("pnSalida").value = r.pn || "NO APLICA";
      document.getElementById("disponibleSalida").value = r.cantidad;
      contenedor.innerHTML = "";
    };

    contenedor.appendChild(item);
  });

};

window.resetSalidaForm = function(){
  const buscar = document.getElementById("buscarSalida");
  if(!buscar) return;

  buscar.value = "";
  document.getElementById("ubicacionSalida").value = "";
  document.getElementById("nombreSalida").value = "";
  document.getElementById("pnSalida").value = "";
  document.getElementById("disponibleSalida").value = "";
  document.getElementById("cantidadSalida").value = "";
  document.getElementById("comentariosSalida").value = "";
  document.getElementById("sugerenciasSalida").innerHTML = "";
};

/* =====================
HISTORIAL
===================== */

/* Orden del historial: movimiento más reciente primero (usa ts; si un registro
   viejo no lo tiene, se interpreta el texto de la fecha) */
function tsHistorial(d){
  if(typeof d.ts === "number") return d.ts;
  const f = String(d.fecha || "");
  const m = f.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?/i);
  if(m){
    let h = parseInt(m[4],10);
    if(m[7]){ const pm = m[7].toLowerCase()==="p"; if(pm && h<12) h+=12; if(!pm && h===12) h=0; }
    let dd = parseInt(m[1],10), mm = parseInt(m[2],10);
    if(mm > 12 && dd <= 12){ const t = dd; dd = mm; mm = t; }   // formato mes/día (en-US)
    return new Date(parseInt(m[3],10), mm-1, dd, h, parseInt(m[5],10), parseInt(m[6]||"0",10)).getTime();
  }
  const t = new Date(f).getTime();
  return isNaN(t) ? 0 : t;
}
function ordenarHistorial(arr){
  return arr.sort((a,b) => tsHistorial(b) - tsHistorial(a));
}

window.viewHistory = async function(){

  const tabla = document.getElementById("tablaHistorial");
  if(!tabla) return;

  const snapshot = await getDocs(collection(db,"historial"));

  historialCache = snapshot.docs.map(d => ({ idDoc: d.id, ...d.data() }));
  ordenarHistorial(historialCache);

  renderHistorial(historialCache);
};

/* =====================
BORRAR UN MOVIMIENTO DEL HISTORIAL — SOLO ADMIN
===================== */

window.eliminarMovimientoHistorial = async function(idDoc){

  if(bloquearSiNoAdmin("Solo el administrador puede borrar movimientos del historial.")) return;

  if(!confirm("¿Borrar este movimiento del historial? Esta acción no se puede deshacer.")) return;

  try{
    await deleteDoc(doc(db,"historial",idDoc));

    historialCache = historialCache.filter(d => d.idDoc !== idDoc);
    renderHistorial(historialCache);

  }catch(e){
    console.error(e);
    alert("Error borrando el movimiento del historial");
  }

};

/* =====================
RENDER HISTORIAL
===================== */

let renderizandoHistorial = false;

function renderHistorial(data){

  if(renderizandoHistorial) return;
  renderizandoHistorial = true;

  const tabla = document.getElementById("tablaHistorial");
  if(!tabla){
    renderizandoHistorial = false;
    return;
  }

  tabla.innerHTML = "";

  try{

    let html = "";

    data.forEach(d => {
      const accionesTd = (isAdmin() && d.idDoc)
        ? `<button class="btn-danger" style="padding:6px 10px;font-size:0.8rem;" title="Borrar del historial" onclick="eliminarMovimientoHistorial('${d.idDoc}')">🗑</button>`
        : `<span style="color:var(--ink-soft);">—</span>`;

      html += `
<tr>
<td>${d.fecha || ""}</td>
<td>${d.accion || ""}</td>
<td>${d.ubicacion || "-"}</td>
<td>${d.nombre || ""}</td>
<td>${d.cantidad || 0}</td>
<td>${d.responsable || ""}</td>
<td>${d.comentarios || ""}</td>
<td>${accionesTd}</td>
</tr>`;
    });

    tabla.innerHTML = html || `<tr><td colspan="8" style="color:var(--ink-soft);">Sin movimientos registrados</td></tr>`;

  }catch(e){
    console.error("Error renderizando historial:", e);
  }

  renderizandoHistorial = false;
}

/* =====================
BUSCAR + FILTRAR HISTORIAL
===================== */

window.filterHistory = function(){

  const texto = document.getElementById("valor").value.toLowerCase();
  const tipo = document.getElementById("tipoFiltro").value;

  const filtrado = historialCache.filter(item => {

    const matchTexto =
      item.nombre?.toLowerCase().includes(texto) ||
      item.ubicacion?.toLowerCase().includes(texto);

    const matchTipo =
      tipo === "todos" || item.accion === tipo;

    return matchTexto && matchTipo;
  });

  renderHistorial(filtrado);
};

/* =====================
EXPORTAR HISTORIAL
===================== */

window.exportHistory = function(){

  let csv = "Fecha,Movimiento,Ubicacion,Producto,Cantidad,Responsable,Comentarios\n";

  historialCache.forEach(d=>{
    csv += `${d.fecha},${d.accion},${d.ubicacion},${d.nombre},${d.cantidad},${d.responsable},${d.comentarios}\n`;
  });

  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "historial.csv";
  a.click();
};

/* =====================
AUTOCOMPLETE ENTRADA — sugiere productos ya existentes en cualquier caja
===================== */

window.suggestProducts = async function(){

  const input = document.getElementById("nombre").value.toLowerCase();
  const contenedor = document.getElementById("sugerencias");

  contenedor.innerHTML = "";
  if(!input) return;

  await loadCajas();

  // nombres únicos entre todas las cajas
  const vistos = new Set();
  const filtrados = [];

  cacheCajas.forEach(c=>{
    (c.componentes||[]).forEach(comp=>{
      const key = comp.nombre.toLowerCase();
      if(vistos.has(key)) return;

      if(key.includes(input) || comp.pn?.toLowerCase().includes(input)){
        vistos.add(key);
        filtrados.push(comp);
      }
    });
  });

  filtrados.slice(0,6).forEach(p => {

    const item = document.createElement("div");
    item.className = "suggestion";
    item.innerText = `${p.nombre || "Sin nombre"} ${p.pn && p.pn !== "NO APLICA" ? "· " + p.pn : ""}`;

    item.onclick = () => seleccionarProducto(p);

    contenedor.appendChild(item);
  });

};

function seleccionarProducto(p){

  document.getElementById("nombre").value = p.nombre || "";
  document.getElementById("pn").value = (p.pn && p.pn !== "NO APLICA") ? p.pn : "";
  const medidaInput = document.getElementById("medida");
  if(medidaInput) medidaInput.value = p.medida || "";

  document.getElementById("cantidad").value = "";
  document.getElementById("cantidad").focus();

  document.getElementById("sugerencias").innerHTML = "";
}

/* =====================
RACKS — administración
===================== */

async function loadRacks(force){
  if(!force && cacheRacks.length > 0) return cacheRacks;

  const snapshot = await getDocs(collection(db,"racks"));
  cacheRacks = snapshot.docs.map(d => ({ idDoc:d.id, ...d.data() }));
  cacheRacks.sort((a,b)=> a.nombre.localeCompare(b.nombre));

  return cacheRacks;
}

window.crearRack = async function(){

  if(bloquearSiNoAdmin("Solo el administrador puede agregar racks.")) return;

  const nombre = document.getElementById("rackNombre").value.trim().toUpperCase();
  const niveles = parseInt(document.getElementById("rackNiveles").value);
  const slots = parseInt(document.getElementById("rackSlots").value);

  if(!nombre || isNaN(niveles) || niveles <= 0 || isNaN(slots) || slots <= 0){
    alert("Datos de rack inválidos");
    return;
  }

  try{

    const rackRef = doc(db,"racks",nombre);
    const rackSnap = await getDoc(rackRef);

    if(rackSnap.exists()){
      alert("Ya existe un rack con ese nombre");
      return;
    }

    await setDoc(rackRef, {
      nombre, niveles, slots, status:"active"
    });

    document.getElementById("rackNombre").value = "";
    document.getElementById("rackNiveles").value = "";
    document.getElementById("rackSlots").value = "";

    alert("Rack " + nombre + " creado. Agrega cajas a cada slot desde esta página.");

    await loadRacks(true);
    await loadCajas(true);
    window.renderRacksPage();

  }catch(e){
    console.error(e);
    alert("Error creando rack");
  }

};

window.toggleRackStatus = async function(nombre){

  try{
    const rack = cacheRacks.find(r => r.nombre === nombre);
    if(!rack) return;

    const nuevoStatus = rack.status === "active" ? "inactive" : "active";

    await updateDoc(doc(db,"racks",nombre), { status: nuevoStatus });

    await loadRacks(true);
    window.renderRacksPage();

  }catch(e){
    console.error(e);
    alert("Error actualizando rack");
  }

};

window.eliminarRack = async function(nombre){

  if(bloquearSiNoAdmin("Solo el administrador puede eliminar racks.")) return;

  if(!confirm(`¿Eliminar el rack ${nombre} y todas sus cajas? Esta acción no se puede deshacer.`)) return;

  try{

    await deleteDoc(doc(db,"racks",nombre));

    const relacionadas = cacheCajas.filter(c => c.rack === nombre && !esCajaPendiente(c));   // las pendientes de acomodar no están en el rack: no se borran
    for(const c of relacionadas){
      await deleteDoc(doc(db,"cajas",c.ubicacion));
    }

    await loadRacks(true);
    await loadCajas(true);
    window.renderRacksPage();

  }catch(e){
    console.error(e);
    alert("Error eliminando rack");
  }

};

/* =====================
CAJAS DENTRO DE UN SLOT (número manual)
===================== */

window.crearCajaEnSlot = async function(rack, nivel, slot, opts){

  await loadCajas(true);

  opts = opts || {};
  let entrada = opts.caja;

  if(entrada === undefined){
    const sugerido = siguienteNumeroCaja();
    entrada = prompt(
      `Número o etiqueta de la nueva caja para ${rack}-${pad2(nivel)}-${pad2(slot)}:\n` +
      `(cada número de caja solo puede existir una vez en todo el almacén)`,
      sugerido
    );
    if(entrada === null) return null;
  }

  const cajaId = normCaja(entrada);

  if(!cajaId){
    alert("Número de caja inválido");
    return null;
  }

  if(cajaNumeroDuplicado(cajaId)){
    alert(`Ya existe una caja "${cajaId}" en el almacén (en otro rack o slot). Cada número de caja solo puede existir una vez en todo el sistema.`);
    return null;
  }

  const tamano = ["chica","mediana","grande"].includes(String(opts.tamano||"").toLowerCase())
    ? String(opts.tamano).toLowerCase() : null;
  const estado = ["vacia","bajo","medio","lleno"].includes(String(opts.estado||"").toLowerCase())
    ? String(opts.estado).toLowerCase() : null;

  const ubicacion = buildUbicacion(rack, nivel, slot, cajaId);

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(cajaSnap.exists()){
      alert("Ya existe una caja con esa ubicación exacta");
      return null;
    }

    await setDoc(cajaRef, {
      rack, nivel: parseInt(nivel), slot: parseInt(slot), caja: cajaId, ubicacion,
      componentes: [],
      migracion: false      // caja nueva: no es material de migración
    });
    // tamaño físico y estado (llena / poco contenido...) elegidos al crearla
    const extra = {};
    if(tamano) extra.tamano = tamano;
    if(estado) extra.estado = estado;
    if(Object.keys(extra).length) await updateDoc(cajaRef, extra);

    await loadCajas(true);
    if(typeof window.renderRacksPage === "function") window.renderRacksPage();

    return ubicacion;

  }catch(e){
    console.error(e);
    alert("Error creando caja");
    return null;
  }

};

/* Crear una caja nueva desde el formulario de Registrar Entrada (entrada.html).
   Usa el rack/nivel/slot ya elegidos ahí, respeta la unicidad global del
   número de caja y, al terminar, deja la caja nueva seleccionada en el
   formulario. */
window.siguienteNumeroCaja = function(){ return siguienteNumeroCaja(); };

window.crearCajaDesdeEntrada = async function(){

  const rackSelect = document.getElementById("rackSelect");
  const nivelSelect = document.getElementById("nivelSelect");
  const slotSelect = document.getElementById("slotSelect");
  const cajaSelect = document.getElementById("cajaSelect");

  const rack = rackSelect?.value;
  const nivel = nivelSelect?.value;
  const slot = slotSelect?.value;

  if(!rack || !nivel || !slot){
    alert("Selecciona rack, nivel y slot antes de crear una caja nueva");
    return;
  }

  const numero = document.getElementById("nuevaCajaNumero")?.value;
  const tamano = document.getElementById("nuevaCajaTamano")?.value || "mediana";
  const estado = document.getElementById("nuevaCajaEstado")?.value || "vacia";

  const ubicacion = await window.crearCajaEnSlot(rack, nivel, slot, { caja: numero, tamano, estado });
  if(!ubicacion) return;

  if(typeof window.cerrarPanelNuevaCaja === "function") window.cerrarPanelNuevaCaja();

  if(typeof window.initUbicacionSelectors === "function"){
    await window.initUbicacionSelectors();
  }

  if(rackSelect){
    rackSelect.value = rack;
    if(rackSelect.onchange) rackSelect.onchange();
  }
  if(nivelSelect) nivelSelect.value = nivel;
  if(slotSelect){
    slotSelect.value = slot;
    if(slotSelect.onchange) slotSelect.onchange();
  }
  if(cajaSelect){
    cajaSelect.value = ubicacion;
    if(cajaSelect.onchange) cajaSelect.onchange();
  }
};

window.eliminarCaja = async function(ubicacion){

  if(bloquearSiNoAdmin("Solo el administrador puede eliminar cajas.")) return;

  const caja = cacheCajas.find(c => c.ubicacion === ubicacion);
  const tieneContenido = caja && (caja.componentes||[]).length > 0;

  const confirmMsg = tieneContenido
    ? `La caja ${ubicacion} tiene componentes registrados. ¿Eliminarla de todas formas?`
    : `¿Eliminar la caja ${ubicacion}?`;

  if(!confirm(confirmMsg)) return;

  try{
    await deleteDoc(doc(db,"cajas",ubicacion));
    try{ if(caja) await deleteDoc(doc(db,"etiquetas", etqId(etqNumCaja(caja)))); }catch(e){ console.error(e); }
    await loadCajas(true);
    if(typeof window.renderRacksPage === "function") window.renderRacksPage();
  }catch(e){
    console.error(e);
    alert("Error eliminando caja");
  }

};

/* =====================
ELIMINAR MATERIAL (componente) DE UNA CAJA — SOLO ADMIN
===================== */

window.eliminarMaterial = async function(ubicacion, nombreMaterial){

  if(bloquearSiNoAdmin("Solo el administrador puede borrar materiales.")) return;

  if(!confirm(`¿Eliminar por completo el material "${nombreMaterial}" de la caja ${ubicacion}? Esta acción no se puede deshacer.`)) return;

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return;
    }

    let data = cajaSnap.data();
    let componentes = data.componentes || [];

    const idx = componentes.findIndex(c => c.nombre.toLowerCase() === nombreMaterial.toLowerCase());

    if(idx < 0){
      alert("Ese material ya no está en esta caja");
      return;
    }

    const cantidadEliminada = componentes[idx].cantidad || 0;
    componentes.splice(idx,1);

    await updateDoc(cajaRef, { componentes });

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ELIMINACION MATERIAL",
      ubicacion,
      nombre: nombreMaterial,
      cantidad: cantidadEliminada,
      responsable: getUser(),
      comentarios: "Eliminado por administrador"
    });

    await loadCajas(true);
    if(typeof window.showStock === "function") window.showStock(true);
    if(typeof window.renderRacksPage === "function") window.renderRacksPage();

    alert("Material eliminado");

  }catch(e){
    console.error(e);
    alert("Error eliminando material");
  }

};

/* =====================
EDITAR MATERIAL YA REGISTRADO — SOLO ADMIN
Ventana de edición: permite corregir el NOMBRE (escribiéndolo o eligiendo uno
ya registrado para que ambos sean el mismo material), la cantidad, el Part
Number, la medida y los comentarios. Queda en Historial como "ACTUALIZACION".
===================== */

function emEstilos(){
  if(document.getElementById("emEstilos")) return;
  const st = document.createElement("style");
  st.id = "emEstilos";
  st.textContent = `
.em-overlay{ position:fixed; inset:0; background:rgba(10,12,16,.62); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px; }
.em-box{ background:#fff; width:min(560px,100%); max-height:92vh; overflow:auto; border-radius:12px; padding:22px 22px 18px; box-shadow:0 30px 70px -20px rgba(0,0,0,.55); border-top:4px solid var(--accent,#ff5a1f); }
.em-box h3{ margin:0 0 4px; font-family:var(--font-display,inherit); font-size:26px; letter-spacing:.5px; }
.em-box p.em-sub{ margin:0 0 12px; color:var(--ink-muted,#6b7280); font-size:12.5px; }
.em-box label{ display:block; margin:12px 0 4px; }
.em-grid{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
.em-sugs{ border:1px solid var(--line,#e1e5ea); border-radius:8px; margin-top:4px; max-height:190px; overflow:auto; display:none; background:#fff; }
.em-sug{ padding:9px 12px; cursor:pointer; font-size:13.5px; border-bottom:1px solid var(--line-soft,#eceff2); display:flex; justify-content:space-between; gap:10px; }
.em-sug:last-child{ border-bottom:0; }
.em-sug:hover{ background:#fff3ec; }
.em-sug small{ color:var(--ink-muted,#6b7280); white-space:nowrap; }
.em-estado{ font-size:12.5px; margin-top:6px; font-weight:600; }
.em-estado.ok{ color:#1f9d55; } .em-estado.nuevo{ color:#b45309; } .em-estado.igual{ color:var(--ink-muted,#6b7280); }
.em-chk{ display:flex; gap:9px; align-items:flex-start; margin-top:14px; font-size:13px; line-height:1.35; }
.em-chk input{ width:auto; margin-top:2px; }
.em-btns{ display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
.em-btns button{ margin:0 !important; }
@media(max-width:560px){ .em-grid{ grid-template-columns:1fr; } }
`;
  document.head.appendChild(st);
}

function modalEditarMaterial(actual, ubicacion){

  return new Promise(resolve => {

    emEstilos();

    const catalogo = window.getMaterialesCatalogo();
    const claveActual = invClave(actual.nombre);
    const otrasCajas = cacheCajas.filter(c =>
      (c.componentes || []).some(x => invClave(x.nombre) === claveActual)
    ).length;

    const ov = document.createElement("div");
    ov.className = "em-overlay";
    ov.innerHTML = `
<div class="em-box" role="dialog" aria-modal="true">
<h3>EDITAR MATERIAL</h3>
<p class="em-sub">Caja ${trEscape(ubicacion)} · escribe para corregir el nombre o elige uno ya registrado para hacerlos coincidir.</p>

<label>Nombre del producto</label>
<input id="emNombre" autocomplete="off" value="${trEscape(actual.nombre)}">
<div class="em-sugs" id="emSug"></div>
<div class="em-estado igual" id="emEstado">Nombre actual</div>

<div class="em-grid">
<div><label>Cantidad</label><input id="emCant" type="number" min="0" value="${Number(actual.cantidad) || 0}"></div>
<div><label>Part Number</label><input id="emPn" value="${trEscape(actual.pn || "NO APLICA")}"></div>
<div><label>Medida</label><input id="emMedida" placeholder="N/A" value="${trEscape(actual.medida || "")}"></div>
</div>

<label>Comentarios</label>
<input id="emCom" value="${trEscape(actual.comentarios || "")}">

<label class="em-chk"><input type="checkbox" id="emTodas" checked>
<span>Aplicar el cambio de <b>nombre, PN y medida</b> a <b>todas las cajas</b> donde está este material (${otrasCajas} ${otrasCajas === 1 ? "caja" : "cajas"}). La cantidad y los comentarios solo cambian en esta caja.</span></label>

<div class="em-btns">
<button type="button" id="emCancelar" style="background:#6b7280;">Cancelar</button>
<button type="button" id="emGuardar">Guardar cambios</button>
</div>
</div>`;

    document.body.appendChild(ov);

    const $ = id => ov.querySelector("#" + id);
    const inNombre = $("emNombre"), sug = $("emSug"), estado = $("emEstado");

    function norm(t){ return String(t || "").trim().replace(/\s+/g, " ").toUpperCase(); }

    function actualizarEstado(){
      const k = invClave(inNombre.value);
      if(!k){ estado.className = "em-estado nuevo"; estado.textContent = "Escribe un nombre"; return; }
      if(k === claveActual && norm(inNombre.value) === norm(actual.nombre)){
        estado.className = "em-estado igual"; estado.textContent = "Nombre actual"; return;
      }
      const existe = catalogo.find(m => invClave(m.nombre) === k && invClave(m.nombre) !== claveActual);
      if(existe){
        estado.className = "em-estado ok";
        estado.textContent = "✔ Coincide con un material ya registrado: se unificará con ese nombre";
      } else {
        estado.className = "em-estado nuevo";
        estado.textContent = "Nombre nuevo: se guardará como corrección del nombre";
      }
    }

    function pintarSugerencias(){
      const q = invClave(inNombre.value);
      const lista = catalogo
        .filter(m => invClave(m.nombre) !== claveActual)
        .filter(m => !q || invClave(m.nombre).includes(q) || String(m.pn || "").toUpperCase().includes(q))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
        .slice(0, 8);

      if(!lista.length){ sug.style.display = "none"; sug.innerHTML = ""; return; }

      sug.innerHTML = "";
      lista.forEach(m => {
        const it = document.createElement("div");
        it.className = "em-sug";
        const pn = (m.pn && m.pn !== "NO APLICA") ? m.pn : "";
        it.innerHTML = `<span>${trEscape(m.nombre)}</span><small>${trEscape(pn)}</small>`;
        it.addEventListener("mousedown", ev => {
          ev.preventDefault();
          inNombre.value = String(m.nombre).toUpperCase();
          if(m.pn && m.pn !== "NO APLICA") $("emPn").value = String(m.pn).toUpperCase();
          if(m.medida) $("emMedida").value = String(m.medida).toUpperCase();
          sug.style.display = "none";
          actualizarEstado();
        });
        sug.appendChild(it);
      });
      sug.style.display = "block";
    }

    inNombre.addEventListener("input", () => { pintarSugerencias(); actualizarEstado(); });
    inNombre.addEventListener("focus", pintarSugerencias);
    inNombre.addEventListener("blur", () => setTimeout(() => { sug.style.display = "none"; }, 150));

    function cerrar(val){
      document.removeEventListener("keydown", onKey);
      ov.remove();
      resolve(val);
    }

    function onKey(e){ if(e.key === "Escape") cerrar(null); }
    document.addEventListener("keydown", onKey);

    $("emCancelar").onclick = () => cerrar(null);
    ov.addEventListener("mousedown", e => { if(e.target === ov) cerrar(null); });

    $("emGuardar").onclick = () => {
      const nombre = norm(inNombre.value);
      const cantidad = parseInt($("emCant").value);
      if(!nombre){ alert("El nombre no puede quedar vacío"); return; }
      if(isNaN(cantidad) || cantidad < 0){ alert("Cantidad inválida"); return; }
      cerrar({
        nombre,
        cantidad,
        pn: $("emPn").value,
        medida: $("emMedida").value,
        comentarios: $("emCom").value,
        todas: $("emTodas").checked
      });
    };

    inNombre.focus();
    inNombre.select();
  });
}

window.editarMaterial = async function(ubicacion, nombreMaterial){

  if(bloquearSiNoAdmin("Solo el administrador puede editar materiales del inventario.")) return;

  try{

    await loadCajas(true);

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return;
    }

    const dataCaja = cajaSnap.data();
    let componentes = dataCaja.componentes || [];

    const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === String(nombreMaterial).toLowerCase());

    if(idx < 0){
      alert("Ese material ya no está en esta caja");
      return;
    }

    const actual = { ...componentes[idx] };

    const r = await modalEditarMaterial(actual, ubicacion);
    if(!r) return;

    const nombreViejo = String(actual.nombre);
    const nuevoNombre = r.nombre;
    const renombrar = nuevoNombre !== nombreViejo;

    const pnNuevo = (String(r.pn || "").trim() || "NO APLICA").toUpperCase();
    const medidaNueva = String(r.medida || "").trim().toUpperCase();
    const comNuevo = String(r.comentarios || "").toUpperCase();

    const pnCambio = pnNuevo !== String(actual.pn || "NO APLICA").toUpperCase();
    const medidaCambio = medidaNueva !== String(actual.medida || "").toUpperCase();

    const cambios = [];
    const cantAntes = Number(actual.cantidad) || 0;
    if(renombrar) cambios.push(`nombre "${nombreViejo}" → "${nuevoNombre}"`);
    if(r.cantidad !== cantAntes) cambios.push(`cantidad ${cantAntes} → ${r.cantidad}`);
    if(pnCambio) cambios.push(`PN "${actual.pn || ""}" → "${pnNuevo}"`);
    if(medidaCambio) cambios.push(`medida "${actual.medida || ""}" → "${medidaNueva}"`);
    if(comNuevo !== String(actual.comentarios || "").toUpperCase()) cambios.push("comentarios actualizados");

    if(!cambios.length){
      alert("No hiciste ningún cambio");
      return;
    }

    /* ---- esta caja ---- */
    const mergeCon = renombrar
      ? componentes.findIndex((c, i) => i !== idx && invClave(c.nombre) === invClave(nuevoNombre))
      : -1;

    if(mergeCon >= 0){
      componentes[mergeCon].cantidad = (Number(componentes[mergeCon].cantidad) || 0) + r.cantidad;
      componentes[mergeCon].nombre = nuevoNombre;
      if(pnNuevo !== "NO APLICA") componentes[mergeCon].pn = pnNuevo;
      if(medidaNueva) componentes[mergeCon].medida = medidaNueva;
      componentes[mergeCon].comentarios = comNuevo;
      componentes[mergeCon].responsable = getUser();
      componentes.splice(idx, 1);
      cambios.push(`unido al material "${nuevoNombre}" que ya estaba en la caja`);
    } else {
      componentes[idx].nombre = nuevoNombre;
      componentes[idx].cantidad = r.cantidad;
      componentes[idx].pn = pnNuevo;
      componentes[idx].medida = medidaNueva;
      componentes[idx].comentarios = comNuevo;
    }

    await updateDoc(cajaRef, { componentes });

    /* ---- demás cajas con el mismo material ---- */
    const otrasActualizadas = [];

    if(r.todas && (renombrar || pnCambio || medidaCambio)){

      const otras = cacheCajas.filter(c =>
        c.ubicacion !== ubicacion &&
        (c.componentes || []).some(x => invClave(x.nombre) === invClave(nombreViejo))
      );

      for(const c of otras){

        const ref = doc(db,"cajas",c.ubicacion);
        const sn = await getDoc(ref);
        if(!sn.exists()) continue;

        let comps = sn.data().componentes || [];
        const i = comps.findIndex(x => invClave(x.nombre) === invClave(nombreViejo));
        if(i < 0) continue;

        const m = renombrar
          ? comps.findIndex((x, j) => j !== i && invClave(x.nombre) === invClave(nuevoNombre))
          : -1;

        if(m >= 0){
          comps[m].cantidad = (Number(comps[m].cantidad) || 0) + (Number(comps[i].cantidad) || 0);
          comps[m].nombre = nuevoNombre;
          if(pnCambio) comps[m].pn = pnNuevo;
          if(medidaCambio) comps[m].medida = medidaNueva;
          comps.splice(i, 1);
        } else {
          if(renombrar) comps[i].nombre = nuevoNombre;
          if(pnCambio) comps[i].pn = pnNuevo;
          if(medidaCambio) comps[i].medida = medidaNueva;
        }

        await updateDoc(ref, { componentes: comps });
        otrasActualizadas.push(c);
      }
    }

    /* ---- etiquetas: el nombre cambió, la etiqueta física ya no coincide ---- */
    if(renombrar){
      await etqRenombrar(dataCaja.caja || ubicacion.split("-").pop(), nombreViejo, nuevoNombre);
      for(const c of otrasActualizadas){
        await etqRenombrar(c.caja || String(c.ubicacion).split("-").pop(), nombreViejo, nuevoNombre);
      }
    }

    /* ---- historial ---- */
    const delta = r.cantidad - cantAntes;

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ACTUALIZACION",
      ubicacion,
      nombre: nuevoNombre,
      cantidad: r.cantidad,
      responsable: getUser(),
      comentarios: `Editado por administrador (${cambios.join("; ")})`,
      delta,
      sinFila: delta === 0
    });

    for(const c of otrasActualizadas){
      await addHist({
        ts: Date.now(),
        sid: SESION_ID,
        fecha: new Date().toLocaleString(),
        accion: "ACTUALIZACION",
        ubicacion: c.ubicacion,
        nombre: nuevoNombre,
        cantidad: 0,
        responsable: getUser(),
        comentarios: `Editado por administrador (${[renombrar ? `nombre "${nombreViejo}" → "${nuevoNombre}"` : "", pnCambio ? `PN → "${pnNuevo}"` : "", medidaCambio ? `medida → "${medidaNueva}"` : ""].filter(Boolean).join("; ")})`,
        sinFila: true
      });
    }

    await loadCajas(true);
    if(typeof window.showStock === "function") window.showStock(true);
    if(typeof window.renderRacksPage === "function") window.renderRacksPage();

    alert(otrasActualizadas.length
      ? `Material actualizado en esta caja y en ${otrasActualizadas.length} caja(s) más`
      : "Material actualizado");

  }catch(e){
    console.error(e);
    alert("Error editando material");
  }

};

/* Catálogo único de materiales (nombre + PN) usado por el autocompletado
   del formulario de Entrada y por las cajas del visor 3D */
window.getMaterialesCatalogo = function(){
  const vistos = new Map();
  cacheCajas.forEach(c=>{
    (c.componentes||[]).forEach(comp=>{
      if(!comp || !comp.nombre) return;
      const key = String(comp.nombre).toLowerCase().trim();
      const actual = vistos.get(key);
      const tienePn = comp.pn && comp.pn !== "NO APLICA";
      if(!actual || (tienePn && (!actual.pn || actual.pn === "NO APLICA"))){
        vistos.set(key, { nombre: comp.nombre, pn: comp.pn || "NO APLICA", medida: comp.medida || (actual && actual.medida) || "" });
      } else if(!actual.medida && comp.medida){
        actual.medida = comp.medida;
      }
    });
  });
  return Array.from(vistos.values());
};

/* =====================
CATEGORÍA DE MATERIALES — clasificar, listar y filtrar
===================== */

window.setCategoriaMaterial = async function(ubicacion, nombreMaterial, categoria){

  categoria = String(categoria || "");

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);
    if(!cajaSnap.exists()){ alert("La caja ya no existe"); return false; }

    let componentes = cajaSnap.data().componentes || [];
    const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === String(nombreMaterial).toLowerCase());
    if(idx < 0){ alert("Ese material ya no está en esa caja"); return false; }

    componentes[idx].categoria = categoria;
    await updateDoc(cajaRef, { componentes });

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);

    return true;

  }catch(e){
    console.error(e);
    alert("Error guardando la categoría");
    return false;
  }

};

/* Lista todas las ocurrencias de material (una fila por material por caja),
   filtrando opcionalmente por texto de búsqueda y/o categoría exacta.
   Usada por la sección "Categoría de materiales". */
window.listarOcurrenciasPorCategoria = async function(query, categoria){

  await loadCajas();

  query = String(query || "").toLowerCase().trim();
  categoria = String(categoria || "");

  const resultados = [];

  cacheCajas.forEach(c=>{
    (c.componentes||[]).forEach(comp=>{
      const nombre = String(comp.nombre || "");
      const pn = String(comp.pn || "");
      const cat = String(comp.categoria || "");

      if(categoria && categoria !== "__sin__" && cat !== categoria) return;
      if(categoria === "__sin__" && cat) return;

      if(query){
        const matchTexto =
          nombre.toLowerCase().includes(query) ||
          (pn && pn.toLowerCase() !== "no aplica" && pn.toLowerCase().includes(query)) ||
          String(c.ubicacion || "").toLowerCase().includes(query) ||
          cat.toLowerCase().includes(query);
        if(!matchTexto) return;
      }

      resultados.push({
        ubicacion: c.ubicacion, rack: c.rack, nivel: c.nivel, slot: c.slot, caja: c.caja || c.ubicacion,
        nombre: comp.nombre, pn: comp.pn || "NO APLICA", cantidad: comp.cantidad || 0,
        categoria: cat
      });
    });
  });

  resultados.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));

  return resultados;
};

/* =====================================================
ENTRADAS / SALIDAS RÁPIDAS DESDE EL VISOR 3D
Usan exactamente la misma lógica y el mismo historial
que las páginas de Entrada y Salida.
===================================================== */

window.entradaRapida = async function(ubicacion, nombre, pn, cantidad, comentarios, categoria, medida){

  nombre = String(nombre || "").trim().toUpperCase();
  pn = String(pn || "").trim().toUpperCase();
  cantidad = parseInt(cantidad);
  comentarios = String(comentarios || "NO APLICA").toUpperCase();
  categoria = categoria || "";
  medida = String(medida || "").trim().toUpperCase();

  if(!ubicacion || !nombre || isNaN(cantidad) || cantidad <= 0){
    alert("Datos inválidos");
    return false;
  }

  // Si no se especificó PN, se busca coincidencia con un material ya
  // existente en cualquier caja del almacén para reconocerlo como el
  // mismo material (mismo nombre) y heredar su número de parte.
  if(!pn){
    const catalogo = window.getMaterialesCatalogo();
    const match = catalogo.find(m => m.nombre.toLowerCase() === nombre.toLowerCase());
    pn = (match && match.pn && match.pn !== "NO APLICA") ? String(match.pn).toUpperCase() : "NO APLICA";
  }
  if(!medida){
    const mm = window.getMaterialesCatalogo().find(m => String(m.nombre).toLowerCase() === nombre.toLowerCase());
    medida = (mm && mm.medida) ? String(mm.medida).toUpperCase() : "";
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("Esa caja ya no existe.");
      return false;
    }

    let componentes = cajaSnap.data().componentes || [];
    const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === nombre.toLowerCase());

    if(idx >= 0){
      componentes[idx].nombre = nombre;
      componentes[idx].cantidad = (componentes[idx].cantidad || 0) + cantidad;
      componentes[idx].pn = (pn !== "NO APLICA") ? pn : componentes[idx].pn;
      componentes[idx].comentarios = comentarios;
      componentes[idx].responsable = getUser();
      if(categoria) componentes[idx].categoria = categoria;
      if(medida) componentes[idx].medida = medida;
    } else {
      componentes.push({ nombre, pn, cantidad, comentarios, responsable: getUser(), categoria, medida });
    }

    await updateDoc(cajaRef, { componentes });

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ENTRADA",
      ubicacion,
      nombre,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);

    return true;

  }catch(e){
    console.error(e);
    alert("Error registrando entrada");
    return false;
  }

};

window.salidaRapida = async function(ubicacion, nombre, cantidad, comentarios){

  nombre = String(nombre || "").trim();
  cantidad = parseInt(cantidad);
  comentarios = comentarios || "NO APLICA";

  if(!ubicacion || !nombre || isNaN(cantidad) || cantidad <= 0){
    alert("Datos inválidos");
    return false;
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return false;
    }

    let componentes = cajaSnap.data().componentes || [];
    const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === nombre.toLowerCase());

    if(idx < 0){
      alert("Ese componente ya no está en esa caja");
      return false;
    }

    if((componentes[idx].cantidad || 0) < cantidad){
      alert("Sin stock suficiente. Disponible: " + componentes[idx].cantidad);
      return false;
    }

    componentes[idx].cantidad -= cantidad;
    if(componentes[idx].cantidad <= 0) componentes.splice(idx,1);

    await updateDoc(cajaRef, { componentes });

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "SALIDA",
      ubicacion,
      nombre,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);

    return true;

  }catch(e){
    console.error(e);
    alert("Error registrando salida");
    return false;
  }

};

/* STATUS MANUAL DE UNA CAJA (poco contenido / medio / llena) */
window.setEstadoCaja = async function(ubicacion, estado){

  const validos = ["vacia","bajo","medio","lleno"];
  estado = String(estado || "").toLowerCase();

  if(!ubicacion || !validos.includes(estado)){
    alert("Status inválido");
    return false;
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return false;
    }

    await updateDoc(cajaRef, { estado });
    await loadCajas(true);

    return true;

  }catch(e){
    console.error(e);
    alert("Error actualizando el status de la caja");
    return false;
  }

};

/* TAMAÑO FÍSICO DE UNA CAJA (chica / mediana / grande) — independiente del status */
window.setTamanoCaja = async function(ubicacion, tamano){

  const validos = ["chica","mediana","grande"];
  tamano = String(tamano || "").toLowerCase();

  if(!ubicacion || !validos.includes(tamano)){
    alert("Tamaño inválido");
    return false;
  }

  try{

    const cajaRef = doc(db,"cajas",ubicacion);
    const cajaSnap = await getDoc(cajaRef);

    if(!cajaSnap.exists()){
      alert("La caja no existe");
      return false;
    }

    await updateDoc(cajaRef, { tamano });
    await loadCajas(true);

    return true;

  }catch(e){
    console.error(e);
    alert("Error actualizando el tamaño de la caja");
    return false;
  }

};

/* datos en vivo para el visor 3D */
window.getDatosAlmacen = function(){
  return { racks: cacheRacks, cajas: cacheCajas };
};

/* =====================
   MATERIAL DE MIGRACIÓN — acomodo de cajas pendientes
   ===================== */

/* Lista de cajas pendientes de acomodar (ordenadas por número de caja). */
window.getCajasPendientes = function(){
  return cacheCajas
    .filter(esCajaPendiente)
    .sort((a,b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion), undefined, { numeric:true }));
};

/* Consulta un número de caja y dice en qué situación está:
     "pendiente"  → es de migración y falta acomodarla (devuelve su contenido)
     "acomodada"  → era de migración y ya está en un rack
     "nueva"      → es material nuevo (no aplica el acomodo)
     "noexiste"   → no hay ninguna caja con ese número */
window.consultarCajaMigracion = function(numero){

  const n = normCaja(numero);
  if(!n) return { estado:"vacio" };

  const coincidencias = cacheCajas.filter(c => normCaja(c.caja || "") === n);
  if(coincidencias.length === 0) return { estado:"noexiste", numero:n };

  const pend = coincidencias.find(esCajaPendiente);
  if(pend){
    const comps = (pend.componentes || []).map(x => ({
      nombre: x.nombre, pn: x.pn, cantidad: Number(x.cantidad) || 0, categoria: x.categoria || ""
    }));
    return {
      estado:"pendiente", numero:n, ubicacionActual: pend.ubicacion, caja: pend.caja || n,
      componentes: comps,
      total: comps.reduce((t,x) => t + x.cantidad, 0)
    };
  }

  const c = coincidencias[0];
  if(c.acomodada === true) return { estado:"acomodada", numero:n, ubicacion:c.ubicacion };
  return { estado:"nueva", numero:n, ubicacion:c.ubicacion };
};

/* Asigna una caja de migración a su posición real (rack / nivel / slot).
   Crea la caja en la nueva posición con TODO su contenido y datos (estado,
   tamaño, categorías...), la marca como acomodada y borra el registro
   pendiente — todo en una sola operación atómica. Desde ese momento
   desaparece del área de pendientes y aparece dentro del rack. */
window.acomodarCajaMigrada = async function(ubicacionActual, rack, nivel, slot){

  if(!ubicacionActual || !rack || !nivel || !slot){
    alert("Falta la posición de destino (rack, nivel y slot)");
    return false;
  }

  try{

    await loadRacks(true);
    const rackInfo = cacheRacks.find(r => r.nombre === rack);
    if(!rackInfo || rackInfo.status !== "active"){
      alert(`El rack ${rack} no existe o está inactivo`);
      return false;
    }
    if(Number(nivel) < 1 || Number(nivel) > Number(rackInfo.niveles) ||
       Number(slot)  < 1 || Number(slot)  > Number(rackInfo.slots)){
      alert("Esa posición no existe en el rack");
      return false;
    }

    const origenRef = doc(db,"cajas",ubicacionActual);
    const origenSnap = await getDoc(origenRef);

    if(!origenSnap.exists() || !esCajaPendiente(origenSnap.data())){
      alert("Esta caja ya fue acomodada (o ya no está pendiente). Se actualizará la vista.");
      await loadCajas(true);
      if(typeof window.renderRacksPage === "function") await window.renderRacksPage();
      return false;
    }

    const datos = origenSnap.data();
    const cajaId = normCaja(datos.caja || datos.ubicacion);
    const ubicacionNueva = buildUbicacion(rack, nivel, slot, cajaId);

    const destinoRef = doc(db,"cajas",ubicacionNueva);

    if(ubicacionNueva !== ubicacionActual){
      const destinoSnap = await getDoc(destinoRef);
      if(destinoSnap.exists()){
        alert(`Ya existe un registro en ${ubicacionNueva}`);
        return false;
      }
    }

    const nuevaCaja = {
      ...datos,
      rack, nivel: parseInt(nivel), slot: parseInt(slot),
      caja: cajaId, ubicacion: ubicacionNueva,
      componentes: datos.componentes || [],
      migracion: true,
      acomodada: true,
      acomodadaPor: getUser(),
      acomodadaEn: Date.now()
    };

    const lote = writeBatch(db);
    lote.set(destinoRef, nuevaCaja);                         // si el id no cambia, solo se actualiza
    if(ubicacionNueva !== ubicacionActual) lote.delete(origenRef);
    await lote.commit();

    const totalPiezas = (datos.componentes || []).reduce((t,x) => t + (Number(x.cantidad)||0), 0);

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ACOMODO CAJA",
      ubicacion: `CAJA ${cajaId} (PENDIENTE) → ${ubicacionNueva}`,
      nombre: "Caja de migración",
      cantidad: totalPiezas,
      responsable: getUser(),
      comentarios: "ACOMODO DE MATERIAL DE MIGRACION",
      sinFila: true
    });

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();

    return ubicacionNueva;

  }catch(e){
    console.error(e);
    alert("Error acomodando la caja");
    return false;
  }

};

/* =====================
RENDER PÁGINA RACKS & CAJAS
===================== */

window.renderRacksPage = async function(){

  const tablaRacks = document.getElementById("tablaRacks");
  const contBoxes = document.getElementById("cajasPorUbicacion");
  const contadorRacks = document.getElementById("contadorRacks");

  if(!tablaRacks) return;

  await loadRacks();

  // Esta configuración conserva todas las cajas y su contenido; solo ajusta
  // el estado de los racks para dejar A como único rack activo.
  if (isAdmin() && cacheRacks.some(r => r.nombre === "A")) {
    let cambioEstado = false;
    for (const rack of cacheRacks) {
      const estadoDeseado = rack.nombre === "A" ? "active" : "inactive";
      if (rack.status !== estadoDeseado) {
        await updateDoc(doc(db, "racks", rack.nombre), { status: estadoDeseado });
        cambioEstado = true;
      }
    }
    if (cambioEstado) await loadRacks(true);
  }

  await loadCajas();

  if(contadorRacks) contadorRacks.innerText = cacheRacks.length;

  // ---- tabla de racks ----
  let html = "";

  cacheRacks.forEach(r=>{

    const cajasDelRack = cacheCajas.filter(c => c.rack === r.nombre && !esCajaPendiente(c));
    const totalCajas = cajasDelRack.length;
    const conContenido = cajasDelRack.filter(c => (c.componentes||[]).length > 0).length;

    const badge = r.status === "active"
      ? `<span class="badge badge-active">Active</span>`
      : `<span class="badge badge-inactive">Inactive</span>`;

    html += `
<tr>
<td><b>${r.nombre}</b></td>
<td>${r.niveles}</td>
<td>${r.slots}</td>
<td>${totalCajas}</td>
<td>${conContenido}/${totalCajas}</td>
<td>${badge}</td>
<td>
<button class="btn-outline" onclick="toggleRackStatus('${r.nombre}')">${r.status === "active" ? "Desactivar" : "Activar"}</button>
${isAdmin() ? `<button class="btn-danger" onclick="eliminarRack('${r.nombre}')">🗑</button>` : ""}
</td>
</tr>`;
  });

  tablaRacks.innerHTML = html || `<tr><td colspan="7" style="color:var(--ink-soft);">Aún no hay racks registrados</td></tr>`;

  // ---- grid de cajas por ubicación (solo racks activos) ----
  if(contBoxes){

    let gridHtml = "";

    cacheRacks.filter(r => r.status === "active").forEach(r=>{

      gridHtml += `<div class="rack-block">
<div class="rack-block-head">📦 Rack ${r.nombre} <span>${r.niveles} niveles × ${r.slots} slots</span></div>`;

      for(let n=1; n<=r.niveles; n++){

        gridHtml += `<div class="level-label">Nivel ${pad2(n)}</div><div class="slot-grid">`;

        for(let s=1; s<=r.slots; s++){

          const slotLabel = `${r.nombre}-${pad2(n)}-${pad2(s)}`;
          const cajas = cajasDeSlot(r.nombre, n, s)
            .sort((a,b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion)));

          gridHtml += `
<div class="slot-card">
<div class="slot-card-top">
<b>Slot ${slotLabel}</b>
<button class="slot-add" title="Agregar caja" onclick="crearCajaEnSlot('${r.nombre}',${n},${s})">+</button>
</div>`;

          if(cajas.length === 0){
            gridHtml += `<div class="slot-content"><span class="slot-empty">Sin cajas</span></div>`;
          } else {

            gridHtml += `<div class="caja-list">`;

            cajas.forEach(c=>{

              const cajaLabel = c.caja || c.ubicacion;
              const componentes = c.componentes || [];

              const contenido = componentes.length
                ? componentes.map(comp => `${comp.nombre} ×${comp.cantidad}`).join(", ")
                : `<span class="slot-empty">vacía</span>`;

              gridHtml += `
<div class="caja-item">
<div class="caja-item-top">
<b>Caja ${cajaLabel}</b>
<span class="caja-actions">
<button class="slot-add" title="Agregar componente" onclick="irAEntrada('${c.ubicacion}')">+</button>
${isAdmin() ? `<button class="slot-add slot-del" title="Eliminar caja" onclick="eliminarCaja('${c.ubicacion}')">×</button>` : ""}
</span>
</div>
<div class="slot-content">${contenido}</div>
</div>`;

            });

            gridHtml += `</div>`;
          }

          gridHtml += `</div>`;
        }

        gridHtml += `</div>`;
      }

      gridHtml += `</div>`;
    });

    contBoxes.innerHTML = gridHtml || `<p style="color:var(--ink-soft);">No hay racks activos para mostrar.</p>`;
  }

  // ---- VISOR 3D (misma información, en tiempo real) ----
  if(window.Rack3D && typeof window.Rack3D.rebuild === "function"){
    const activos = cacheRacks.filter(r => r.status === "active");
    window.Rack3D.rebuild(activos, cacheCajas, true);

    const infoCajas = document.getElementById("contadorCajas3D");
    if(infoCajas){
      const pendientes = cacheCajas.filter(esCajaPendiente);
      const cajasEnRacks = cacheCajas.filter(c => !esCajaPendiente(c) && activos.some(r => r.nombre === c.rack));
      const cajasDelArea = cajasEnRacks.concat(pendientes);   // el material pendiente también está físicamente en el área
      const totalCajas = cajasEnRacks.length;

      const materialesArea = new Set();
      cajasDelArea.forEach(c => (c.componentes||[]).forEach(x => {
        if(x && x.nombre) materialesArea.add(String(x.nombre).toLowerCase().trim());
      }));

      await loadToolCrib();
      const materialesToolCrib = cacheToolCrib.length;

      const plural = (n, uno, varios) => n === 1 ? uno : varios;
      infoCajas.innerHTML =
        `<span class="stat-chip"><i class="dot dot-cajas"></i><b>${totalCajas}</b><em>${plural(totalCajas, "caja", "cajas")}</em></span>` +
        (pendientes.length ? `<span class="stat-chip"><i class="dot dot-pend"></i><b>${pendientes.length}</b><em>${plural(pendientes.length, "caja pendiente", "cajas pendientes")} de acomodar</em></span>` : "") +
        `<span class="stat-chip"><i class="dot dot-area"></i><b>${materialesArea.size}</b><em>${plural(materialesArea.size, "material distinto", "materiales distintos")} en el área</em></span>` +
        `<span class="stat-chip"><i class="dot dot-tool"></i><b>${materialesToolCrib}</b><em>${plural(materialesToolCrib, "material distinto", "materiales distintos")} en Tool Crib</em></span>`;
    }
  }

};

window.irAEntrada = function(ubicacion){

  const caja = cacheCajas.find(c => c.ubicacion === ubicacion);

  if(!caja){
    window.location.href = "entrada.html";
    return;
  }

  window.location.href = `entrada.html?rack=${encodeURIComponent(caja.rack)}&nivel=${caja.nivel}&slot=${caja.slot}&caja=${encodeURIComponent(caja.caja || "")}`;
};

/* =====================
IMPRIMIR ETIQUETAS
===================== */

window.printLabels = async function(){

  await loadRacks();
  await loadCajas();

  const activos = cacheRacks.filter(r => r.status === "active");

  if(activos.length === 0){
    alert("No hay racks activos para imprimir etiquetas");
    return;
  }

  const nombresActivos = new Set(activos.map(r => r.nombre));

  const cajasActivas = cacheCajas
    .filter(c => !esCajaPendiente(c) && nombresActivos.has(c.rack))
    .sort((a,b) => a.ubicacion.localeCompare(b.ubicacion));

  if(cajasActivas.length === 0){
    alert("Todavía no hay cajas creadas. Agrégalas primero desde esta página.");
    return;
  }

  let etiquetas = "";

  cajasActivas.forEach(c=>{
    etiquetas += `<div class="etiqueta">${c.ubicacion}</div>`;
  });

  const ventana = window.open("", "_blank");
  ventana.document.write(`
<html><head><title>Etiquetas L10 ALMACEN</title>
<style>
body{ font-family:'Courier New',monospace; margin:20px; }
.etiqueta{
  display:inline-block; width:150px; height:80px; border:2px solid #000;
  border-radius:6px; margin:6px; text-align:center; line-height:80px;
  font-size:22px; font-weight:700;
}
@media print{ .etiqueta{ page-break-inside:avoid; } }
</style></head>
<body>${etiquetas}</body></html>
`);

  ventana.document.close();
  ventana.focus();
  ventana.print();
};

/* =====================
SELECTORES RACK / NIVEL / SLOT (entrada.html)
===================== */

window.initUbicacionSelectors = async function(){

  const rackSelect = document.getElementById("rackSelect");
  const nivelSelect = document.getElementById("nivelSelect");
  const slotSelect = document.getElementById("slotSelect");
  const cajaSelect = document.getElementById("cajaSelect");
  const cajaDisplay = document.getElementById("cajaDisplay");

  if(!rackSelect) return;

  await loadRacks();
  await loadCajas();

  const activos = cacheRacks.filter(r => r.status === "active");

  rackSelect.innerHTML = `<option value="">Seleccionar rack</option>` +
    activos.map(r => `<option value="${r.nombre}">Rack ${r.nombre}</option>`).join("");

  function actualizarCajas(){

    cajaSelect.innerHTML = `<option value="">Caja</option>`;
    cajaDisplay.value = "";

    if(!rackSelect.value || !nivelSelect.value || !slotSelect.value) return;

    const cajas = cajasDeSlot(rackSelect.value, nivelSelect.value, slotSelect.value)
      .sort((a,b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion)));

    if(cajas.length === 0){
      cajaSelect.innerHTML = `<option value="">Sin cajas — créala en Racks y Cajas</option>`;
      return;
    }

    cajas.forEach(c=>{
      cajaSelect.innerHTML += `<option value="${c.ubicacion}">Caja ${c.caja || c.ubicacion}</option>`;
    });
  }

  function actualizarDisplay(){
    if(!cajaSelect.value){ cajaDisplay.value = ""; return; }
    const c = cacheCajas.find(x => x.ubicacion === cajaSelect.value);
    cajaDisplay.value = c ? `${c.ubicacion} (caja ${c.caja || c.ubicacion})` : cajaSelect.value;
  }

  rackSelect.onchange = () => {
    const rack = activos.find(r => r.nombre === rackSelect.value);

    nivelSelect.innerHTML = `<option value="">Nivel</option>`;
    slotSelect.innerHTML = `<option value="">Slot</option>`;

    if(rack){
      for(let n=1; n<=rack.niveles; n++){
        nivelSelect.innerHTML += `<option value="${n}">Nivel ${pad2(n)}</option>`;
      }
      for(let s=1; s<=rack.slots; s++){
        slotSelect.innerHTML += `<option value="${s}">Slot ${pad2(s)}</option>`;
      }
    }

    actualizarCajas();
  };

  nivelSelect.onchange = actualizarCajas;
  slotSelect.onchange = actualizarCajas;
  cajaSelect.onchange = actualizarDisplay;

  // 🔥 precargar desde parámetros de URL (llegando desde racks.html)
  const params = new URLSearchParams(window.location.search);
  const rackParam = params.get("rack");
  const nivelParam = params.get("nivel");
  const slotParam = params.get("slot");
  const cajaParam = params.get("caja");

  if(rackParam){
    rackSelect.value = rackParam;
    rackSelect.onchange();

    if(nivelParam) nivelSelect.value = nivelParam;
    if(slotParam) slotSelect.value = slotParam;

    actualizarCajas();

    if(cajaParam){
      const match = cajasDeSlot(rackParam, nivelParam, slotParam)
        .find(c => String(c.caja || c.ubicacion) === String(cajaParam));
      if(match) cajaSelect.value = match.ubicacion;
    }

    actualizarDisplay();
  }

};

/* =========================================================
   MOVIMIENTOS — sección nueva (movimientos.html)
   -----------------------------------------------------------
   Tres capacidades, todas sobre las mismas colecciones reales:
     1) Mover un material de una caja a otra ("cambiar de caja").
     2) Enviar un material al Tool Crib (colección aparte,
        agregada por material, no por caja).
     3) Mover una caja completa de rack/nivel/slot a otro.
   ========================================================= */

/* Selector genérico de Rack → Nivel → Slot (→ Caja opcional).
   Se puede instanciar varias veces en la misma página con distintos
   ids (origen/destino) sin que se pisen entre sí. */
window.initSelectorGrupo = async function(ids){

  const rackSelect = document.getElementById(ids.rack);
  const nivelSelect = document.getElementById(ids.nivel);
  const slotSelect = document.getElementById(ids.slot);
  const cajaSelect = ids.caja ? document.getElementById(ids.caja) : null;

  if(!rackSelect || !nivelSelect || !slotSelect) return;

  await loadRacks();
  await loadCajas();

  const activos = cacheRacks.filter(r => r.status === "active");

  rackSelect.innerHTML = `<option value="">Rack</option>` +
    activos.map(r => `<option value="${r.nombre}">Rack ${r.nombre}</option>`).join("");

  function actualizarNivelesSlots(){
    const rack = activos.find(r => r.nombre === rackSelect.value);

    nivelSelect.innerHTML = `<option value="">Nivel</option>`;
    slotSelect.innerHTML = `<option value="">Slot</option>`;
    if(cajaSelect) cajaSelect.innerHTML = `<option value="">Caja</option>`;

    if(rack){
      for(let n=1; n<=rack.niveles; n++){
        nivelSelect.innerHTML += `<option value="${n}">Nivel ${pad2(n)}</option>`;
      }
      for(let s=1; s<=rack.slots; s++){
        slotSelect.innerHTML += `<option value="${s}">Slot ${pad2(s)}</option>`;
      }
    }
  }

  function actualizarCajas(){
    if(!cajaSelect) return;
    cajaSelect.innerHTML = `<option value="">Caja</option>`;
    if(!rackSelect.value || !nivelSelect.value || !slotSelect.value) return;

    const cajas = cajasDeSlot(rackSelect.value, nivelSelect.value, slotSelect.value)
      .sort((a,b) => String(a.caja || a.ubicacion).localeCompare(String(b.caja || b.ubicacion), undefined, {numeric:true}));

    if(cajas.length === 0){
      cajaSelect.innerHTML = `<option value="">Sin cajas en este slot</option>`;
      return;
    }

    cajas.forEach(c=>{
      cajaSelect.innerHTML += `<option value="${c.ubicacion}">Caja ${c.caja || c.ubicacion}</option>`;
    });
  }

  rackSelect.onchange = () => { actualizarNivelesSlots(); actualizarCajas(); };
  nivelSelect.onchange = actualizarCajas;
  slotSelect.onchange = actualizarCajas;
};

/* Devuelve la ubicación armada a partir de un grupo rack/nivel/slot
   (sin caja): usado para el destino al mover una caja completa. */
window.leerRackNivelSlot = function(ids){
  const rack = document.getElementById(ids.rack)?.value || "";
  const nivel = document.getElementById(ids.nivel)?.value || "";
  const slot = document.getElementById(ids.slot)?.value || "";
  return { rack, nivel, slot };
};

/* =====================
   1) BUSCADOR GLOBAL DE MATERIALES (por nombre, PN o número de caja)
   Usado tanto por "Movimiento entre cajas" como por "Tool Crib".
   ===================== */
window.buscarOcurrenciasMaterial = async function(query){

  await loadCajas();

  query = String(query || "").toLowerCase().trim();
  if(!query) return [];

  const resultados = [];

  cacheCajas.forEach(c=>{
    (c.componentes || []).forEach(comp=>{
      const nombre = String(comp.nombre || "");
      const pn = String(comp.pn || "");
      const matchNombre = nombre.toLowerCase().includes(query) ||
        (pn && pn.toLowerCase() !== "no aplica" && pn.toLowerCase().includes(query));
      const matchCaja = String(c.ubicacion || "").toLowerCase().includes(query) ||
        String(c.caja || "").toLowerCase().includes(query);

      if(matchNombre || matchCaja){
        resultados.push({
          ubicacion: c.ubicacion,
          rack: c.rack, nivel: c.nivel, slot: c.slot, caja: c.caja || c.ubicacion,
          nombre: comp.nombre, pn: comp.pn, cantidad: comp.cantidad
        });
      }
    });
  });

  return resultados.slice(0, 30);
};

/* =====================
   2) MOVER MATERIAL DE UNA CAJA A OTRA
   Descuenta (o borra) el material en la caja de origen y lo suma
   (o crea) en la caja de destino. Cambia por completo su registro
   de ubicación. Queda registrado en Historial.
   ===================== */
window.moverMaterialEntreCajas = async function(ubicacionOrigen, nombreMaterial, ubicacionDestino, cantidad, comentarios){

  nombreMaterial = String(nombreMaterial || "").trim();
  cantidad = parseInt(cantidad);
  comentarios = comentarios || "NO APLICA";

  if(!ubicacionOrigen || !ubicacionDestino || !nombreMaterial || isNaN(cantidad) || cantidad <= 0){
    alert("Selecciona material, cantidad y destino válidos");
    return false;
  }

  if(ubicacionOrigen === ubicacionDestino){
    alert("El origen y el destino son la misma caja");
    return false;
  }

  try{

    const origenRef = doc(db,"cajas",ubicacionOrigen);
    const origenSnap = await getDoc(origenRef);
    if(!origenSnap.exists()){ alert("La caja de origen ya no existe"); return false; }

    const destinoRef = doc(db,"cajas",ubicacionDestino);
    const destinoSnap = await getDoc(destinoRef);
    if(!destinoSnap.exists()){ alert("La caja de destino ya no existe"); return false; }

    let compOrigen = origenSnap.data().componentes || [];
    const idxOrigen = compOrigen.findIndex(c => String(c.nombre).toLowerCase() === nombreMaterial.toLowerCase());

    if(idxOrigen < 0){ alert("Ese material ya no está en la caja de origen"); return false; }
    if((compOrigen[idxOrigen].cantidad || 0) < cantidad){
      alert("Sin stock suficiente en el origen. Disponible: " + compOrigen[idxOrigen].cantidad);
      return false;
    }

    const pnMaterial = compOrigen[idxOrigen].pn || "NO APLICA";
    const medidaMaterial = compOrigen[idxOrigen].medida || "";

    compOrigen[idxOrigen].cantidad -= cantidad;
    if(compOrigen[idxOrigen].cantidad <= 0) compOrigen.splice(idxOrigen,1);

    let compDestino = destinoSnap.data().componentes || [];
    const idxDestino = compDestino.findIndex(c => String(c.nombre).toLowerCase() === nombreMaterial.toLowerCase());

    if(idxDestino >= 0){
      compDestino[idxDestino].cantidad = (compDestino[idxDestino].cantidad || 0) + cantidad;
      compDestino[idxDestino].responsable = getUser();
    } else {
      compDestino.push({
        nombre: nombreMaterial, pn: pnMaterial, cantidad,
        comentarios, responsable: getUser(), medida: medidaMaterial
      });
    }

    await updateDoc(origenRef, { componentes: compOrigen });
    await updateDoc(destinoRef, { componentes: compDestino });

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "MOVIMIENTO MATERIAL",
      ubicacion: `${ubicacionOrigen} → ${ubicacionDestino}`,
      nombre: nombreMaterial,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    await loadCajas(true);
    if(typeof window.showStock === "function") await window.showStock(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();

    alert(`Material movido de ${ubicacionOrigen} a ${ubicacionDestino}`);
    return true;

  }catch(e){
    console.error(e);
    alert("Error moviendo el material");
    return false;
  }

};

/* =====================
   3) TOOL CRIB — envío de materiales
   Colección aparte ("toolcrib"), un documento por material
   (agregado, no por caja). Descuenta del origen igual que una salida.
   ===================== */

let cacheToolCrib = [];
let cacheScrap = [];

function claveMaterial(nombre){
  return String(nombre || "").toLowerCase().trim().replace(/[\/\\]/g,"-");
}

async function loadToolCrib(force){
  if(!force && cacheToolCrib.length > 0) return cacheToolCrib;
  const snapshot = await getDocs(collection(db,"toolcrib"));
  cacheToolCrib = snapshot.docs.map(d => ({ idDoc:d.id, ...d.data() }));
  cacheToolCrib.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  return cacheToolCrib;
}

async function loadScrap(force){
  if(!force && cacheScrap.length > 0) return cacheScrap;
  const snapshot = await getDocs(collection(db,"scrap"));
  cacheScrap = snapshot.docs.map(d => ({ idDoc:d.id, ...d.data() }));
  cacheScrap.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  return cacheScrap;
}

/* Intenta liberar (borrar) una caja que se quedó vacía después de mover su
   material. Si le queda otro material, ofrece moverlo a otra caja para
   poder liberar esta. Devuelve true si la caja terminó libre/borrada. */
async function intentarLiberarCaja(ubicacion){

  const ref = doc(db,"cajas",ubicacion);
  const snap = await getDoc(ref);
  if(!snap.exists()) return true;

  let componentes = snap.data().componentes || [];

  if(componentes.length === 0){
    await deleteDoc(ref);
    return true;
  }

  const otros = componentes.map(c => `${c.nombre} (${c.cantidad})`).join(", ");
  const mover = confirm(
    `La caja ${ubicacion} todavía tiene otro material: ${otros}.\n` +
    `No puedes llevarte la caja vacía si sigue teniendo material.\n\n` +
    `¿Quieres mover ese material restante a otra caja para poder liberar esta?`
  );
  if(!mover) return false;

  const destino = prompt("¿A qué caja quieres mover el material restante? (formato RACK-NIVEL-SLOT-CAJA)");
  if(!destino || !destino.trim()) return false;

  const destinoUb = destino.trim().toUpperCase();
  if(destinoUb === ubicacion){ alert("Elige una caja distinta a la de origen"); return false; }

  for(const c of [...componentes]){
    await window.moverMaterialEntreCajas(ubicacion, c.nombre, destinoUb, c.cantidad, "Reubicado para liberar la caja de origen");
  }

  const freshSnap = await getDoc(ref);
  if(freshSnap.exists() && (freshSnap.data().componentes||[]).length === 0){
    await deleteDoc(ref);
    return true;
  }

  return false;
}

/* =====================
   ENVÍO A TOOL CRIB
   conservarCaja = true  → la caja se queda en el rack (aunque quede vacía).
   conservarCaja = false → se intenta liberar/borrar la caja del rack; si
   tiene otro material, se ofrece reubicarlo primero (ver intentarLiberarCaja).
   ===================== */
window.enviarATooCrib = async function(ubicacionOrigen, nombreMaterial, cantidad, comentarios, conservarCaja){

  nombreMaterial = String(nombreMaterial || "").trim();
  cantidad = parseInt(cantidad);
  comentarios = comentarios || "NO APLICA";
  conservarCaja = (conservarCaja === false) ? false : true;

  if(!ubicacionOrigen || !nombreMaterial || isNaN(cantidad) || cantidad <= 0){
    alert("Selecciona material y cantidad válidos");
    return false;
  }

  try{

    const origenRef = doc(db,"cajas",ubicacionOrigen);
    const origenSnap = await getDoc(origenRef);
    if(!origenSnap.exists()){ alert("La caja de origen ya no existe"); return false; }

    let componentes = origenSnap.data().componentes || [];
    const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === nombreMaterial.toLowerCase());

    if(idx < 0){ alert("Ese material ya no está en esa caja"); return false; }
    if((componentes[idx].cantidad || 0) < cantidad){
      alert("Sin stock suficiente. Disponible: " + componentes[idx].cantidad);
      return false;
    }

    const pnMaterial = componentes[idx].pn || "NO APLICA";

    componentes[idx].cantidad -= cantidad;
    if(componentes[idx].cantidad <= 0) componentes.splice(idx,1);

    await updateDoc(origenRef, { componentes });

    const key = claveMaterial(nombreMaterial);
    const cribRef = doc(db,"toolcrib",key);
    const cribSnap = await getDoc(cribRef);

    if(cribSnap.exists()){
      await updateDoc(cribRef, {
        cantidad: (cribSnap.data().cantidad || 0) + cantidad,
        pn: (pnMaterial && pnMaterial !== "NO APLICA") ? pnMaterial : (cribSnap.data().pn || "NO APLICA"),
        ultimaUbicacion: ubicacionOrigen,
        responsable: getUser(),
        comentarios,
        fecha: new Date().toLocaleString()
      });
    } else {
      await setDoc(cribRef, {
        nombre: nombreMaterial, pn: pnMaterial, cantidad,
        ultimaUbicacion: ubicacionOrigen,
        responsable: getUser(),
        comentarios,
        fecha: new Date().toLocaleString()
      });
    }

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ENVIO TOOL CRIB",
      ubicacion: ubicacionOrigen,
      nombre: nombreMaterial,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    let cajaLiberada = false;
    if(!conservarCaja){
      cajaLiberada = await intentarLiberarCaja(ubicacionOrigen);
    }

    await loadCajas(true);
    await loadToolCrib(true);
    if(typeof window.showStock === "function") await window.showStock(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();
    if(typeof window.renderToolCrib === "function") await window.renderToolCrib(true);

    alert(`${cantidad} × ${nombreMaterial} enviado(s) a Tool Crib` +
      (conservarCaja ? "" : (cajaLiberada ? ". La caja quedó liberada del rack." : ". La caja se conservó porque aún tiene material.")));
    return true;

  }catch(e){
    console.error(e);
    alert("Error enviando material a Tool Crib");
    return false;
  }

};

/* Regresar material del Tool Crib al almacén — total o parcial — hacia
   una caja ya existente o hacia una caja nueva (rack/nivel/slot elegidos). */
window.regresarDeToolCrib = async function(nombreMaterial, cantidad, destino){

  nombreMaterial = String(nombreMaterial || "").trim();
  cantidad = parseInt(cantidad);

  if(!nombreMaterial || isNaN(cantidad) || cantidad <= 0 || !destino){
    alert("Selecciona material, cantidad y destino válidos");
    return false;
  }

  try{

    const key = claveMaterial(nombreMaterial);
    const cribRef = doc(db,"toolcrib",key);
    const cribSnap = await getDoc(cribRef);

    if(!cribSnap.exists()){ alert("Ese material ya no está en Tool Crib"); return false; }

    const cribData = cribSnap.data();
    if((cribData.cantidad || 0) < cantidad){
      alert("Sin stock suficiente en Tool Crib. Disponible: " + cribData.cantidad);
      return false;
    }

    let ubicacionDestino;

    if(destino.nueva){
      const { rack, nivel, slot, caja } = destino.nueva;
      if(!rack || !nivel || !slot || !caja){
        alert("Completa rack, nivel, slot y número de caja del destino nuevo");
        return false;
      }
      ubicacionDestino = buildUbicacion(rack, nivel, slot, normCaja(caja));
      const destSnap = await getDoc(doc(db,"cajas",ubicacionDestino));
      if(destSnap.exists()){ alert("Ya existe una caja con ese número en ese slot"); return false; }

      await setDoc(doc(db,"cajas",ubicacionDestino), {
        rack, nivel: parseInt(nivel), slot: parseInt(slot), caja: normCaja(caja), ubicacion: ubicacionDestino,
        migracion: false,
        componentes: [{
          nombre: nombreMaterial, pn: cribData.pn || "NO APLICA", cantidad,
          comentarios: "Regresado de Tool Crib", responsable: getUser()
        }]
      });

    } else if(destino.existente){
      ubicacionDestino = destino.existente;
      const destRef = doc(db,"cajas",ubicacionDestino);
      const destSnap = await getDoc(destRef);
      if(!destSnap.exists()){ alert("La caja de destino ya no existe"); return false; }

      let componentes = destSnap.data().componentes || [];
      const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === nombreMaterial.toLowerCase());

      if(idx >= 0){
        componentes[idx].cantidad = (componentes[idx].cantidad || 0) + cantidad;
        componentes[idx].responsable = getUser();
      } else {
        componentes.push({
          nombre: nombreMaterial, pn: cribData.pn || "NO APLICA", cantidad,
          comentarios: "Regresado de Tool Crib", responsable: getUser()
        });
      }

      await updateDoc(destRef, { componentes });

    } else {
      alert("Indica si el destino es una caja existente o una caja nueva");
      return false;
    }

    const restante = (cribData.cantidad || 0) - cantidad;
    if(restante <= 0){
      await deleteDoc(cribRef);
    } else {
      await updateDoc(cribRef, { cantidad: restante });
    }

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "REGRESO TOOL CRIB",
      ubicacion: ubicacionDestino,
      nombre: nombreMaterial,
      cantidad,
      responsable: getUser(),
      comentarios: "Regreso desde Tool Crib"
    });

    await loadCajas(true);
    await loadToolCrib(true);
    if(typeof window.showStock === "function") await window.showStock(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();
    if(typeof window.renderToolCrib === "function") await window.renderToolCrib(true);

    alert(`${cantidad} × ${nombreMaterial} regresado(s) al almacén, caja ${ubicacionDestino}`);
    return true;

  }catch(e){
    console.error(e);
    alert("Error regresando material del Tool Crib");
    return false;
  }

};

/* Tabla del Tool Crib — por MATERIAL, no por caja */
window.renderToolCrib = async function(force){

  const tabla = document.getElementById("tablaToolCrib");
  if(!tabla) return;

  await loadToolCrib(force);

  let html = "";

  cacheToolCrib.forEach(m=>{
    html += `
<tr>
<td>${m.nombre || ""}</td>
<td>${(m.pn && m.pn !== "NO APLICA") ? m.pn : "—"}</td>
<td>${m.cantidad || 0}</td>
<td>${m.ultimaUbicacion || ""}</td>
<td>${m.responsable || ""}</td>
<td>${m.comentarios || ""}</td>
<td>${m.fecha || ""}</td>
</tr>`;
  });

  tabla.innerHTML = html || `<tr><td colspan="7" style="color:var(--ink-soft);">Sin materiales en Tool Crib</td></tr>`;

};

window.getToolCribCatalogo = async function(force){
  await loadToolCrib(force);
  return cacheToolCrib;
};

/* =====================
   SCRAP — envío definitivo de material (desde una caja o desde Tool Crib)
   ===================== */
window.enviarAScrap = async function(origenTipo, origenId, nombreMaterial, cantidad, comentarios){

  nombreMaterial = String(nombreMaterial || "").trim();
  cantidad = parseInt(cantidad);
  comentarios = comentarios || "NO APLICA";

  if(!origenTipo || !origenId || !nombreMaterial || isNaN(cantidad) || cantidad <= 0){
    alert("Selecciona material y cantidad válidos");
    return false;
  }

  try{

    let pnMaterial = "NO APLICA";
    let ubicacionTexto = origenId;

    if(origenTipo === "caja"){

      const origenRef = doc(db,"cajas",origenId);
      const origenSnap = await getDoc(origenRef);
      if(!origenSnap.exists()){ alert("La caja de origen ya no existe"); return false; }

      let componentes = origenSnap.data().componentes || [];
      const idx = componentes.findIndex(c => String(c.nombre).toLowerCase() === nombreMaterial.toLowerCase());

      if(idx < 0){ alert("Ese material ya no está en esa caja"); return false; }
      if((componentes[idx].cantidad || 0) < cantidad){
        alert("Sin stock suficiente. Disponible: " + componentes[idx].cantidad);
        return false;
      }

      pnMaterial = componentes[idx].pn || "NO APLICA";
      componentes[idx].cantidad -= cantidad;
      if(componentes[idx].cantidad <= 0) componentes.splice(idx,1);

      await updateDoc(origenRef, { componentes });

    } else if(origenTipo === "toolcrib"){

      const key = claveMaterial(nombreMaterial);
      const cribRef = doc(db,"toolcrib",key);
      const cribSnap = await getDoc(cribRef);
      if(!cribSnap.exists()){ alert("Ese material ya no está en Tool Crib"); return false; }

      const cribData = cribSnap.data();
      if((cribData.cantidad || 0) < cantidad){
        alert("Sin stock suficiente en Tool Crib. Disponible: " + cribData.cantidad);
        return false;
      }

      pnMaterial = cribData.pn || "NO APLICA";
      ubicacionTexto = "Tool Crib";
      const restante = (cribData.cantidad || 0) - cantidad;
      if(restante <= 0) await deleteDoc(cribRef);
      else await updateDoc(cribRef, { cantidad: restante });

    } else {
      alert("Origen inválido");
      return false;
    }

    const key = claveMaterial(nombreMaterial);
    const scrapRef = doc(db,"scrap",key);
    const scrapSnap = await getDoc(scrapRef);

    if(scrapSnap.exists()){
      await updateDoc(scrapRef, {
        cantidad: (scrapSnap.data().cantidad || 0) + cantidad,
        pn: (pnMaterial && pnMaterial !== "NO APLICA") ? pnMaterial : (scrapSnap.data().pn || "NO APLICA"),
        ultimaUbicacion: ubicacionTexto,
        responsable: getUser(),
        comentarios,
        fecha: new Date().toLocaleString()
      });
    } else {
      await setDoc(scrapRef, {
        nombre: nombreMaterial, pn: pnMaterial, cantidad,
        ultimaUbicacion: ubicacionTexto,
        responsable: getUser(),
        comentarios,
        fecha: new Date().toLocaleString()
      });
    }

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "ENVIO SCRAP",
      ubicacion: ubicacionTexto,
      nombre: nombreMaterial,
      cantidad,
      responsable: getUser(),
      comentarios
    });

    await loadCajas(true);
    await loadToolCrib(true);
    await loadScrap(true);
    if(typeof window.showStock === "function") await window.showStock(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();
    if(typeof window.renderToolCrib === "function") await window.renderToolCrib(true);
    if(typeof window.renderScrap === "function") await window.renderScrap(true);

    alert(`${cantidad} × ${nombreMaterial} enviado(s) a Scrap`);
    return true;

  }catch(e){
    console.error(e);
    alert("Error enviando material a Scrap");
    return false;
  }

};

window.renderScrap = async function(force){

  const tabla = document.getElementById("tablaScrap");
  if(!tabla) return;

  await loadScrap(force);

  let html = "";

  cacheScrap.forEach(m=>{
    html += `
<tr>
<td>${m.nombre || ""}</td>
<td>${(m.pn && m.pn !== "NO APLICA") ? m.pn : "—"}</td>
<td>${m.cantidad || 0}</td>
<td>${m.ultimaUbicacion || ""}</td>
<td>${m.responsable || ""}</td>
<td>${m.comentarios || ""}</td>
<td>${m.fecha || ""}</td>
</tr>`;
  });

  tabla.innerHTML = html || `<tr><td colspan="7" style="color:var(--ink-soft);">Sin materiales en Scrap</td></tr>`;

};

/* =====================
   4) MOVER UNA CAJA COMPLETA de rack/nivel/slot a otro
   Conserva el número/etiqueta de caja (o usa uno nuevo si se indica)
   y todo su contenido; cambia únicamente su ubicación.
   ===================== */
window.moverCajaUbicacion = async function(ubicacionOrigen, rackDestino, nivelDestino, slotDestino, cajaDestinoLabel, comentarios){

  comentarios = comentarios || "NO APLICA";

  if(!ubicacionOrigen || !rackDestino || !nivelDestino || !slotDestino){
    alert("Selecciona la caja de origen y el rack/nivel/slot de destino");
    return false;
  }

  try{

    const origenRef = doc(db,"cajas",ubicacionOrigen);
    const origenSnap = await getDoc(origenRef);
    if(!origenSnap.exists()){ alert("La caja de origen ya no existe"); return false; }

    const dataOrigen = origenSnap.data();

    if(esCajaPendiente(dataOrigen)){
      alert("Esta caja es material de migración pendiente de acomodar. Acomódala desde Racks y Cajas: abre la rejilla (slot) donde va y escribe su número.");
      return false;
    }

    const etiqueta = normCaja(cajaDestinoLabel || dataOrigen.caja || dataOrigen.ubicacion);

    if(!etiqueta){ alert("Número de caja de destino inválido"); return false; }

    const ubicacionDestino = buildUbicacion(rackDestino, nivelDestino, slotDestino, etiqueta);

    if(ubicacionDestino === ubicacionOrigen){
      alert("El destino es igual al origen");
      return false;
    }

    const destinoRef = doc(db,"cajas",ubicacionDestino);
    const destinoSnap = await getDoc(destinoRef);
    if(destinoSnap.exists()){
      alert("Ya existe una caja con ese número en el slot de destino");
      return false;
    }

    await setDoc(destinoRef, {
      rack: rackDestino,
      nivel: parseInt(nivelDestino),
      slot: parseInt(slotDestino),
      caja: etiqueta,
      ubicacion: ubicacionDestino,
      componentes: dataOrigen.componentes || [],
      estado: dataOrigen.estado || null,
      tamano: dataOrigen.tamano || null,
      capacidad: (typeof dataOrigen.capacidad === "number") ? dataOrigen.capacidad : null,
      // conserva si venía de la migración (ya acomodada) o si es caja nueva
      migracion: dataOrigen.migracion === true ? true : false,
      ...(dataOrigen.acomodada === true ? { acomodada: true } : {})
    });

    await deleteDoc(origenRef);

    const totalPiezas = (dataOrigen.componentes || []).reduce((s,x)=> s + (Number(x.cantidad)||0), 0);

    await addHist({
      ts: Date.now(),
      sid: SESION_ID,
      fecha: new Date().toLocaleString(),
      accion: "MOVIMIENTO CAJA",
      ubicacion: `${ubicacionOrigen} → ${ubicacionDestino}`,
      nombre: "Caja completa",
      cantidad: totalPiezas,
      responsable: getUser(),
      comentarios
    });

    await loadCajas(true);
    if(typeof window.renderRacksPage === "function") await window.renderRacksPage();

    alert(`Caja movida de ${ubicacionOrigen} a ${ubicacionDestino}`);
    return true;

  }catch(e){
    console.error(e);
    alert("Error moviendo la caja");
    return false;
  }

};


/* =====================================================
   ETIQUETAS DE CAJA — control físico ↔ digital
   -----------------------------------------------------
   - Cada caja tiene una etiqueta (colección "etiquetas", un documento
     por número de caja). Se crea sola para las cajas nuevas y para las
     que ya estaban registradas.
   - Cada entrada / salida / movimiento de material en una caja agrega un
     renglón a la tabla de su etiqueta (fecha, material #, cantidad,
     total restante, firma).
   - Si a una caja se le mete un material que no está en su etiqueta física
     (o cambia su nombre / PN / medida), la etiqueta queda "pendiente" y
     parpadea hasta que alguien confirme que ya se cambió la física.
   ===================================================== */

let cacheEtiquetas = [];
let etqListo = false;
let etqSincronizando = false;

const ETQ_NA = "N/A";

function etqNorm(t){ return String(t ?? "").trim().replace(/\s+/g," ").toUpperCase(); }

function etqVal(t){
  const v = String(t ?? "").trim();
  if(!v || /^(NO APLICA|N\/A|NA)$/i.test(v)) return ETQ_NA;
  return v.toUpperCase();
}

/* número/etiqueta de la caja: "53", "A-01"… (único en todo el almacén) */
function etqNumCaja(c){
  return normCaja((c && c.caja) || String((c && c.ubicacion) || "").split("-").pop());
}
function etqId(caja){ return normCaja(caja) || "SIN-NUMERO"; }

function etqMatsDeCaja(c){
  return (c.componentes || [])
    .filter(x => x && x.nombre)
    .map(x => ({
      nombre: etqNorm(x.nombre),
      pn: etqVal(x.pn),
      medida: etqVal(x.medida),
      cant: Number(x.cantidad) || 0
    }));
}

/* Lo que debe mostrar la etiqueta de una caja ahora mismo */
function etqVista(c){

  const id = etqId(etqNumCaja(c));
  const d = cacheEtiquetas.find(e => e.idDoc === id);
  const actuales = etqMatsDeCaja(c);
  const impresos = (d && d.materiales) || [];

  const lista = [];
  const motivos = [];

  impresos.forEach(m => {
    const act = actuales.find(a => a.nombre === m.nombre);
    lista.push({
      nombre: m.nombre,
      pn: etqVal(m.pn),
      medida: etqVal(m.medida),
      cant0: Number(m.cant0) || 0,
      actual: act ? act.cant : 0
    });
  });

  actuales.forEach(a => {
    const ya = lista.find(m => m.nombre === a.nombre);
    if(!ya){
      lista.push({ nombre: a.nombre, pn: a.pn, medida: a.medida, cant0: a.cant, actual: a.cant, nuevo: true });
      if(d) motivos.push(`Material nuevo en la caja: ${a.nombre}`);
    } else if(d && (ya.pn !== a.pn || ya.medida !== a.medida)){
      ya.pn = a.pn;
      ya.medida = a.medida;
      motivos.push(`Cambió el PN o la medida de: ${a.nombre}`);
    }
  });

  if(d && d.reimprimir) motivos.push("Se corrigió el nombre de un material");

  /* con más de 3 materiales la etiqueta es genérica ("MÁS DE 3 MATERIALES EN ESTA CAJA"):
     si ya era así, agregar o renombrar materiales no obliga a cambiarla */
  if(impresos.length > 3 && lista.length > 3) motivos.length = 0;

  const filas = ((d && d.filas) || []).slice().sort((x, y) => (x.ts || 0) - (y.ts || 0));

  return {
    caja: id,
    cajaTxt: String(c.caja || id),
    ubicacion: c.ubicacion,
    materiales: lista,
    filas,
    pendiente: motivos.length > 0,
    motivos,
    tieneDoc: !!d
  };
}

function etqCompararCajas(a, b){
  return String(a.cajaTxt).localeCompare(String(b.cajaTxt), undefined, { numeric: true });
}

window.getEtiquetas = function(){
  return cacheCajas.map(etqVista).sort(etqCompararCajas);
};

window.prepararEtiquetas = async function(){
  await loadCajas(false);
  if(!etqListo){
    try{
      const s = await getDocs(collection(db,"etiquetas"));
      cacheEtiquetas = s.docs.map(d => ({ idDoc: d.id, ...d.data() }));
      etqListo = true;
    }catch(e){
      console.error("Etiquetas (lectura):", e);
    }
  }
  etqSincronizar();
};

/* Crea la etiqueta de toda caja que todavía no tiene (incluye las ya registradas) */
async function etqSincronizar(){

  etqPintarAviso();

  if(!etqListo || etqSincronizando || !cacheCajas.length) return;

  const faltan = cacheCajas.filter(c => !cacheEtiquetas.some(e => e.idDoc === etqId(etqNumCaja(c))));
  if(!faltan.length) return;

  etqSincronizando = true;

  try{
    for(const c of faltan){
      const id = etqId(etqNumCaja(c));
      const ref = doc(db,"etiquetas",id);
      const s = await getDoc(ref);
      if(s.exists()) continue;
      await setDoc(ref, {
        caja: String(c.caja || id),
        materiales: etqMatsDeCaja(c).map(m => ({ nombre: m.nombre, pn: m.pn, medida: m.medida, cant0: m.cant })),
        filas: [],
        filasAnt: [],
        reimprimir: false,
        creada: Date.now()
      });
    }
  }catch(e){
    console.error("Etiquetas (sincronizar):", e);
  }

  etqSincronizando = false;
}

/* Cada movimiento del historial pasa por aquí: se guarda y, si afecta una
   caja, se agrega su renglón a la tabla de la etiqueta. */
async function addHist(mov){
  const ref = await addDoc(collection(db,"historial"), mov);
  try{
    await etqRegistrarMov(mov);
  }catch(e){
    console.error("Etiquetas (movimiento):", e);
  }
  return ref;
}

function etqFechaCorta(ts){
  const d = new Date(ts || Date.now());
  const p = n => String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
}

async function etqRegistrarMov(mov){

  if(!mov || mov.sinFila) return;

  const A = String(mov.accion || "");
  const nombre = etqNorm(mov.nombre);
  const cant = Math.abs(Number(mov.cantidad) || 0);
  if(!nombre) return;

  let efectos = [];

  if(A === "ENTRADA" || A === "REGRESO TOOL CRIB"){
    efectos = [{ ubic: mov.ubicacion, signo: +1, cant }];
  } else if(A === "SALIDA" || A === "ENVIO TOOL CRIB" || A === "ENVIO SCRAP" || A === "ELIMINACION MATERIAL"){
    efectos = [{ ubic: mov.ubicacion, signo: -1, cant }];
  } else if(A === "MOVIMIENTO MATERIAL"){
    const partes = String(mov.ubicacion || "").split("→").map(x => x.trim());
    if(partes.length === 2) efectos = [
      { ubic: partes[0], signo: -1, cant },
      { ubic: partes[1], signo: +1, cant }
    ];
  } else if(A === "ACTUALIZACION"){
    const dl = Number(mov.delta) || 0;
    if(dl !== 0) efectos = [{ ubic: mov.ubicacion, signo: dl > 0 ? +1 : -1, cant: Math.abs(dl) }];
  }

  for(const ef of efectos){

    if(!ef.ubic || ef.cant <= 0) continue;

    const cajaSnap = await getDoc(doc(db,"cajas", ef.ubic));
    if(!cajaSnap.exists()) continue;           // p. ej. "Tool Crib" o caja ya liberada

    const dc = cajaSnap.data();
    const id = etqId(etqNumCaja(dc));
    const comp = (dc.componentes || []).find(x => etqNorm(x.nombre) === nombre);
    const total = comp ? (Number(comp.cantidad) || 0) : 0;

    const ref = doc(db,"etiquetas", id);
    const eSnap = await getDoc(ref);

    if(!eSnap.exists()){
      // etiqueta aún no creada: se arma con lo que había ANTES de este movimiento
      const mats = etqMatsDeCaja(dc).map(m => ({ nombre: m.nombre, pn: m.pn, medida: m.medida, cant0: m.cant }));
      const antes = total - ef.signo * ef.cant;
      const m0 = mats.find(m => m.nombre === nombre);
      if(m0) m0.cant0 = Math.max(0, antes);
      else if(antes > 0) mats.push({ nombre, pn: ETQ_NA, medida: ETQ_NA, cant0: antes });
      await setDoc(ref, { caja: String(dc.caja || id), materiales: mats, filas: [], filasAnt: [], reimprimir: false, creada: Date.now() });
    }

    const fila = {
      id: Math.random().toString(36).slice(2, 8),
      ts: mov.ts || Date.now(),
      fecha: etqFechaCorta(mov.ts),
      nom: nombre,
      tipo: ef.signo > 0 ? "+" : "-",
      cant: ef.cant,
      total,
      firma: trNombreBonito(mov.responsable || getUser())
    };

    await updateDoc(ref, { filas: arrayUnion(fila) });
  }
}

/* El material se renombró: la etiqueta física quedó desactualizada */
async function etqRenombrar(cajaNum, viejo, nuevo){

  try{

    const ref = doc(db,"etiquetas", etqId(cajaNum));
    const s = await getDoc(ref);
    if(!s.exists()) return;

    const d = s.data();
    const vk = etqNorm(viejo), nk = etqNorm(nuevo);

    const mats = (d.materiales || []).map(m => ({ ...m }));
    const iv = mats.findIndex(m => m.nombre === vk);

    if(iv >= 0){
      const inn = mats.findIndex((m, j) => j !== iv && m.nombre === nk);
      if(inn >= 0){
        mats[inn].cant0 = (Number(mats[inn].cant0) || 0) + (Number(mats[iv].cant0) || 0);
        mats.splice(iv, 1);
      } else {
        mats[iv].nombre = nk;
      }
    }

    const filas = (d.filas || []).map(f => f.nom === vk ? { ...f, nom: nk } : f);

    await updateDoc(ref, { materiales: mats, filas, reimprimir: true });

  }catch(e){
    console.error("Etiquetas (renombrar):", e);
  }
}

/* Confirmar que la etiqueta FÍSICA ya se reemplazó por la nueva:
   la etiqueta nueva queda como base y su tabla empieza vacía. */
window.confirmarEtiquetaFisica = async function(cajaId){

  try{

    const c = cacheCajas.find(x => etqId(etqNumCaja(x)) === cajaId);
    if(!c){ alert("La caja ya no existe"); return false; }

    const v = etqVista(c);
    const actuales = etqMatsDeCaja(c);

    const orden = v.materiales.filter(m => actuales.some(a => a.nombre === m.nombre)).map(m => m.nombre);
    actuales.forEach(a => { if(!orden.includes(a.nombre)) orden.push(a.nombre); });

    const materiales = orden.map(n => {
      const a = actuales.find(x => x.nombre === n);
      return { nombre: n, pn: a.pn, medida: a.medida, cant0: a.cant };
    });

    const ref = doc(db,"etiquetas", cajaId);
    const prev = await getDoc(ref);
    const pd = prev.exists() ? prev.data() : {};

    await setDoc(ref, {
      caja: String(c.caja || cajaId),
      materiales,
      filas: [],
      filasAnt: (pd.filasAnt || []).concat(pd.filas || []).slice(-200),
      reimprimir: false,
      confirmada: Date.now(),
      confirmadaPor: getUser()
    }, { merge: true });

    return true;

  }catch(e){
    console.error(e);
    alert("No se pudo confirmar el cambio de etiqueta");
    return false;
  }
};

/* Parpadeo en el menú lateral cuando hay etiquetas por cambiar */
function etqPintarAviso(){

  if(!document.getElementById("etqEstilos")){
    const st = document.createElement("style");
    st.id = "etqEstilos";
    st.textContent = `
@keyframes etqBlink{ 0%,100%{ background:rgba(255,90,31,0); } 50%{ background:rgba(255,90,31,.6); } }
.sidebar a.etq-parpadeo{ animation:etqBlink 1s ease-in-out infinite; }
.etq-badge{ margin-left:auto; background:#ff5a1f; color:#fff; border-radius:99px; font-size:11px; font-weight:700; padding:2px 8px; line-height:1.4; }
`;
    document.head.appendChild(st);
  }

  const n = cacheCajas.filter(c => etqVista(c).pendiente).length;
  window.etqPendientes = n;

  document.querySelectorAll('.sidebar a[href="etiquetas.html"]').forEach(a => {
    a.classList.toggle("etq-parpadeo", n > 0);
    let b = a.querySelector(".etq-badge");
    if(n > 0){
      if(!b){ b = document.createElement("span"); b.className = "etq-badge"; a.appendChild(b); }
      b.textContent = n;
      b.title = n + " etiqueta(s) por cambiar físicamente";
    } else if(b){
      b.remove();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => setTimeout(etqPintarAviso, 600));


/* =====================================================
   TIEMPO REAL + NOTIFICACIONES FLOTANTES
   -----------------------------------------------------
   - Escucha en vivo (onSnapshot) cajas, racks, Tool Crib y Scrap:
     cualquier cambio de cualquier usuario se refleja al instante
     en la pantalla de todos, sin recargar.
   - Cada movimiento nuevo del historial muestra una notificación
     discreta a la derecha: quién lo hizo y qué hizo.
   ===================================================== */

const TR_TOAST_MS = 6500;      // cuánto dura cada aviso en pantalla
const TR_TOAST_MAX = 4;        // máximo de avisos apilados a la vez
const TR_VENTANA_MS = 60000;   // tolerancia de reloj entre equipos

const TR_ACCIONES = {
  "ENTRADA":             { icono:"⬇️", verbo:"registró una entrada", tu:"registraste una entrada", color:"#1f9d55" },
  "SALIDA":              { icono:"⬆️", verbo:"registró una salida", tu:"registraste una salida", color:"#ff5a1f" },
  "MOVIMIENTO MATERIAL": { icono:"🔀", verbo:"movió material", tu:"moviste material", color:"#3b82f6" },
  "MOVIMIENTO CAJA":     { icono:"📦", verbo:"movió una caja completa", tu:"moviste una caja completa", color:"#3b82f6" },
  "ACOMODO CAJA":        { icono:"📍", verbo:"acomodó una caja de migración", tu:"acomodaste una caja de migración", color:"#0ea5e9" },
  "ENVIO TOOL CRIB":     { icono:"🧰", verbo:"envió a Tool Crib", tu:"enviaste a Tool Crib", color:"#a855f7" },
  "REGRESO TOOL CRIB":   { icono:"↩️", verbo:"regresó de Tool Crib", tu:"regresaste de Tool Crib", color:"#a855f7" },
  "ENVIO SCRAP":         { icono:"🗑️", verbo:"envió a Scrap", tu:"enviaste a Scrap", color:"#e5484d" },
  "ELIMINACION MATERIAL":{ icono:"❌", verbo:"eliminó material", tu:"eliminaste material", color:"#e5484d" },
  "ACTUALIZACION":       { icono:"✏️", verbo:"actualizó un material", tu:"actualizaste un material", color:"#ffb703" }
};

function trEscape(t){
  return String(t ?? "").replace(/[&<>"']/g, ch => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]
  ));
}

/* roberto.figueroa@empresa.com -> "Roberto Figueroa" */
function trNombreBonito(email){
  const base = String(email || "").split("@")[0] || "Alguien";
  return base.split(/[._-]+/).filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || "Alguien";
}

function trInyectarEstilos(){
  if(document.getElementById("trEstilos")) return;
  const st = document.createElement("style");
  st.id = "trEstilos";
  st.textContent = `
#trToasts{position:fixed;right:16px;bottom:16px;z-index:100000;display:flex;flex-direction:column;
  gap:8px;width:300px;max-width:calc(100vw - 32px);pointer-events:none;}
.tr-toast{pointer-events:auto;cursor:pointer;display:flex;gap:10px;align-items:flex-start;
  background:rgba(18,21,27,.94);color:#f3f4f6;border:1px solid #2a3140;border-left:4px solid var(--c,#ff5a1f);
  border-radius:10px;padding:9px 12px;box-shadow:0 6px 20px rgba(0,0,0,.28);
  font:12.5px/1.35 var(--font-body,'Inter',-apple-system,Segoe UI,sans-serif);
  animation:trIn .28s ease-out both;backdrop-filter:blur(4px);}
.tr-toast.saliendo{animation:trOut .25s ease-in both;}
.tr-toast .tr-ico{font-size:16px;line-height:1.2;flex:none;}
.tr-toast .tr-quien{font-weight:700;color:#fff;}
.tr-toast .tr-det{color:#c9ced8;word-break:break-word;}
.tr-toast .tr-det b{color:#fff;font-weight:600;}
.tr-toast .tr-ubi{display:block;margin-top:2px;color:#9aa1ad;font-size:11px;
  font-family:var(--font-mono,'JetBrains Mono',Consolas,monospace);}
@keyframes trIn{from{opacity:0;transform:translateX(24px);}to{opacity:1;transform:none;}}
@keyframes trOut{from{opacity:1;transform:none;}to{opacity:0;transform:translateX(24px);}}
@media (prefers-reduced-motion:reduce){.tr-toast,.tr-toast.saliendo{animation:none;}}
@media (max-width:600px){#trToasts{right:8px;bottom:8px;}}
`;
  document.head.appendChild(st);
}

function trContenedor(){
  let c = document.getElementById("trToasts");
  if(!c){
    trInyectarEstilos();
    c = document.createElement("div");
    c.id = "trToasts";
    c.setAttribute("aria-live","polite");
    document.body.appendChild(c);
  }
  return c;
}

function trCerrarToast(el){
  if(!el || el.classList.contains("saliendo")) return;
  el.classList.add("saliendo");
  setTimeout(() => el.remove(), 260);
}

function trMostrarToast(mov){

  if(!document.body) return;

  const cfg = TR_ACCIONES[mov.accion] || { icono:"🔔", verbo:"hizo un movimiento", tu:"hiciste un movimiento", color:"#ff5a1f" };
  const esMio = mov.sid && mov.sid === SESION_ID;
  const quien = esMio ? "Tú" : trNombreBonito(mov.responsable);

  const cant = (mov.cantidad !== undefined && mov.cantidad !== null && mov.cantidad !== "")
    ? `<b>${trEscape(mov.cantidad)}</b> × ` : "";
  const detalle = (mov.accion === "MOVIMIENTO CAJA" || mov.accion === "ACOMODO CAJA")
    ? `${cant}pzs en total`
    : `${cant}<b>${trEscape(mov.nombre || "")}</b>`;

  const el = document.createElement("div");
  el.className = "tr-toast";
  el.style.setProperty("--c", cfg.color);
  el.title = "Clic para cerrar";
  el.innerHTML = `
<span class="tr-ico">${cfg.icono}</span>
<div>
  <div><span class="tr-quien">${trEscape(quien)}</span> ${esMio ? (cfg.tu || cfg.verbo) : cfg.verbo}</div>
  <div class="tr-det">${detalle}</div>
  ${mov.ubicacion ? `<span class="tr-ubi">${trEscape(mov.ubicacion)}</span>` : ""}
</div>`;

  const cont = trContenedor();
  cont.appendChild(el);

  // limita cuántos se apilan
  const activos = cont.querySelectorAll(".tr-toast:not(.saliendo)");
  if(activos.length > TR_TOAST_MAX) trCerrarToast(activos[0]);

  el.addEventListener("click", () => trCerrarToast(el));
  setTimeout(() => trCerrarToast(el), TR_TOAST_MS);
}

/* ---------- refresco de las vistas abiertas ---------- */

let trTimer = null;
let trTimerRacks = null;

function trEditando(){
  const a = document.activeElement;
  return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
}

function trProgramarRefresco(){
  clearTimeout(trTimer);
  trTimer = setTimeout(trRefrescarVistas, 250);
}

async function trRefrescarVistas(){

  try{

    // Inventario
    if(document.getElementById("tabla") && typeof window.showStock === "function"
       && /stock\.html$/i.test(location.pathname)){
      await window.showStock(false);
      const buscador = document.getElementById("valor");
      if(buscador && buscador.value && typeof window.liveSearch === "function") window.liveSearch();
    }

    // Tool Crib / Scrap (tablas y listas desplegables de Movimientos)
    if(typeof window.renderToolCrib === "function") await window.renderToolCrib(false);
    if(typeof window.renderScrap === "function") await window.renderScrap(false);
    if(typeof window.cargarSelectRegreso === "function" && document.getElementById("regresoMaterial")){
      await window.cargarSelectRegreso();
    }
    if(typeof window.cargarSelectScrapTool === "function" && document.getElementById("scrapToolMaterial")){
      await window.cargarSelectScrapTool();
    }

    // Categorías
    if(typeof window.filtrarCategorias === "function" && document.getElementById("catBuscar")){
      await window.filtrarCategorias();
    }

    // Etiquetas
    if(typeof window.renderEtiquetas === "function" && document.getElementById("etqGrid")){
      window.renderEtiquetas();
    }

    // Racks y visor 3D
    trRefrescarRacks();

  }catch(e){
    console.error("Error refrescando vistas en tiempo real:", e);
  }
}

/* El visor 3D se reconstruye, así que si alguien está escribiendo en una
   tarjeta (cantidad, comentarios…) espera a que termine para no borrarle
   lo que escribe. */
function trRefrescarRacks(){

  if(!document.getElementById("tablaRacks") || typeof window.renderRacksPage !== "function") return;

  clearTimeout(trTimerRacks);

  if(trEditando()){
    trTimerRacks = setTimeout(trRefrescarRacks, 1500);
    return;
  }

  window.renderRacksPage();
}

/* ---------- listeners en vivo ---------- */

let trIniciado = false;

function trEscuchar(nombre, alRecibir){
  let primera = true;
  return onSnapshot(collection(db, nombre), snap => {
    alRecibir(snap);
    if(primera){ primera = false; return; }   // la carga inicial ya la pinta cada página
    trProgramarRefresco();
  }, err => console.error("Tiempo real (" + nombre + "):", err));
}

function trIniciar(){

  if(trIniciado) return;
  trIniciado = true;

  trEscuchar("cajas", snap => {
    cacheCajas = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
    etqSincronizar();
  });

  trEscuchar("etiquetas", snap => {
    cacheEtiquetas = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
    etqListo = true;
    etqSincronizar();
    if(typeof window.renderEtiquetas === "function") window.renderEtiquetas();
  });

  trEscuchar("racks", snap => {
    cacheRacks = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
    cacheRacks.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  });

  trEscuchar("toolcrib", snap => {
    cacheToolCrib = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
    cacheToolCrib.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  });

  trEscuchar("scrap", snap => {
    cacheScrap = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
    cacheScrap.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  });

  /* Avisos: solo movimientos recientes (no baja todo el historial).
     La primera respuesta se ignora: son movimientos que ya existían. */
  let primeraAvisos = true;
  const desde = Date.now() - TR_VENTANA_MS;

  onSnapshot(query(collection(db,"historial"), where("ts", ">=", desde)), snap => {

    if(primeraAvisos){ primeraAvisos = false; return; }

    snap.docChanges().forEach(ch => {
      if(ch.type !== "added") return;
      const mov = ch.doc.data();
      if(!mov || !mov.accion) return;
      trMostrarToast(mov);
    });

  }, err => console.error("Tiempo real (avisos):", err));

  /* Página de Historial: la tabla se actualiza sola */
  if(document.getElementById("tablaHistorial")){
    onSnapshot(collection(db,"historial"), snap => {
      historialCache = snap.docs.map(d => ({ idDoc:d.id, ...d.data() }));
      ordenarHistorial(historialCache);

      if(document.getElementById("valor") && document.getElementById("tipoFiltro")
         && typeof window.filterHistory === "function"){
        window.filterHistory();
      } else {
        renderHistorial(historialCache);
      }
    }, err => console.error("Tiempo real (historial):", err));
  }
}

/* arranca en cuanto hay sesión (auth-global.js publica window.currentUser) */
(function esperarSesionTR(){
  if(window.currentUser){ trIniciar(); return; }
  const t = setInterval(() => {
    if(window.currentUser){ clearInterval(t); trIniciar(); }
  }, 200);
})();

/* =====================================================
   CHAT INTERNO + PRESENCIA (verde = conectado, rojo = no)
   -----------------------------------------------------
   - "presencia/<correo>": cada usuario con sesión abierta escribe un
     latido cada 30 s. Se considera ACTIVO si el último latido es de
     hace menos de 2.5 min.
   - "mensajes": { de, para, texto, ts, leido }. Cada mensaje solo lo
     pueden leer quien lo envía y quien lo recibe (ver reglas de Firestore
     en CAMBIOS.md).
   - Al llegar un mensaje nuevo aparece un aviso flotante; al pulsarlo se
     abre el chat con esa persona. El menú muestra el contador de no leídos.
   ===================================================== */

const CHAT_LATIDO_MS = 30000;
const CHAT_ACTIVO_MS = 150000;

let cachePresencia = [];
let cacheMsgRecibidos = [];
let cacheMsgEnviados = [];
let chatIniciado = false;
let chatPrimeraCarga = true;

function chatYo(){
  return String((window.currentUser && window.currentUser.email) || "").trim().toLowerCase();
}

function chatEstaActivo(p){
  return !!p && !!p.lastSeen && p.online !== false && (Date.now() - p.lastSeen) < CHAT_ACTIVO_MS;
}

/* ---------- presencia ---------- */
async function chatLatido(online){
  const yo = chatYo();
  if(!yo) return;
  try{
    await setDoc(doc(db, "presencia", yo), {
      email: yo,
      nombre: trNombreBonito(yo),
      lastSeen: Date.now(),
      online: online !== false
    }, { merge: true });
  }catch(e){
    console.error("Chat (presencia):", e);
  }
}

/* usuarios conocidos: los que han entrado al sistema + los de la colección "usuarios" */
window.getChatUsuarios = function(){
  const yo = chatYo();
  const mapa = new Map();

  cachePresencia.forEach(p => {
    const em = String(p.idDoc || p.email || "").toLowerCase();
    if(!em || em === yo) return;
    mapa.set(em, { email: em, nombre: p.nombre || trNombreBonito(em), activo: chatEstaActivo(p), lastSeen: p.lastSeen || 0 });
  });

  cacheMsgRecibidos.forEach(m => { const em = String(m.de || "").toLowerCase(); if(em && em !== yo && !mapa.has(em)) mapa.set(em, { email: em, nombre: trNombreBonito(em), activo: false, lastSeen: 0 }); });
  cacheMsgEnviados.forEach(m => { const em = String(m.para || "").toLowerCase(); if(em && em !== yo && !mapa.has(em)) mapa.set(em, { email: em, nombre: trNombreBonito(em), activo: false, lastSeen: 0 }); });

  (window.chatUsuariosExtra || []).forEach(em => {
    em = String(em || "").toLowerCase();
    if(!em || em === yo || mapa.has(em)) return;
    mapa.set(em, { email: em, nombre: trNombreBonito(em), activo: false, lastSeen: 0 });
  });

  return Array.from(mapa.values()).sort((a, b) =>
    (Number(b.activo) - Number(a.activo)) || a.nombre.localeCompare(b.nombre));
};

/* ---------- mensajes ---------- */
function chatConversacion(con){
  con = String(con || "").toLowerCase();
  return cacheMsgRecibidos.filter(m => String(m.de).toLowerCase() === con)
    .concat(cacheMsgEnviados.filter(m => String(m.para).toLowerCase() === con))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
window.getChatConversacion = chatConversacion;

window.getChatNoLeidos = function(){
  const r = {};
  cacheMsgRecibidos.forEach(m => {
    if(m.leido) return;
    const de = String(m.de).toLowerCase();
    r[de] = (r[de] || 0) + 1;
  });
  return r;
};

window.enviarMensajeChat = async function(para, texto){
  const yo = chatYo();
  para = String(para || "").trim().toLowerCase();
  texto = String(texto || "").trim();
  if(!yo || !para || !texto) return false;
  if(texto.length > 1000) texto = texto.slice(0, 1000);
  try{
    await addDoc(collection(db, "mensajes"), {
      de: yo,
      para,
      texto,
      ts: Date.now(),
      leido: false
    });
    return true;
  }catch(e){
    console.error(e);
    alert("No se pudo enviar el mensaje");
    return false;
  }
};

window.marcarChatLeidos = async function(con){
  con = String(con || "").toLowerCase();
  const pend = cacheMsgRecibidos.filter(m => !m.leido && String(m.de).toLowerCase() === con);
  for(const m of pend){
    try{ await updateDoc(doc(db, "mensajes", m.idDoc), { leido: true }); }catch(e){ console.error(e); }
  }
};

/* ---------- aviso flotante + contador en el menú ---------- */
function chatToast(m){

  trInyectarEstilos();

  const el = document.createElement("div");
  el.className = "tr-toast";
  el.style.setProperty("--c", "#2563eb");
  el.title = "Clic para abrir el chat";
  el.innerHTML = `
<span class="tr-ico">💬</span>
<div>
  <div><span class="tr-quien">${trEscape(trNombreBonito(m.de))}</span> te envió un mensaje</div>
  <div class="tr-det">${trEscape(String(m.texto || "").slice(0, 90))}</div>
</div>`;

  const cont = trContenedor();
  cont.appendChild(el);

  const activos = cont.querySelectorAll(".tr-toast:not(.saliendo)");
  if(activos.length > TR_TOAST_MAX) trCerrarToast(activos[0]);

  el.addEventListener("click", () => {
    window.location.href = "chat.html?con=" + encodeURIComponent(m.de);
  });
  setTimeout(() => trCerrarToast(el), 9000);
}

function chatPintarAviso(){

  if(!document.getElementById("chatEstilos")){
    const st = document.createElement("style");
    st.id = "chatEstilos";
    st.textContent = `
.chat-badge{ margin-left:auto; background:#2563eb; color:#fff; border-radius:99px; font-size:11px; font-weight:700; padding:2px 8px; line-height:1.4; }
@keyframes chatBlink{ 0%,100%{ background:rgba(37,99,235,0); } 50%{ background:rgba(37,99,235,.45); } }
.sidebar a.chat-nuevo{ animation:chatBlink 1.2s ease-in-out infinite; }
`;
    document.head.appendChild(st);
  }

  const total = cacheMsgRecibidos.filter(m => !m.leido).length;
  window.chatNoLeidosTotal = total;

  document.querySelectorAll('.sidebar a[href="chat.html"]').forEach(a => {
    a.classList.toggle("chat-nuevo", total > 0);
    let b = a.querySelector(".chat-badge");
    if(total > 0){
      if(!b){ b = document.createElement("span"); b.className = "chat-badge"; a.appendChild(b); }
      b.textContent = total;
    } else if(b){
      b.remove();
    }
  });
}

function chatIniciar(){

  if(chatIniciado) return;
  const yo = chatYo();
  if(!yo) return;
  chatIniciado = true;

  /* latido de presencia */
  chatLatido(true);
  setInterval(() => chatLatido(true), CHAT_LATIDO_MS);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) chatLatido(true); });
  window.addEventListener("pagehide", () => {
    try{ setDoc(doc(db, "presencia", yo), { lastSeen: Date.now(), online: false }, { merge: true }); }catch(e){}
  });

  /* usuarios ya registrados en el sistema (si hay permiso para leerlos) */
  getDocs(collection(db, "usuarios")).then(s => {
    window.chatUsuariosExtra = s.docs.map(d => d.id);
    if(typeof window.renderChat === "function") window.renderChat();
  }).catch(() => {});

  onSnapshot(collection(db, "presencia"), snap => {
    cachePresencia = snap.docs.map(d => ({ idDoc: d.id, ...d.data() }));
    if(typeof window.renderChat === "function") window.renderChat();
  }, err => console.error("Chat (presencia):", err));

  /* el estado verde/rojo se recalcula solo con el paso del tiempo */
  setInterval(() => { if(typeof window.renderChat === "function") window.renderChat(); }, 20000);

  /* mensajes que me enviaron */
  onSnapshot(query(collection(db, "mensajes"), where("para", "==", yo)), snap => {

    cacheMsgRecibidos = snap.docs.map(d => ({ idDoc: d.id, ...d.data() }));

    if(chatPrimeraCarga){
      chatPrimeraCarga = false;
      const n = cacheMsgRecibidos.filter(m => !m.leido).length;
      if(n > 0 && !/chat\.html$/i.test(location.pathname)){
        chatToast({ de: cacheMsgRecibidos.filter(m => !m.leido).sort((a, b) => b.ts - a.ts)[0].de,
                    texto: n === 1 ? "Tienes 1 mensaje sin leer" : "Tienes " + n + " mensajes sin leer" });
      }
    } else {
      snap.docChanges().forEach(ch => {
        if(ch.type !== "added") return;
        const m = ch.doc.data();
        if(!m || m.leido) return;
        const abierto = /chat\.html$/i.test(location.pathname)
          && window.chatConversacionAbierta === String(m.de).toLowerCase() && !document.hidden;
        if(!abierto) chatToast(m);
      });
    }

    chatPintarAviso();
    if(typeof window.renderChat === "function") window.renderChat();

  }, err => console.error("Chat (recibidos):", err));

  /* mensajes que yo envié (para ver la conversación completa) */
  onSnapshot(query(collection(db, "mensajes"), where("de", "==", yo)), snap => {
    cacheMsgEnviados = snap.docs.map(d => ({ idDoc: d.id, ...d.data() }));
    if(typeof window.renderChat === "function") window.renderChat();
  }, err => console.error("Chat (enviados):", err));
}

(function esperarSesionChat(){
  if(window.currentUser){ chatIniciar(); return; }
  const t = setInterval(() => {
    if(window.currentUser){ clearInterval(t); chatIniciar(); }
  }, 250);
})();

document.addEventListener("DOMContentLoaded", () => setTimeout(chatPintarAviso, 700));


/* =====================================================
   SOLO MAYÚSCULAS AL ESCRIBIR (en todas las secciones)
   -----------------------------------------------------
   Todo campo de texto y comentarios se convierte a mayúsculas
   mientras se escribe. No afecta correo, contraseña, números,
   fechas ni campos de solo lectura. Un campo puede quedar
   excluido agregándole el atributo data-no-upper.
   ===================================================== */

(function soloMayusculas(){

  const TIPOS_TEXTO = ["", "text", "search", "tel"];

  function aplica(el){
    if(!el || el.readOnly || el.disabled) return false;
    if(el.hasAttribute && el.hasAttribute("data-no-upper")) return false;
    if(el.tagName === "TEXTAREA") return true;
    if(el.tagName !== "INPUT") return false;
    return TIPOS_TEXTO.includes((el.getAttribute("type") || "").toLowerCase());
  }

  function forzar(el){
    const v = el.value;
    const up = v.toUpperCase();
    if(v === up) return;
    let ini = null, fin = null;
    try{ ini = el.selectionStart; fin = el.selectionEnd; }catch(e){}
    el.value = up;
    try{ if(ini !== null) el.setSelectionRange(ini, fin); }catch(e){}
  }

  // fase de captura: corre antes que los oninput/onkeyup de cada campo,
  // así los buscadores en vivo ya reciben el texto en mayúsculas
  document.addEventListener("input", e => {
    if(e.isComposing) return;
    if(aplica(e.target)) forzar(e.target);
  }, true);

  document.addEventListener("change", e => {
    if(aplica(e.target)) forzar(e.target);
  }, true);

  // aspecto visual (los textos de ayuda se quedan normales)
  const st = document.createElement("style");
  st.id = "estiloMayusculas";
  st.textContent = `
input:not([type]), input[type="text"], input[type="search"], input[type="tel"], textarea{ text-transform:uppercase; }
input::placeholder, textarea::placeholder{ text-transform:none; }
`;
  document.head.appendChild(st);

})();
