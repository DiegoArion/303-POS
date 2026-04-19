const API = 'http://localhost:3000/api';

/* ─── STATE ─── */
let products     = [];
let cats         = ['Todos'];
let cart         = [];
let salesCat     = 'Todos';
let prodCat      = 'Todos';
let metodoPago   = 'efectivo';
let ventaFiltro  = '';
// Listas de configuración (vienen de MongoDB)
let cfgCategorias  = [];
let cfgProveedores = [];
let cfgUnidades    = [];
let cfgImpresion   = null;

const PRINT_DEFAULTS = {
  venta:      { margen: '6', fuente: '9',   fuenteTotal:  '11' },
  inventario: { margen: '6', fuente: '9',   fuenteStock:  '11' },
  etiqueta:   { margen: '6', fuente: '13' },
  caja:       { margen: '6', fuente: '7.5', fuenteMonto:  '9'  },
};

function getPrintCfg(tipo) {
  const saved = cfgImpresion?.[tipo] ?? {};
  return { ...PRINT_DEFAULTS[tipo], ...saved };
}

function _printHtml(html, delay = 250) {
  let fr = document.getElementById('_print-frame');
  if (!fr) {
    fr = document.createElement('iframe');
    fr.id = '_print-frame';
    fr.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:200mm;height:200mm;border:0;';
    document.body.appendChild(fr);
  }
  const doc = fr.contentDocument || fr.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => fr.contentWindow.print(), delay);
}

/* ─── MAPEO MongoDB → UI ─── */
function mapDoc(doc) {
  return {
    _id:       String(doc._id),
    sku:       doc.codigo    || '',
    name:      doc.producto  || '',
    price:     doc.pVenta    ?? 0,
    retail:    doc.pCosto    ?? 0,
    stock:     doc.stock     ?? 0,
    cat:       doc.categoria || 'Sin categoría',
    proveedor: doc.proveedor || '',
    unidad:    doc.unidad   || '',
    ini:       (doc.producto || '?')[0].toUpperCase(),
  };
}

/* ─── API ─── */
async function fetchProductos(q = '', cat = 'Todos') {
  const params = new URLSearchParams();
  if (q)   params.set('q', q);
  if (cat && cat !== 'Todos') params.set('cat', cat);
  const res = await fetch(`${API}/productos?${params}`);
  if (!res.ok) throw new Error('Error al obtener productos');
  return (await res.json()).map(mapDoc);
}

async function fetchCategorias() {
  const res = await fetch(`${API}/categorias`);
  if (!res.ok) throw new Error('Error al obtener categorías');
  return ['Todos', ...(await res.json())];
}

async function fetchConfig() {
  const res = await fetch(`${API}/config`);
  if (!res.ok) return;
  const data = await res.json();
  cfgCategorias  = data.categorias  ?? [];
  cfgProveedores = data.proveedores ?? [];
  cfgUnidades    = data.unidades    ?? [];
  cfgImpresion   = data.impresion   ?? null;
}

/* ─── NAVIGATION ─── */
const PAGE_META = {
  dashboard:    { title:'Dashboard',         sub:'Resumen del día y del mes' },
  sales:        { title:'Punto de Venta',    sub:'Registra tus ventas rápidamente' },
  products:     { title:'Productos',         sub:'Consulta precios y detalles del catálogo' },
  inventory:    { title:'Inventario',        sub:'Estado actual del stock' },
  ventas:       { title:'Ventas',            sub:'Historial de ventas registradas' },
  agregar:      { title:'Agregar productos', sub:'Carga varios productos al inventario en una sola operación' },
  'nuevo-pedido': { title:'Nuevo Pedido',    sub:'Registra la recepción de mercancía de un proveedor' },
  pedidos:      { title:'Pedidos',           sub:'Historial de pedidos recibidos de proveedores' },
  usuarios:     { title:'Usuarios',           sub:'Gestiona los usuarios con acceso al sistema' },
  config:       { title:'Configuración',     sub:'Gestiona las categorías y proveedores disponibles' },
  'caja-mov':     { title:'Mov. de Caja',    sub:'Registra entradas y salidas de efectivo' },
  'caja-reporte': { title:'Reporte de Caja', sub:'Movimientos de caja por día' },
  inventariado:   { title:'Inventariado',    sub:'Escanea productos para actualizar el stock' },
  'inv-reporte':  { title:'Inventarios',     sub:'Historial de inventarios por fecha' },
};

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const page = el.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.getElementById('top-title').textContent = PAGE_META[page].title;
    document.getElementById('top-sub').textContent   = PAGE_META[page].sub;
    if (page === 'dashboard')    loadDashboard();
    if (page === 'inventory')    loadInventory();
    if (page === 'ventas')       loadVentas();
    if (page === 'agregar')      initBulkPage();
    if (page === 'config')       loadConfig();
    if (page === 'nuevo-pedido') initNuevoPedido();
    if (page === 'pedidos')      loadPedidos();
    if (page === 'usuarios')     loadUsuarios();
    if (page === 'caja-mov')     initCajaMov();
    if (page === 'caja-reporte') initCajaReporte();
    if (page === 'inventariado') initInventariado();
    if (page === 'inv-reporte')  { document.getElementById('inv-rep-mes').value = new Date().toISOString().slice(0,7); loadInvReporte(); }
  });
});

/* ─── HELPERS ─── */
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  return '$' + Number(n).toFixed(2);
}

function stockColor(s)  { return s === 0 ? 'var(--danger)' : s <= 5 ? 'var(--warning)' : 'var(--success)'; }
function stockLabel(s)  { return s === 0 ? 'Sin stock' : s <= 5 ? 'Poco stock' : s <= 10 ? 'Stock bajo' : 'En stock'; }

// Muestra imagen del producto si existe, si no la inicial
function _avatarFallback(img) {
  if (img.dataset.tried === 'jpg') {
    img.dataset.tried = 'png';
    img.src = `/imagenes/${img.dataset.sku}.png`;
  } else {
    const { size, radius, ini } = img.dataset;
    const fs = Math.round(Number(size) * 0.4);
    const div = document.createElement('div');
    div.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius}px;background:var(--primary-light);color:var(--primary-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${fs}px;flex-shrink:0;`;
    div.textContent = ini;
    img.replaceWith(div);
  }
}

function avatarHtml(sku, ini, size, radius) {
  if (!sku) {
    const fs = Math.round(size * 0.4);
    return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:var(--primary-light);color:var(--primary-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${fs}px;flex-shrink:0;">${ini}</div>`;
  }
  return `<img src="/imagenes/${encodeURIComponent(sku)}.jpg" loading="lazy"
    onerror="_avatarFallback(this)"
    data-sku="${encodeURIComponent(sku)}" data-ini="${ini}" data-size="${size}" data-radius="${radius}" data-tried="jpg"
    style="width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:cover;flex-shrink:0;">`;
}

function avatar(p) {
  return avatarHtml(p.sku, p.ini, 36, 9);
}

function buildTabs(containerId, active, onClickFn) {
  document.getElementById(containerId).innerHTML = cats.map(c =>
    `<div class="tab${c === active ? ' active' : ''}" onclick="${onClickFn}('${c}',this)">${c}</div>`
  ).join('');
}

function setLoading(gridId, msg = 'Cargando…') {
  document.getElementById(gridId).innerHTML =
    `<div class="empty"><i class="fas fa-circle-notch fa-spin" style="font-size:22px;opacity:.3;"></i><br>${msg}</div>`;
}

/* ─── SALES ─── */
let salesDebounce;
function setScat(cat, el) {
  salesCat = cat;
  document.querySelectorAll('#s-tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadSales();
}

async function loadSales() {
  const q = document.getElementById('s-search').value.trim();
  setLoading('s-grid');
  try {
    const list = await fetchProductos(q, salesCat);
    renderSalesGrid(list);
  } catch {
    document.getElementById('s-grid').innerHTML = '<div class="empty">Error al cargar productos</div>';
  }
}

function renderSalesGrid(list) {
  const grid = document.getElementById('s-grid');
  products = list;
  if (!list.length) { grid.innerHTML = '<div class="empty">Sin resultados</div>'; return; }

  grid.innerHTML = list.map(p => {
    const out     = p.stock === 0;
    const granel  = ES_GRANEL_UNIDAD(p.unidad, p.cat);
    const lbl     = p.stock === 0 ? 'Sin stock' : p.stock <= 5 ? `Solo ${p.stock}` : `${p.stock} uds`;
    const bg      = p.stock===0?'var(--danger-bg)':p.stock<=5?'var(--warning-bg)':'var(--success-bg)';
    const cl      = p.stock===0?'var(--danger)':p.stock<=5?'var(--warning)':'var(--success)';
    const action  = out ? '' : granel
      ? `onclick="openGranel('${p._id}')"`
      : `onclick="addToCart('${p._id}')"`;
    return `
      <div class="prod-card${out ? ' out' : ''}" ${action}>
        ${avatarHtml(p.sku, p.ini, 44, 10)}
        <div class="prod-name">${p.name}</div>
        <div class="prod-price">${fmt(p.price)}<span style="font-size:10px;font-weight:400;color:var(--muted);"> /kg</span></div>
        ${granel ? '<span class="granel-tag"><i class="fas fa-weight-hanging"></i> Granel</span>' : ''}
        <span style="font-size:11px;padding:2px 7px;border-radius:4px;background:${bg};color:${cl};">${lbl}</span>
      </div>`;
  }).join('');

  products = list;
}

/* ─── GRANEL MODAL ─── */
let _granelProducto = null;

function openGranel(id) {
  const p = products.find(x => x._id === id);
  if (!p) return;
  _granelProducto = p;
  const u = p.unidad || 'unidad';
  document.getElementById('granel-name').textContent      = p.name;
  document.getElementById('granel-precio-kg').textContent = `${fmt(p.price)} por ${u}`;
  document.getElementById('granel-peso').value  = '';
  document.getElementById('granel-total').value = '';
  document.getElementById('granel-calc-hint').textContent = 'Basado en precio × peso';
  document.getElementById('granel-overlay').classList.add('open');
  setTimeout(() => document.getElementById('granel-peso').focus(), 180);
}

function closeGranel() {
  document.getElementById('granel-overlay').classList.remove('open');
  _granelProducto = null;
}

function calcGranel() {
  if (!_granelProducto) return;
  const peso = parseFloat(document.getElementById('granel-peso').value);
  if (isNaN(peso) || peso <= 0) {
    document.getElementById('granel-total').value = '';
    document.getElementById('granel-calc-hint').textContent = 'Basado en precio × peso';
    return;
  }
  const calc = _granelProducto.price * peso;
  document.getElementById('granel-total').value = calc.toFixed(2);
  const u2 = _granelProducto.unidad || 'unidad';
  document.getElementById('granel-calc-hint').textContent =
    `${fmt(_granelProducto.price)} × ${peso} ${u2} = ${fmt(calc)}`;
}

function confirmGranel() {
  if (!_granelProducto) return;
  const peso  = parseFloat(document.getElementById('granel-peso').value);
  const total = parseFloat(document.getElementById('granel-total').value);
  if (!peso  || peso  <= 0) { document.getElementById('granel-peso').focus();  return; }
  if (!total || total <= 0) { document.getElementById('granel-total').focus(); return; }

  // Cada entrada granel es única en el carrito (por peso + timestamp)
  const uid = `${_granelProducto._id}_${Date.now()}`;
  cart.push({
    ..._granelProducto,
    _id:        uid,
    _baseId:    _granelProducto._id,
    esGranel:   true,
    peso,
    _precioBase: _granelProducto.price, // precio original por unidad
    price:      total,                  // precio final de venta (editable)
    qty:        1,
  });

  renderCart();
  toast(`✅ ${_granelProducto.name} — ${peso} ${_granelProducto.unidad || 'unidad'} agregado`);
  closeGranel();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeGranel(); closeModal(); }
  if (e.key === 'Enter' && document.getElementById('granel-overlay').classList.contains('open')) {
    confirmGranel();
  }
});

/* ─── CART ─── */
function addToCart(id) {
  const p  = products.find(x => x._id === id);
  if (!p) return;
  const ex = cart.find(x => x._id === id);
  if (ex) ex.qty++; else cart.push({...p, qty:1});
  renderCart();
  toast(`✅ ${p.name} agregado`);
}

function removeFromCart(id) { cart = cart.filter(x => x._id !== id); renderCart(); }

function changeQty(id, d) {
  const it = cart.find(x => x._id === id);
  if (!it) return;
  it.qty += d;
  if (it.qty <= 0) removeFromCart(id); else renderCart();
}

function clearCart() { cart = []; document.getElementById('venta-nota').value = ''; renderCart(); }

function renderCart() {
  const total = cart.reduce((s,i) => s + i.qty, 0);
  document.getElementById('cart-count').textContent = total;

  const body = document.getElementById('cart-body');
  if (!cart.length) {
    body.innerHTML = `<div class="cart-empty">
      <i class="fas fa-shopping-basket"></i>
      <span>El carrito está vacío</span>
      <small>Toca un producto para agregar</small>
    </div>`;
    setTotals(0); return;
  }

  body.innerHTML = cart.map(it => {
    if (it.esGranel) {
      return `
        <div class="cart-item">
          <div style="width:30px;height:30px;border-radius:7px;background:#F0FDF4;
            color:#16A34A;display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:13px;flex-shrink:0;">⚖</div>
          <div class="ci-info">
            <div class="ci-name">${it.name}</div>
            <div class="ci-unit">${fmt(it._precioBase)} / ${it.unidad || 'u'}</div>
          </div>
          <div style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:4px;">
            <i class="fas fa-weight-hanging" style="font-size:10px;"></i>
            <span>${it.peso} ${it.unidad || 'u'}</span>
          </div>
          <div class="ci-total">${fmt(it.price)}</div>
          <button class="btn-rm" onclick="removeFromCart('${it._id}')"><i class="fas fa-times"></i></button>
        </div>`;
    }
    return `
      <div class="cart-item">
        ${avatarHtml(it.sku, it.ini, 30, 7)}
        <div class="ci-info">
          <div class="ci-name">${it.name}</div>
          <div class="ci-unit">${fmt(it.price)} c/u</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty('${it._id}',-1)">−</button>
          <span class="qty-val">${it.qty}</span>
          <button class="qty-btn" onclick="changeQty('${it._id}', 1)">+</button>
        </div>
        <div class="ci-total">${fmt(it.price * it.qty)}</div>
        <button class="btn-rm" onclick="removeFromCart('${it._id}')"><i class="fas fa-times"></i></button>
      </div>`;
  }).join('');

  setTotals(cart.reduce((s,i) => s + i.price * i.qty, 0));
}

function setTotals(sub) {
  document.getElementById('sub').textContent = fmt(sub);
  document.getElementById('tot').textContent = fmt(sub);
  document.getElementById('btn-pay').disabled = !cart.length;
}

/* ─── MÉTODO DE PAGO ─── */
function setMetodo(m, el) {
  metodoPago = m;
  document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function imprimirTicket(venta) {
  const cfg        = getPrintCfg('venta');
  const margen     = cfg.margen;
  const fuente     = cfg.fuente;
  const fuenteTotal = cfg.fuenteTotal;
  const bodyW      = (58 - margen * 2) + 'mm';

  const fecha    = new Date(venta.fecha);
  const fechaStr = fecha.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr  = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const metodo   = venta.metodoPago === 'tarjeta' ? 'Tarjeta' : 'Efectivo';
  const money    = n => '$' + Number(n).toFixed(2);

  const productosHtml = venta.productos.map(p => {
    const nombre = p.nombre.length > 26 ? p.nombre.slice(0, 24) + '…' : p.nombre;
    const cant   = p.esGranel
      ? `${p.cantidad} ${p.unidad || 'kg'}`
      : `${p.cantidad}${p.unidad ? ' ' + p.unidad : ''} x ${money(p.pVenta)}`;
    return `<div class="prod">
      <div class="pnombre">${nombre}</div>
      <div class="pdet"><span>${cant}</span><span>${money(p.subtotal)}</span></div>
    </div>`;
  }).join('');

  const notaHtml = venta.nota
    ? `<hr class="dash"><div style="font-size:7.5pt;">Nota: ${venta.nota}</div>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${venta.folio}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:58mm auto;margin:2mm ${margen}mm;}
body{font-family:Arial,Helvetica,sans-serif;font-size:${fuente}pt;width:${bodyW};color:#000;}
.c{text-align:center;}
.neg{font-size:12pt;font-weight:700;letter-spacing:1px;}
.row{display:flex;justify-content:space-between;margin:2px 0;}
.dash{border:none;border-top:1px dashed #000;margin:4px 0;}
.solid{border:none;border-top:1.5px solid #000;margin:4px 0;}
.prod{margin:4px 0;}
.pnombre{font-weight:700;}
.pdet{display:flex;justify-content:space-between;padding-left:2mm;}
.total{display:flex;justify-content:space-between;font-size:${fuenteTotal}pt;font-weight:700;margin:3px 0;}
</style></head><body>
<div class="c neg">PUNTO DE VENTA</div>
<div class="c">${fechaStr} &nbsp; ${horaStr}</div>
<hr class="dash">
<div class="row"><span>Folio</span><span>${venta.folio}</span></div>
<div class="row"><span>Pago</span><span>${metodo}</span></div>
<hr class="dash">
${productosHtml}
<hr class="solid">
<div class="total"><span>TOTAL</span><span>${money(venta.total)}</span></div>
<hr class="solid">
${notaHtml}
<div class="c" style="margin-top:6px;font-size:8pt;">¡Gracias por su compra!</div>
</body></html>`;

  _printHtml(html, 250);
}

async function processSale() {
  if (!cart.length) return;

  const btn = document.getElementById('btn-pay');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando…';

  try {
    const nota = document.getElementById('venta-nota').value.trim();
    const payload = {
      metodoPago,
      ...(nota ? { nota } : {}),
      productos: cart.map(it => ({
        productoId: it.esGranel ? it._baseId : it._id,
        codigo:    it.sku,
        nombre:    it.name,
        pVenta:    it.esGranel ? it._precioBase : it.price,
        pCosto:    it.retail,
        cantidad:  it.esGranel ? it.peso : it.qty,
        unidad:    it.unidad || '',
        ...(it.esGranel ? { esGranel: true } : {}),
      })),
    };

    const res = await fetch(`${API}/ventas`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error((await res.json()).error);

    const venta = await res.json();
    const icono = metodoPago === 'tarjeta' ? '💳' : '💵';
    toast(`${icono} ${venta.folio} — ${fmt(venta.total)} registrada`);
    imprimirTicket(venta);
    clearCart();
  } catch (err) {
    toast(`❌ Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Cobrar';
    renderCart(); // re-evalúa disabled según carrito
  }
}

/* ─── PRODUCTS PAGE ─── */
let prodDebounce;
function setPcat(cat, el) {
  prodCat = cat;
  document.querySelectorAll('#p-tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadProducts();
}

async function loadProducts() {
  const q = document.getElementById('p-search').value.trim();
  setLoading('p-grid');
  try {
    const list = await fetchProductos(q, prodCat);
    renderProductsGrid(list);
  } catch {
    document.getElementById('p-grid').innerHTML = '<div class="empty">Error al cargar productos</div>';
  }
}

function renderProductsGrid(list) {
  const grid = document.getElementById('p-grid');
  if (!list.length) { grid.innerHTML = '<div class="empty">Sin resultados</div>'; return; }

  grid.innerHTML = list.map(p => {
    const sc = stockColor(p.stock);
    const sl = stockLabel(p.stock);
    const sb = p.stock===0?'var(--danger-bg)':p.stock<=5?'var(--warning-bg)':'var(--success-bg)';
    return `
      <div class="cat-card">
        ${avatarHtml(p.sku, p.ini, 52, 12)}
        <div class="cat-name">${p.name}</div>
        <div class="cat-sku">${p.sku}</div>
        <span class="cat-tag">${p.cat}</span>
        <div class="cat-price">${fmt(p.price)}</div>
        <hr class="cat-divider">
        <div class="cat-stock">
          <span style="color:${sc};font-size:8px;">●</span>
          <span style="color:${sc};background:${sb};padding:2px 7px;border-radius:4px;font-weight:600;font-size:11px;">${sl}</span>
          <span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--muted);">${p.stock} uds</span>
        </div>
      </div>`;
  }).join('');
}

/* ─── INVENTORY ─── */
async function loadInventory() {
  try {
    const all = await fetchProductos('', 'Todos');
    document.getElementById('inv-total').textContent = all.length;
    document.getElementById('inv-ok').textContent    = all.filter(p => p.stock > 10).length;
    document.getElementById('inv-low').textContent   = all.filter(p => p.stock > 0 && p.stock <= 10).length;
    document.getElementById('inv-out').textContent   = all.filter(p => p.stock === 0).length;
    window._invAll = all;
    renderInventoryTable(all);
  } catch {
    document.getElementById('i-body').innerHTML =
      '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px;">Error al cargar inventario</td></tr>';
  }
}

function filterInventory() {
  if (!window._invAll) return;
  const q = document.getElementById('i-search').value.toLowerCase();
  const filtered = window._invAll.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q)  ||
    p.cat.toLowerCase().includes(q)
  );
  renderInventoryTable(filtered);
}

function renderInventoryTable(list) {
  const max = list.length ? Math.max(...list.map(p => p.stock)) : 1;

  if (!list.length) {
    document.getElementById('i-body').innerHTML =
      '<tr><td colspan="9" class="empty">Sin resultados</td></tr>';
    return;
  }

  document.getElementById('i-body').innerHTML = list.map(p => {
    const pct = max > 0 ? (p.stock / max) * 100 : 0;
    const sc  = stockColor(p.stock);
    const sl  = stockLabel(p.stock);
    const sb  = p.stock===0?'var(--danger-bg)':p.stock<=5?'var(--warning-bg)':'var(--success-bg)';
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:9px;">
            ${avatarHtml(p.sku, p.ini, 32, 8)}
            <span style="font-weight:500;">${p.name}</span>
          </div>
        </td>
        <td style="color:var(--muted);font-family:monospace;font-size:12px;">${p.sku || '—'}</td>
        <td>
          <span style="background:var(--primary-light);color:var(--primary-dark);
            padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">${p.cat}</span>
        </td>
        <td style="color:var(--muted);font-size:13px;">${p.proveedor || '—'}</td>
        <td>${p.unidad
          ? `<span style="background:var(--bg);border:1.5px solid var(--border);
              padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600;
              color:var(--text);">${p.unidad}</span>`
          : '<span style="color:var(--muted);">—</span>'}</td>
        <td style="color:var(--muted);">${p.retail !== null ? fmt(p.retail) : '—'}</td>
        <td style="font-weight:700;">${fmt(p.price)}</td>
        <td>
          <div class="stock-bar-wrap">
            <div class="stock-bar">
              <div class="stock-fill" style="width:${pct}%;background:${sc};"></div>
            </div>
            <span class="stock-num" style="color:${sc};">${p.stock}</span>
          </div>
        </td>
        <td style="display:flex;align-items:center;gap:8px;">
          <span style="background:${sb};color:${sc};
            padding:3px 9px;border-radius:6px;font-size:12px;font-weight:600;">${sl}</span>
          <button onclick="openModal('${p._id}')"
            style="border:none;background:var(--bg);border-radius:6px;padding:4px 8px;
            cursor:pointer;color:var(--muted);font-size:12px;transition:all .15s;"
            title="Editar producto">
            <i class="fas fa-pen"></i>
          </button>
          ${p.sku ? `<button onclick="imprimirEtiqueta('${p.sku}','${p.name.replace(/'/g,"&#39;").replace(/"/g,"&quot;")}')"
            style="border:none;background:var(--bg);border-radius:6px;padding:4px 8px;
            cursor:pointer;color:var(--muted);font-size:12px;transition:all .15s;"
            title="Imprimir etiqueta">
            <i class="fas fa-barcode"></i>
          </button>` : ''}
          <button onclick="eliminarProducto('${p._id}','${p.name.replace(/'/g,"&#39;")}')"
            style="border:none;background:var(--danger-bg);border-radius:6px;padding:4px 8px;
            cursor:pointer;color:var(--danger);font-size:12px;transition:all .15s;"
            title="Eliminar producto">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('');
}

function descargarInventario() {
  const lista = [...(window._invAll ?? [])].sort((a, b) => a.stock - b.stock);
  if (!lista.length) { toast('⚠️ Sin productos para descargar'); return; }

  const encabezado = ['Producto', 'SKU', 'Categoría', 'Proveedor', 'Unidad', 'Precio Costo', 'Precio Venta', 'Stock', 'Estado'];
  const filas = lista.map(p => [
    p.name,
    p.sku   || '',
    p.cat   || '',
    p.proveedor || '',
    p.unidad    || '',
    p.retail != null ? p.retail : '',
    p.price  != null ? p.price  : '',
    p.stock,
    stockLabel(p.stock),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv  = [encabezado.join(','), ...filas].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const fecha = new Date().toLocaleDateString('en-CA');
  a.href     = url;
  a.download = `inventario_${fecha}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function imprimirInventario() {
  const lista = [...(window._invAll ?? [])].sort((a, b) => a.stock - b.stock);
  if (!lista.length) { toast('⚠️ Sin productos para imprimir'); return; }

  const cfg         = getPrintCfg('inventario');
  const margen      = cfg.margen;
  const fuente      = cfg.fuente;
  const fuenteStock = cfg.fuenteStock;
  const bodyW       = (58 - margen * 2) + 'mm';

  const fecha = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const filas = lista.map(p => `
    <tr class="${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : ''}">
      <td class="info">
        <div class="pname">${p.name}</div>
        ${p.sku ? `<div class="psku">${p.sku}</div>` : ''}
      </td>
      <td class="num">${p.stock}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Inventario ${fecha}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:58mm auto;margin:2mm ${margen}mm;}
body{font-family:Arial,Helvetica,sans-serif;font-size:${fuente}pt;width:${bodyW};color:#000;}
.c{text-align:center;}
.bold{font-weight:700;}
.dash{border:none;border-top:1px dashed #000;margin:4px 0;}
.solid{border:none;border-top:1.5px solid #000;margin:4px 0;}
table{width:100%;border-collapse:collapse;}
th{font-size:8pt;text-transform:uppercase;border-bottom:1px solid #000;padding:3px 2px;text-align:left;}
td{padding:4px 2px;vertical-align:middle;}
.info{width:80%;}
.pname{font-size:${fuente}pt;line-height:1.2;}
.psku{font-size:7.5pt;color:#444;margin-top:1px;}
.num{text-align:right;font-size:${fuenteStock}pt;white-space:nowrap;padding-right:2mm;}
tr + tr td{border-top:1px dotted #ccc;}
</style></head><body>
<div class="c bold" style="font-size:12pt;">INVENTARIO</div>
<div class="c" style="font-size:8pt;">${fecha}</div>
<hr class="solid">
<table>
  <thead><tr><th>Producto / SKU</th><th class="num">Stk</th></tr></thead>
  <tbody>${filas}</tbody>
</table>
<hr class="dash">
<div class="c" style="font-size:8pt;">${lista.length} productos</div>
</body></html>`;

  _printHtml(html, 250);
}

function imprimirEtiqueta(sku, nombre) {
  const cfg    = getPrintCfg('etiqueta');
  const margen = cfg.margen;
  const fuente = cfg.fuente;
  const bodyW  = (58 - margen * 2) + 'mm';

  // Generar SVG del código de barras en la ventana principal (JsBarcode ya cargado)
  const formato = /^\d{13}$/.test(sku) ? 'EAN13' : 'CODE128';
  const tmpSvg  = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(tmpSvg, sku, { format: formato, width: 2, height: 50, fontSize: 10, margin: 4, displayValue: true, textMargin: 3 });
  const svgHtml = tmpSvg.outerHTML;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Etiqueta ${sku}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:58mm auto;margin:2mm ${margen}mm;}
body{width:${bodyW};font-family:Arial,Helvetica,sans-serif;padding:1mm 0;}
.nombre{font-size:${fuente}pt;font-weight:700;text-align:center;width:100%;
  word-break:break-word;line-height:1.3;margin-bottom:3mm;}
svg{width:100%;display:block;}
</style></head><body>
<div class="nombre">${nombre}</div>
${svgHtml}
</body></html>`;

  _printHtml(html, 250);
}

/* ─── MODAL PRODUCTO ─── */
function fImgMostrar(src) {
  document.getElementById('f-img-preview').src = src;
  document.getElementById('f-img-preview').style.display = '';
  document.getElementById('f-img-empty').style.display = 'none';
  document.getElementById('btn-img-borrar').style.display = '';
}

function fImgOcultar() {
  document.getElementById('f-img-preview').src = '';
  document.getElementById('f-img-preview').style.display = 'none';
  document.getElementById('f-img-empty').style.display = '';
  document.getElementById('btn-img-borrar').style.display = 'none';
}

// Carga imagen desde disco — intenta .jpg, luego .png
function fImgCargar(codigo) {
  if (!codigo) { fImgOcultar(); return; }
  const exts = ['jpg', 'png'];
  let idx = 0;
  const img = document.getElementById('f-img-preview');
  function tryNext() {
    if (idx >= exts.length) { fImgOcultar(); return; }
    const url = `/imagenes/${encodeURIComponent(codigo)}.${exts[idx++]}`;
    img.onerror = tryNext;
    img.onload  = () => {
      img.style.display = '';
      document.getElementById('f-img-empty').style.display = 'none';
      document.getElementById('btn-img-borrar').style.display = '';
    };
    img.src = url;
  }
  tryNext();
}

async function fImgUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const codigo = document.getElementById('f-codigo').value.trim();
  if (!codigo) { toast('⚠️ Ingresa el código del producto antes de subir la imagen'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = await apiFetch('/imagenes', { method: 'POST', body: JSON.stringify({ codigo, base64: e.target.result }) });
      fImgMostrar(data.url);
    } catch (err) { toast(`❌ ${err.message}`); }
  };
  reader.readAsDataURL(file);
}

function fCodigoStatus(icono, texto, spinning = false) {
  const wrap = document.getElementById('f-codigo-status');
  const icon = document.getElementById('f-codigo-status-icon');
  const txt  = document.getElementById('f-codigo-status-txt');
  wrap.style.display = 'flex';
  icon.className = `fas fa-${icono}${spinning ? ' fa-spin' : ''}`;
  txt.textContent = texto;
}

async function generarCodigo() {
  const data = await apiFetch('/productos/generar-codigo');
  return data.codigo;
}

async function generarCodigoModal() {
  const btn = document.getElementById('btn-generar-codigo');
  btn.disabled = true;
  try {
    const codigo = await generarCodigo();
    document.getElementById('f-codigo').value = codigo;
    document.getElementById('f-codigo-status').style.display = 'none';
  } catch { toast('❌ Error generando código'); }
  finally { btn.disabled = false; }
}

async function bulkGenerarCodigo(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  try {
    const codigo = await generarCodigo();
    tr.querySelector('[data-field="codigo"]').value = codigo;
  } catch { toast('❌ Error generando código'); }
}

async function buscarPorCodigoModal() {
  const codigo = document.getElementById('f-codigo').value.trim();
  if (!codigo) return;
  if (document.getElementById('f-id').value) return;
  if (document.getElementById('f-nombre').value.trim()) return;
  if (codigo.startsWith('2')) return; // código interno, no buscar

  fCodigoStatus('circle-notch', 'Buscando…', true);
  try {
    const data = await apiFetch(`/buscar-codigo/${encodeURIComponent(codigo)}`);
    if (data.encontrado) {
      document.getElementById('f-nombre').value = data.nombre || '';
      if (data.tieneImagen) fImgCargar(codigo);
      fCodigoStatus('check', 'Info obtenida de internet');
    } else {
      fCodigoStatus('triangle-exclamation', 'No encontrado en internet');
    }
  } catch {
    document.getElementById('f-codigo-status').style.display = 'none';
  }
}

function openModal(id = null) {
  const overlay = document.getElementById('modal-overlay');

  // Poblar selects
  document.getElementById('f-categoria').innerHTML = catOptions();
  document.getElementById('f-proveedor').innerHTML = provOptions();
  document.getElementById('f-unidad').innerHTML    = unidadOptions();

  // Limpiar imagen y status
  fImgOcultar();
  document.getElementById('f-codigo-status').style.display = 'none';

  if (id) {
    const p = window._invAll?.find(x => x._id === id);
    if (!p) return;
    document.getElementById('modal-title').textContent    = 'Editar producto';
    document.getElementById('modal-sub').textContent      = 'Modifica los campos que necesites';
    document.getElementById('btn-submit-txt').textContent = 'Guardar cambios';
    document.getElementById('f-id').value        = id;
    document.getElementById('f-nombre').value    = p.name;
    document.getElementById('f-codigo').value    = p.sku;
    document.getElementById('f-categoria').innerHTML = catOptions(p.cat);
    document.getElementById('f-proveedor').innerHTML = provOptions(p.proveedor ?? '');
    document.getElementById('f-unidad').innerHTML    = unidadOptions(p.unidad ?? '');
    document.getElementById('f-costo').value     = p.retail ?? '';
    document.getElementById('f-venta').value     = p.price  ?? '';
    document.getElementById('f-stock').value     = p.stock  ?? 0;
    if (p.sku) fImgCargar(p.sku);
  } else {
    document.getElementById('modal-title').textContent    = 'Agregar producto';
    document.getElementById('modal-sub').textContent      = 'Solo el nombre es obligatorio';
    document.getElementById('btn-submit-txt').textContent = 'Agregar';
    document.getElementById('prod-form').reset();
    document.getElementById('f-id').value    = '';
  }

  document.querySelectorAll('.field input').forEach(i => i.classList.remove('error'));
  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-codigo').focus(), 220);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
  try {
    await apiFetch(`/productos/${id}`, { method: 'DELETE' });
    toast(`🗑 "${nombre}" eliminado`);
    await loadInventory();
  } catch (err) { toast(`❌ ${err.message}`); }
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

document.addEventListener('keydown', e => {
  // Escape ya manejado en el listener del modal granel
});

async function submitProducto(e) {
  e.preventDefault();
  const nombre = document.getElementById('f-nombre').value.trim();
  const id     = document.getElementById('f-id').value;

  const nEl = document.getElementById('f-nombre');
  if (!nombre) { nEl.classList.add('error'); return; } else nEl.classList.remove('error');

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

  const payload = {
    producto:  nombre,
    codigo:    document.getElementById('f-codigo').value.trim(),
    categoria: document.getElementById('f-categoria').value,
    proveedor: document.getElementById('f-proveedor').value,
    unidad:    document.getElementById('f-unidad').value,
    pCosto:    document.getElementById('f-costo').value || null,
    pVenta:    document.getElementById('f-venta').value  || null,
    stock:     document.getElementById('f-stock').value  || 0,
  };

  try {
    const url    = id ? `${API}/productos/${id}` : `${API}/productos`;
    const method = id ? 'PUT' : 'POST';
    const res    = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error);

    closeModal();
    toast(id ? '✅ Producto actualizado' : '✅ Producto agregado');
    await loadInventory();           // refresca tabla y stats
    await fetchCategorias().then(c => { cats = c; }); // actualiza tabs
  } catch (err) {
    toast(`❌ ${err.message}`);
  } finally {
    btn.disabled = false;
    const txt = id ? 'Guardar cambios' : 'Agregar';
    btn.innerHTML = `<i class="fas fa-${id ? 'floppy-disk' : 'plus'}"></i> <span>${txt}</span>`;
  }
}

/* ─── VENTAS PAGE ─── */
function setVentaFiltro(metodo, el) {
  ventaFiltro = metodo;
  document.querySelectorAll('#v-filter-tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadVentas();
}

async function loadVentas() {
  document.getElementById('v-body').innerHTML =
    `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted);">
      <i class="fas fa-circle-notch fa-spin"></i> Cargando…
    </td></tr>`;

  try {
    const params = new URLSearchParams({ limit: 100 });
    if (ventaFiltro) params.set('metodo', ventaFiltro);

    const res  = await fetch(`${API}/ventas?${params}`);
    const data = await res.json();

    renderVentasStats(data.ventas);
    renderVentasTable(data.ventas);
  } catch {
    document.getElementById('v-body').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger);">Error al cargar ventas</td></tr>`;
  }
}

function renderVentasStats(ventas) {
  // Solo hoy
  const hoy    = new Date(); hoy.setHours(0,0,0,0);
  const deHoy  = ventas.filter(v => new Date(v.fecha) >= hoy);
  const ef     = deHoy.filter(v => v.metodoPago === 'efectivo');
  const tar    = deHoy.filter(v => v.metodoPago === 'tarjeta');
  const suma   = arr => arr.reduce((s,v) => s + v.total, 0);

  document.getElementById('v-count').textContent    = deHoy.length;
  document.getElementById('v-total').textContent    = fmt(suma(deHoy));
  document.getElementById('v-efectivo').textContent = fmt(suma(ef));
  document.getElementById('v-tarjeta').textContent  = fmt(suma(tar));
}

function renderVentasTable(ventas) {
  if (!ventas.length) {
    document.getElementById('v-body').innerHTML =
      `<tr><td colspan="7" class="empty">Sin ventas registradas</td></tr>`;
    return;
  }

  document.getElementById('v-body').innerHTML = ventas.map(v => {
    const fecha = new Date(v.fecha);
    const fStr  = fecha.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
    const hStr  = fecha.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
    const cls   = v.metodoPago === 'tarjeta' ? 'tag-tarjeta' : 'tag-efectivo';
    const ico   = v.metodoPago === 'tarjeta' ? 'fa-credit-card' : 'fa-money-bill-wave';

    const detalle = v.productos.map(p => {
      const unid = p.unidad || (p.esGranel ? 'u.' : 'pza');
      return `<div class="venta-prod-item">
        <span style="flex:1;">${p.nombre}</span>
        <span style="color:var(--muted);font-size:12px;min-width:80px;text-align:right;">${fmt(p.pVenta)} / ${unid}</span>
        <span style="color:var(--muted);font-size:12px;min-width:60px;text-align:right;">× ${p.cantidad} ${unid}</span>
        <span style="font-weight:600;min-width:72px;text-align:right;">${fmt(p.subtotal)}</span>
      </div>`;
    }).join('');

    return `
      <tr class="expandable" onclick="toggleDetalle('${v._id}')">
        <td style="color:var(--muted);font-size:12px;">
          <i class="fas fa-chevron-right" id="ico-${v._id}" style="transition:transform .2s;"></i>
        </td>
        <td style="font-family:monospace;font-weight:600;font-size:13px;">${v.folio}</td>
        <td>${fStr}</td>
        <td style="color:var(--muted);">${hStr}</td>
        <td style="text-align:center;">${v.numProductos} pza${v.numProductos !== 1 ? 's' : ''}</td>
        <td style="font-weight:700;">${fmt(v.total)}</td>
        <td>
          <span class="tag-metodo ${cls}">
            <i class="fas ${ico}"></i> ${v.metodoPago === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}
          </span>
        </td>
      </tr>
      <tr id="det-${v._id}">
        <td colspan="7" style="padding:0 18px;">
          <div class="venta-row-detail" id="body-${v._id}">
            <div style="font-weight:600;font-size:12px;color:var(--muted);margin-bottom:6px;">
              PRODUCTOS DE LA VENTA
            </div>
            <div class="venta-prod-list">${detalle}</div>
            <div style="margin-top:10px;display:flex;align-items:flex-start;gap:8px;">
              <textarea id="nota-${v._id}" rows="2"
                placeholder="Agregar nota…"
                style="flex:1;resize:none;border:1.5px solid var(--border);border-radius:8px;
                  padding:6px 10px;font-size:12px;font-family:inherit;background:var(--bg);
                  color:var(--text);outline:none;"
                onfocus="this.style.borderColor='var(--primary)'"
                onblur="this.style.borderColor='var(--border)'"
              >${v.nota ?? ''}</textarea>
              <button onclick="guardarNota('${v._id}')"
                style="border:none;background:var(--primary);color:#fff;border-radius:8px;
                  padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap;align-self:flex-end;">
                <i class="fas fa-save"></i> Guardar
              </button>
            </div>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function guardarNota(id) {
  const nota = document.getElementById(`nota-${id}`).value.trim();
  try {
    const res = await fetch(`${API}/ventas/${id}/nota`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nota }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('✅ Nota guardada');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ─── DEBOUNCED SEARCH ─── */
document.getElementById('s-search').addEventListener('input', () => {
  clearTimeout(salesDebounce);
  salesDebounce = setTimeout(loadSales, 300);
});

document.getElementById('s-search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(salesDebounce);
  await loadSales();
  const p = products[0];
  if (!p) { toast('⚠️ Producto no encontrado'); return; }
  if (ES_GRANEL_UNIDAD(p.unidad, p.cat)) {
    openGranel(p._id);
  } else {
    addToCart(p._id);
  }
  document.getElementById('s-search').value = '';
  loadSales();
});

document.getElementById('p-search').addEventListener('input', () => {
  clearTimeout(prodDebounce);
  prodDebounce = setTimeout(loadProducts, 300);
});

/* ─── AGREGAR PRODUCTOS (BULK) ─── */
let bulkRowId = 0;

function catOptions(selected = '') {
  const opts = cfgCategorias.length ? cfgCategorias : [];
  return '<option value="">Sin categoría</option>' +
    opts.map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

function provOptions(selected = '') {
  return '<option value="">Sin proveedor</option>' +
    cfgProveedores.map(p => `<option value="${p}"${p === selected ? ' selected' : ''}>${p}</option>`).join('');
}

function unidadOptions(selected = '') {
  return '<option value="">—</option>' +
    cfgUnidades.map(u => `<option value="${u}"${u === selected ? ' selected' : ''}>${u}</option>`).join('');
}

// Un producto se vende "a granel" si su unidad NO es "Unidad" y tiene unidad definida
const ES_GRANEL_UNIDAD = (_u, cat) => !!cat && cat.toLowerCase().trim() === 'granel';

function getFirstRowValues() {
  const first = document.querySelector('#bulk-body tr');
  if (!first) return { categoria: '', proveedor: '', unidad: '' };
  return {
    categoria: first.querySelector('[data-field="categoria"]')?.value ?? '',
    proveedor: first.querySelector('[data-field="proveedor"]')?.value ?? '',
    unidad:    first.querySelector('[data-field="unidad"]')?.value    ?? '',
  };
}

async function bulkBuscarCodigo(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const codigoInput = tr.querySelector('[data-field="codigo"]');
  const nombreInput = tr.querySelector('[data-field="producto"]');
  const spinner     = tr.querySelector('.bulk-buscando');
  const codigo = codigoInput.value.trim();
  if (!codigo || nombreInput.value.trim()) return;
  if (codigo.startsWith('2')) return; // código interno, no buscar

  if (spinner) spinner.style.display = '';
  try {
    const data = await apiFetch(`/buscar-codigo/${encodeURIComponent(codigo)}`);
    if (data.encontrado) {
      nombreInput.value = data.nombre || '';
    }
  } catch { /* sin internet, ignorar */ }
  finally { if (spinner) spinner.style.display = 'none'; }
}

function bulkAddRow() {
  bulkRowId++;
  const id   = bulkRowId;
  const isFirst = document.querySelectorAll('#bulk-body tr').length === 0;
  const { categoria, proveedor, unidad } = isFirst
    ? { categoria: '', proveedor: '', unidad: '' }
    : getFirstRowValues();

  const tr = document.createElement('tr');
  tr.id    = `brow-${id}`;
  tr.innerHTML = `
    <td class="row-num">${document.querySelectorAll('#bulk-body tr').length + 1}</td>
    <td style="position:relative;">
      <input class="cell-input" type="text" placeholder="Ej: 7501234567890" data-field="codigo"
        onblur="bulkBuscarCodigo('brow-${id}')"
        onkeydown="if(event.key==='Enter'){event.preventDefault();bulkBuscarCodigo('brow-${id}');}">
      <button type="button" onclick="bulkGenerarCodigo('brow-${id}')" title="Generar código interno"
        style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:2px 4px;">
        <i class="fas fa-barcode"></i>
      </button>
    </td>
    <td style="position:relative;">
      <input class="cell-input" type="text" placeholder="Nombre del producto" data-field="producto">
      <span class="bulk-buscando" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);pointer-events:none;">
        <i class="fas fa-circle-notch fa-spin"></i>
      </span>
    </td>
    <td><select class="cell-select" data-field="categoria">${catOptions(categoria)}</select></td>
    <td><select class="cell-select" data-field="proveedor">${provOptions(proveedor)}</select></td>
    <td><select class="cell-select" data-field="unidad">${unidadOptions(unidad)}</select></td>
    <td><input class="cell-input" type="number" placeholder="0.00" min="0" step="0.01" data-field="pCosto"></td>
    <td><input class="cell-input" type="number" placeholder="N/A"  min="0" step="0.01" data-field="pVenta"></td>
    <td><input class="cell-input" type="number" placeholder="0"    min="0" step="1"    data-field="stock" value="0"></td>
    <td><button class="btn-row-del" onclick="bulkDelRow(${id})" title="Eliminar fila"><i class="fas fa-times"></i></button></td>
  `;
  document.getElementById('bulk-body').appendChild(tr);
  updateBulkCount();
  tr.querySelector('[data-field="codigo"]').focus();
}

function bulkAddRows(n) {
  for (let i = 0; i < n; i++) bulkAddRow();
}

function bulkDelRow(id) {
  const el = document.getElementById(`brow-${id}`);
  if (el) el.remove();
  renumberBulk();
  updateBulkCount();
}

function bulkClear() {
  document.getElementById('bulk-body').innerHTML = '';
  hideBanner();
  bulkRowId = 0;
  bulkAddRow();
}

function renumberBulk() {
  document.querySelectorAll('#bulk-body tr').forEach((tr, i) => {
    tr.querySelector('.row-num').textContent = i + 1;
  });
}

function updateBulkCount() {
  document.getElementById('bulk-count').textContent =
    document.querySelectorAll('#bulk-body tr').length;
}

function hideBanner() {
  const b = document.getElementById('bulk-banner');
  b.className = 'result-banner';
  b.innerHTML = '';
}

async function bulkSubmit() {
  hideBanner();
  const rows = [...document.querySelectorAll('#bulk-body tr')];
  if (!rows.length) return;

  document.querySelectorAll('#bulk-body .cell-input').forEach(i => i.classList.remove('err'));

  let valid = true;
  const productos = [];

  for (const tr of rows) {
    const get    = f => tr.querySelector(`[data-field="${f}"]`)?.value?.trim() ?? '';
    const nombre = get('producto');

    // Fila completamente vacía → ignorar
    if (!nombre && !get('codigo') && !get('pVenta') && !get('pCosto')) continue;

    if (!nombre) { tr.querySelector('[data-field="producto"]').classList.add('err'); valid = false; }

    productos.push({
      producto:  nombre,
      codigo:    get('codigo'),
      categoria: get('categoria'),
      proveedor: get('proveedor'),
      unidad:    get('unidad'),
      pCosto:    get('pCosto') || null,
      pVenta:    get('pVenta') || null,
      stock:     get('stock')  || 0,
    });
  }

  if (!valid)           { toast('❌ El nombre del producto es obligatorio'); return; }
  if (!productos.length){ toast('❌ No hay productos para guardar');    return; }

  const btn = document.getElementById('btn-bulk-save');
  btn.disabled = true;
  document.getElementById('btn-bulk-txt').textContent = 'Guardando…';
  btn.querySelector('i').className = 'fas fa-circle-notch fa-spin';

  try {
    const res  = await fetch(`${API}/productos/bulk`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ productos }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const banner = document.getElementById('bulk-banner');

    if (!data.errores?.length) {
      banner.className = 'result-banner show result-ok';
      banner.innerHTML = `<i class="fas fa-circle-check"></i>
        <strong>${data.insertados} producto${data.insertados !== 1 ? 's' : ''} guardado${data.insertados !== 1 ? 's' : ''} correctamente.</strong>`;
      document.getElementById('bulk-body').innerHTML = '';
      bulkRowId = 0;
      bulkAddRow();
    } else {
      banner.className = 'result-banner show result-warn';
      banner.innerHTML = `<i class="fas fa-triangle-exclamation"></i>
        <span><strong>${data.insertados} guardados</strong> — ${data.errores.length} con error:
        ${data.errores.map(e => `Fila ${e.fila}: ${e.error}`).join(' · ')}</span>`;
    }

    await fetchCategorias().then(c => { cats = c; });
    if (window._invAll !== undefined) await loadInventory();

  } catch (err) {
    toast(`❌ ${err.message}`);
  } finally {
    btn.disabled = false;
    document.getElementById('btn-bulk-txt').textContent = 'Guardar productos';
    btn.querySelector('i').className = 'fas fa-cloud-arrow-up';
  }
}

/* ─── CONFIGURACIÓN ─── */
async function loadConfig() {
  await fetchConfig();
  renderCfgList('categorias');
  renderCfgList('proveedores');
  renderCfgList('unidades');
  loadPrintConfig();
}

function loadPrintConfig() {
  const campos = {
    venta:      ['margen', 'fuente', 'fuenteTotal'],
    inventario: ['margen', 'fuente', 'fuenteStock'],
    etiqueta:   ['margen', 'fuente'],
    caja:       ['margen', 'fuente', 'fuenteMonto'],
  };
  for (const [tipo, keys] of Object.entries(campos)) {
    const cfg = getPrintCfg(tipo);
    for (const key of keys) {
      const el = document.getElementById(`pc-${tipo}-${key}`);
      if (el) el.value = cfg[key] ?? '';
    }
  }
}

async function savePrintConfig() {
  const tickets = {
    venta: {
      margen:      document.getElementById('pc-venta-margen')?.value      ?? PRINT_DEFAULTS.venta.margen,
      fuente:      document.getElementById('pc-venta-fuente')?.value      ?? PRINT_DEFAULTS.venta.fuente,
      fuenteTotal: document.getElementById('pc-venta-fuenteTotal')?.value ?? PRINT_DEFAULTS.venta.fuenteTotal,
    },
    inventario: {
      margen:      document.getElementById('pc-inventario-margen')?.value      ?? PRINT_DEFAULTS.inventario.margen,
      fuente:      document.getElementById('pc-inventario-fuente')?.value      ?? PRINT_DEFAULTS.inventario.fuente,
      fuenteStock: document.getElementById('pc-inventario-fuenteStock')?.value ?? PRINT_DEFAULTS.inventario.fuenteStock,
    },
    etiqueta: {
      margen: document.getElementById('pc-etiqueta-margen')?.value ?? PRINT_DEFAULTS.etiqueta.margen,
      fuente: document.getElementById('pc-etiqueta-fuente')?.value ?? PRINT_DEFAULTS.etiqueta.fuente,
    },
    caja: {
      margen:      document.getElementById('pc-caja-margen')?.value      ?? PRINT_DEFAULTS.caja.margen,
      fuente:      document.getElementById('pc-caja-fuente')?.value      ?? PRINT_DEFAULTS.caja.fuente,
      fuenteMonto: document.getElementById('pc-caja-fuenteMonto')?.value ?? PRINT_DEFAULTS.caja.fuenteMonto,
    },
  };
  const res = await fetch(`${API}/config/impresion`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tickets),
  });
  if (res.ok) {
    cfgImpresion = tickets;
    toast('✓ Configuración de impresión guardada');
  } else {
    toast('❌ Error al guardar configuración');
  }
}

function cfgKey(tipo) {
  return { categorias: 'cat', proveedores: 'prov', unidades: 'uni' }[tipo];
}

function cfgLista(tipo) {
  return { categorias: cfgCategorias, proveedores: cfgProveedores, unidades: cfgUnidades }[tipo];
}

function renderCfgList(tipo) {
  const items   = cfgLista(tipo);
  const listEl  = document.getElementById(`cfg-${cfgKey(tipo)}-list`);
  const countEl = document.getElementById(`cfg-${cfgKey(tipo)}-count`);

  countEl.textContent = items.length;

  if (!items.length) {
    listEl.innerHTML = `<div class="config-empty">Sin ${tipo} registrados</div>`;
    return;
  }

  listEl.innerHTML = items.map((item, i) => `
    <div class="config-item">
      <span>${item}</span>
      <button class="config-item-del" onclick="cfgRemove('${tipo}', ${i})" title="Eliminar">
        <i class="fas fa-times"></i>
      </button>
    </div>`).join('');
}

async function cfgAdd(tipo) {
  const inputId = { categorias: 'cfg-cat-input', proveedores: 'cfg-prov-input', unidades: 'cfg-uni-input' }[tipo];
  const input   = document.getElementById(inputId);
  const val     = input.value.trim();
  if (!val) return;

  const lista = cfgLista(tipo);
  if (lista.some(x => x.toLowerCase() === val.toLowerCase())) {
    toast('⚠️ Ya existe ese valor'); return;
  }

  lista.push(val);
  await cfgSave(tipo);
  input.value = '';
  renderCfgList(tipo);
}

async function cfgRemove(tipo, idx) {
  const lista = cfgLista(tipo);
  lista.splice(idx, 1);
  await cfgSave(tipo);
  renderCfgList(tipo);
}

async function cfgSave(tipo) {
  const lista = cfgLista(tipo);
  try {
    const res = await fetch(`${API}/config/${tipo}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ valores: lista }),
    });
    if (!res.ok) throw new Error();
    const nombres = { categorias: 'Categorías', proveedores: 'Proveedores', unidades: 'Unidades' };
    toast(`✅ ${nombres[tipo]} guardados`);
  } catch {
    toast('❌ Error al guardar');
  }
}

/* ─── TOAST ─── */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ─── CLOCK ─── */
function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
}

/* ─── INIT ─── */
(async function init() {
  updateClock();
  setInterval(updateClock, 30000);

  // Cargar config (categorías/proveedores) y tabs en paralelo
  await Promise.all([
    fetchConfig(),
    fetchCategorias().then(c => { cats = c; }).catch(() => {}),
  ]);

  buildTabs('s-tabs', 'Todos', 'setScat');
  buildTabs('p-tabs', 'Todos', 'setPcat');

  await loadSales();
  await loadProducts();
  bulkAddRow();   // primera fila vacía lista
})();

function initBulkPage() {
  if (!document.querySelectorAll('#bulk-body tr').length) {
    bulkAddRow();
  } else {
    // Refresca opciones manteniendo selección actual
    document.querySelectorAll('#bulk-body [data-field="categoria"]').forEach(sel => {
      const val = sel.value; sel.innerHTML = catOptions(val);
    });
    document.querySelectorAll('#bulk-body [data-field="proveedor"]').forEach(sel => {
      const val = sel.value; sel.innerHTML = provOptions(val);
    });
    document.querySelectorAll('#bulk-body [data-field="unidad"]').forEach(sel => {
      const val = sel.value; sel.innerHTML = unidadOptions(val);
    });
  }
  hideBanner();
}

/* ─── AUTH ─── */
let _currentUser = null;

function authHeaders() {
  const token = localStorage.getItem('pos_token');
  return token ? { 'Content-Type': 'application/json', 'x-token': token } : { 'Content-Type': 'application/json' };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

async function checkAuth() {
  const token = localStorage.getItem('pos_token');
  if (!token) { showLogin(); return; }
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { 'x-token': token } });
    if (!res.ok) { localStorage.removeItem('pos_token'); showLogin(); return; }
    _currentUser = await res.json();
    applyUser();
    hideLogin();
    loadVersion();
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
}

function hideLogin() {
  document.getElementById('login-overlay').style.display = 'none';
}

function applyUser() {
  if (!_currentUser) return;
  const tipo      = _currentUser.tipo;
  const initials  = _currentUser.username.slice(0, 2).toUpperCase();
  const roleLabel = tipo === 'admin' ? 'Administrador' : 'Vendedor';
  document.getElementById('sb-avatar').textContent = initials;
  document.getElementById('sb-name').textContent   = _currentUser.username;
  document.getElementById('sb-role').textContent   = roleLabel;

  // Mostrar / ocultar elementos según rol
  document.querySelectorAll('[data-roles]').forEach(el => {
    const roles = el.dataset.roles.split(' ');
    el.style.display = roles.includes(tipo) ? '' : 'none';
  });

  // Si la página activa no está permitida, redirigir a la primera disponible
  const activePage = document.querySelector('.page.active');
  const activeNav  = document.querySelector('.nav-item.active');
  if (activeNav && activeNav.style.display === 'none') {
    const firstAllowed = document.querySelector('.nav-item[data-page]');
    if (firstAllowed) firstAllowed.click();
  }
}

async function doLogin() {
  const btn  = document.getElementById('login-btn');
  const err  = document.getElementById('login-error');
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;

  err.classList.remove('show');
  if (!user || !pass) { err.textContent = 'Completa todos los campos'; err.classList.add('show'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verificando…';

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('pos_token', data.token);
    _currentUser = data;
    applyUser();
    hideLogin();
    loadVersion();
    document.getElementById('login-pass').value = '';
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Entrar';
  }
}

async function doLogout() {
  const token = localStorage.getItem('pos_token');
  if (token) await fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'x-token': token } }).catch(() => {});
  localStorage.removeItem('pos_token');
  _currentUser = null;
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').classList.remove('show');
  showLogin();
}

// Verificar auth al cargar
checkAuth();

/* ─── INVENTARIADO ─── */
let _invActual     = null;
let _invCantidad   = 0;
let _invCodigo     = '';
let _invTipo       = null;     // 'parcial' | 'completo'
let _invPendientes = [];       // productos pendientes (solo completo)

function initInventariado() {
  _invActual     = null;
  _invCantidad   = 0;
  _invTipo       = null;
  _invPendientes = [];
  document.getElementById('inv-seleccion').style.display = '';
  document.getElementById('inv-trabajo').style.display   = 'none';
  // reset cards to empty state in case we're re-entering
  const ae = document.getElementById('inv-actual-empty');
  const ai = document.getElementById('inv-actual-info');
  const ce = document.getElementById('inv-cantidad-empty');
  const ci = document.getElementById('inv-cantidad-info');
  if (ae) ae.style.display = '';
  if (ai) ai.style.display = 'none';
  if (ce) ce.style.display = '';
  if (ci) ci.style.display = 'none';
}

async function iniciarInventario(tipo) {
  _invTipo     = tipo;
  _invActual   = null;
  _invCantidad = 0;

  // Badge de tipo
  const badge = document.getElementById('inv-tipo-badge');
  badge.textContent  = tipo === 'completo' ? 'Inventario Completo' : 'Inventario Parcial';
  badge.className    = `pill ${tipo === 'completo' ? 'pill-info' : 'pill-success'}`;

  // Pendientes siempre visible
  document.getElementById('inv-pendientes-section').style.display = '';

  if (tipo === 'completo') {
    // Cargar todos los productos como pendientes
    try {
      const todos = await apiFetch('/productos');
      _invPendientes = todos.map(p => ({ ...p, _id: String(p._id) }));
    } catch { toast('❌ Error cargando productos'); return; }
  }

  document.getElementById('inv-seleccion').style.display = 'none';
  document.getElementById('inv-trabajo').style.display   = '';

  renderInvActual();
  renderInvPendientes();
  await loadInvLog();
  document.getElementById('inv-input')?.focus();
}

function renderInvActual() {
  // — Info card —
  const empty = document.getElementById('inv-actual-empty');
  const info  = document.getElementById('inv-actual-info');
  // — Cantidad card —
  const cantEmpty = document.getElementById('inv-cantidad-empty');
  const cantInfo  = document.getElementById('inv-cantidad-info');

  if (!_invActual) {
    empty.style.display    = '';
    info.style.display     = 'none';
    cantEmpty.style.display = '';
    cantInfo.style.display  = 'none';
    return;
  }

  empty.style.display    = 'none';
  info.style.display     = '';
  cantEmpty.style.display = 'none';
  cantInfo.style.display  = '';

  document.getElementById('inv-actual-nombre').textContent  = _invActual.nombre;
  document.getElementById('inv-actual-codigo').textContent  = _invActual.codigo   || '—';
  document.getElementById('inv-actual-prov').textContent    = _invActual.proveedor || '—';
  document.getElementById('inv-actual-precio').textContent  = _invActual.pVenta != null ? fmt(_invActual.pVenta) : '—';
  document.getElementById('inv-actual-cat').textContent     = _invActual.cat    || '—';
  document.getElementById('inv-actual-unidad').textContent  = _invActual.unidad || '—';

  document.getElementById('inv-stock-anterior').textContent = _invActual.stockAnterior ?? '—';
  document.getElementById('inv-contador').value             = _invCantidad;
}

async function handleInvScan(codigo) {
  if (!codigo) return;
  document.getElementById('inv-input').focus();

  let producto = null;
  try {
    const lista = await apiFetch(`/productos?codigo=${encodeURIComponent(codigo)}`);
    producto = lista[0] ?? null;
  } catch { toast('❌ Error buscando producto'); return; }

  if (!producto) {
    openInvNew(codigo);
    return;
  }

  const mismoProducto = _invActual && _invActual._id === String(producto._id);

  if (mismoProducto) {
    _invCantidad++;
    renderInvActual();
  } else {
    if (_invActual) await guardarInvActual(false);
    _invActual = {
      _id:           String(producto._id),
      nombre:        producto.producto,
      codigo:        producto.codigo    || '',
      proveedor:     producto.proveedor || '',
      pVenta:        producto.pVenta    ?? null,
      cat:           producto.cat       || '',
      unidad:        producto.unidad    || '',
      stockAnterior: producto.stock     ?? 0,
    };
    _invCantidad = 1;
    renderInvActual();
  }
}

async function confirmarStockActual() {
  if (!_invActual) return;
  _invCantidad = _invActual.stockAnterior ?? 0;
  document.getElementById('inv-contador').value = _invCantidad;
  await guardarInvActual(true);
}

function invAjustar(delta) {
  if (!_invActual) return;
  _invCantidad = Math.max(0, _invCantidad + delta);
  document.getElementById('inv-contador').value = _invCantidad;
}

// silently=true cuando se llama desde terminarInventario (no mostrar toast, no recargar log)
async function guardarInvActual(manual = false, silently = false) {
  if (!_invActual) return;
  // sync from input in case user typed directly
  const contadorEl = document.getElementById('inv-contador');
  _invCantidad = Math.max(0, parseInt(contadorEl ? contadorEl.value : '0') || 0);
  try {
    await apiFetch('/inventariado', {
      method: 'POST',
      body:   JSON.stringify({
        productoId:    _invActual._id,
        nombre:        _invActual.nombre,
        cantidad:      _invCantidad,
        stockAnterior: _invActual.stockAnterior,
        proveedor:     _invActual.proveedor,
        pVenta:        _invActual.pVenta,
      }),
    });
    if (!silently) toast(`✅ ${_invActual.nombre} — ${_invCantidad} uds guardadas`);
    // Quitar de pendientes si es inventario completo
    if (_invTipo === 'completo') {
      _invPendientes = _invPendientes.filter(p => p._id !== _invActual._id);
      if (!silently) renderInvPendientes();
    }
    _invActual   = null;
    _invCantidad = 0;
    renderInvActual();
    if (!silently) await loadInvLog();
  } catch (err) {
    if (!silently) toast(`❌ ${err.message}`);
    else throw err; // propagar al llamador cuando es silencioso
  }
  if (manual) document.getElementById('inv-input')?.focus();
}

function renderInvPendientes() {
  const tbody = document.getElementById('inv-pendientes-body');
  const countEl = document.getElementById('inv-pendientes-count');

  if (_invTipo !== 'completo') {
    countEl.textContent = '';
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:24px;font-size:13px;">Inventario parcial — sin lista de pendientes</td></tr>`;
    return;
  }

  const q     = (document.getElementById('inv-pendientes-search')?.value || '').toLowerCase();
  const lista = q
    ? _invPendientes.filter(p => p.producto.toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q))
    : _invPendientes;

  countEl.textContent = `(${_invPendientes.length})`;

  tbody.innerHTML = !lista.length
    ? `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px;">Todos los productos inventariados ✅</td></tr>`
    : lista.map(p => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:9px 12px;font-weight:500;font-size:13px;">${p.producto}</td>
          <td style="padding:9px 12px;color:var(--muted);font-size:13px;">${p.cat || p.categoria || '—'}</td>
          <td style="padding:9px 12px;text-align:center;font-weight:600;">${p.stock ?? 0}</td>
        </tr>`).join('');
}

async function loadInvLog() {
  try {
    const logs  = await apiFetch('/inventariado');
    const tbody = document.getElementById('inv-log-body');
    const count = document.getElementById('inv-log-count');
    if (count) count.textContent = logs.length ? `(${logs.length})` : '';

    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">Sin registros</td></tr>`;
      return;
    }
    tbody.innerHTML = logs.map(r => {
      const v      = r.variacion;
      const vStr   = v == null ? '—' : (v > 0 ? `+${v}` : String(v));
      const vColor = v == null ? 'var(--muted)' : v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--muted)';
      return `
        <tr data-id="${r.productoId || ''}" style="border-bottom:1px solid var(--border);">
          <td style="padding:9px 12px;font-weight:500;font-size:13px;">${r.nombre}</td>
          <td style="padding:9px 12px;text-align:center;color:var(--muted);font-size:13px;">${r.stockAnterior ?? '—'}</td>
          <td style="padding:9px 12px;text-align:center;font-weight:700;color:var(--primary);">${r.cantidad}</td>
          <td style="padding:9px 12px;text-align:center;font-weight:700;color:${vColor};">${vStr}</td>
          <td style="padding:9px 12px;text-align:right;color:var(--muted);font-size:12px;">${r.hora}</td>
        </tr>`;
    }).join('');
  } catch { /* ignorar */ }
}

async function terminarInventario() {
  if (_invActual) {
    try { await guardarInvActual(false, true); }
    catch { toast('❌ Error guardando el último producto'); return; }
  }

  const logs = await apiFetch('/inventariado').catch(() => []);
  if (!logs.length) { toast('⚠️ No hay registros en esta sesión'); return; }

  // Guardar como evento en inv_reportes y limpiar sesión
  let reporte;
  try {
    reporte = await apiFetch('/inv-reportes', {
      method: 'POST',
      body: JSON.stringify({ tipo: _invTipo }),
    });
  } catch (err) { toast(`❌ Error guardando reporte: ${err.message}`); return; }

  // Mostrar resumen
  const stat = (label, value, color = 'var(--text)') => `
    <div class="table-card" style="padding:16px;text-align:center;">
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color};">${value}</div>
    </div>`;

  const s = reporte.stats;
  const vColor = s.valorTotal < 0 ? 'var(--danger)' : s.valorTotal > 0 ? 'var(--success)' : 'var(--muted)';

  if (_invTipo === 'parcial') {
    document.getElementById('inv-reporte-resumen').innerHTML =
      stat('Inventariados', s.inventariados) +
      stat('Con variación', s.conVariacion, s.conVariacion ? '#f59e0b' : 'var(--muted)') +
      stat('Faltantes', s.faltantes, s.faltantes ? 'var(--danger)' : 'var(--muted)') +
      stat('Impacto económico', (s.valorTotal >= 0 ? '+' : '') + fmt(s.valorTotal), vColor);
  } else {
    const total = s.inventariados + s.sinInventariar;
    document.getElementById('inv-reporte-resumen').innerHTML =
      stat('Total catálogo', total) +
      stat('Inventariados', s.inventariados, 'var(--success)') +
      stat('Sin inventariar', s.sinInventariar, s.sinInventariar ? 'var(--danger)' : 'var(--muted)') +
      stat('Impacto económico', (s.valorTotal >= 0 ? '+' : '') + fmt(s.valorTotal), vColor);
  }

  document.getElementById('inv-reporte-overlay').classList.add('open');

  // Limpiar sesión local
  _invActual     = null;
  _invCantidad   = 0;
  _invTipo       = null;
  _invPendientes = [];
}

function closeInvReporte() {
  document.getElementById('inv-reporte-overlay').classList.remove('open');
}

// Navega programáticamente a una página del sidebar
function navTo(page) {
  const item = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (item) item.click();
}

async function loadInvReporte() {
  const mesEl = document.getElementById('inv-rep-mes');
  const mes   = mesEl?.value || new Date().toISOString().slice(0, 7);

  const lista = await apiFetch(`/inv-reportes?mes=${mes}`).catch(() => []);
  const tbody = document.getElementById('inv-rep-body');
  const empty = document.getElementById('inv-rep-empty');

  if (!lista.length) {
    tbody.innerHTML     = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = lista.map(r => {
    const s       = r.stats || {};
    const vColor  = s.valorTotal < 0 ? 'var(--danger)' : s.valorTotal > 0 ? 'var(--success)' : 'var(--muted)';
    const tipoPill = r.tipo === 'completo'
      ? `<span class="pill pill-info" style="font-size:11px;">Completo</span>`
      : `<span class="pill pill-success" style="font-size:11px;">Parcial</span>`;
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:10px 12px;font-size:13px;">${r.fecha}</td>
        <td style="padding:10px 12px;color:var(--muted);font-size:13px;">${r.hora}</td>
        <td style="padding:10px 12px;">${tipoPill}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;">${s.inventariados ?? '—'}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;color:${s.sinInventariar ? 'var(--danger)' : 'var(--muted)'};">${s.sinInventariar ?? '—'}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:${vColor};">${s.valorTotal != null ? (s.valorTotal >= 0 ? '+' : '') + fmt(s.valorTotal) : '—'}</td>
        <td style="padding:10px 12px;text-align:right;">
          <button onclick="openInvDetalle('${r._id}')" class="btn-secondary" style="padding:5px 12px;font-size:12px;">
            <i class="fas fa-eye"></i> Ver
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function openInvDetalle(id) {
  const r = await apiFetch(`/inv-reportes/${id}`).catch(() => null);
  if (!r) { toast('❌ Error cargando reporte'); return; }

  const s = r.stats || {};
  document.getElementById('inv-detalle-titulo').textContent    = `Inventario ${r.tipo === 'completo' ? 'Completo' : 'Parcial'}`;
  document.getElementById('inv-detalle-subtitulo').textContent = `${r.fecha}  ·  ${r.hora}`;

  const stat = (label, value, color = 'var(--text)') => `
    <div class="table-card" style="padding:14px;text-align:center;">
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${color};">${value}</div>
    </div>`;

  const vColor = s.valorTotal < 0 ? 'var(--danger)' : s.valorTotal > 0 ? 'var(--success)' : 'var(--muted)';
  if (r.tipo === 'parcial') {
    document.getElementById('inv-detalle-stats').innerHTML =
      stat('Inventariados', s.inventariados) +
      stat('Con variación', s.conVariacion, s.conVariacion ? '#f59e0b' : 'var(--muted)') +
      stat('Faltantes', s.faltantes, s.faltantes ? 'var(--danger)' : 'var(--muted)') +
      stat('Impacto económico', (s.valorTotal >= 0 ? '+' : '') + fmt(s.valorTotal), vColor);
  } else {
    document.getElementById('inv-detalle-stats').innerHTML =
      stat('Total catálogo', s.inventariados + s.sinInventariar) +
      stat('Inventariados', s.inventariados, 'var(--success)') +
      stat('Sin inventariar', s.sinInventariar, s.sinInventariar ? 'var(--danger)' : 'var(--muted)') +
      stat('Impacto económico', (s.valorTotal >= 0 ? '+' : '') + fmt(s.valorTotal), vColor);
  }

  const fila = p => {
    const v      = p.variacion;
    const vStr   = v == null ? '—' : (v > 0 ? `+${v}` : `${v}`);
    const vStyle = v == null ? '' : v > 0 ? 'color:var(--success);' : v < 0 ? 'color:var(--danger);' : '';
    const valor  = v != null && p.pVenta != null ? v * p.pVenta : null;
    const mStr   = valor == null ? '—' : (valor >= 0 ? '+' : '') + fmt(valor);
    const mStyle = valor == null ? '' : valor > 0 ? 'color:var(--success);' : valor < 0 ? 'color:var(--danger);' : '';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:9px 12px;font-weight:600;font-size:13px;">${p.nombre}</td>
      <td style="padding:9px 12px;color:var(--muted);font-size:13px;">${p.proveedor || '—'}</td>
      <td style="padding:9px 12px;text-align:right;font-size:13px;">${p.pVenta != null ? fmt(p.pVenta) : '—'}</td>
      <td style="padding:9px 12px;text-align:center;color:var(--muted);">${p.stockAnterior ?? '—'}</td>
      <td style="padding:9px 12px;text-align:center;font-weight:700;">${p.cantidad ?? '—'}</td>
      <td style="padding:9px 12px;text-align:center;font-weight:700;${vStyle}">${vStr}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700;${mStyle}">${mStr}</td>
    </tr>`;
  };

  const filasInv   = (r.productos  || []).map(fila).join('');
  const filasNoInv = (r.pendientes || []).map(p => `
    <tr style="border-bottom:1px solid var(--border);opacity:.6;">
      <td style="padding:9px 12px;font-size:13px;">${p.producto || p.nombre}</td>
      <td style="padding:9px 12px;color:var(--muted);font-size:13px;">${p.proveedor || '—'}</td>
      <td style="padding:9px 12px;text-align:right;font-size:13px;">${p.pVenta != null ? fmt(p.pVenta) : '—'}</td>
      <td style="padding:9px 12px;text-align:center;color:var(--muted);">${p.stock ?? '—'}</td>
      <td colspan="3" style="padding:9px 12px;text-align:center;">
        <span style="background:#fef2f2;color:var(--danger);font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;">Sin inventariar</span>
      </td>
    </tr>`).join('');

  document.getElementById('inv-detalle-body').innerHTML =
    (filasInv   ? `<tr><td colspan="7" style="padding:8px 12px;background:var(--success-bg);font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.5px;">Inventariados (${r.productos.length})</td></tr>${filasInv}` : '') +
    (filasNoInv ? `<tr><td colspan="7" style="padding:8px 12px;background:#fef2f2;font-size:11px;font-weight:700;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;">Sin inventariar (${r.pendientes.length})</td></tr>${filasNoInv}` : '');

  document.getElementById('inv-detalle-overlay').classList.add('open');
}

function closeInvDetalle() {
  document.getElementById('inv-detalle-overlay').classList.remove('open');
}

async function invNewImgUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (!_invCodigo) { toast('⚠️ Sin código de producto'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = await apiFetch('/imagenes', { method: 'POST', body: JSON.stringify({ codigo: _invCodigo, base64: e.target.result }) });
      invNewMostrarImagen(data.url);
    } catch (err) { toast(`❌ ${err.message}`); }
  };
  reader.readAsDataURL(file);
}

function invNewMostrarImagen(src) {
  const img   = document.getElementById('inv-new-img');
  const empty = document.getElementById('inv-new-img-empty');
  img.src = src;
  img.style.display = '';
  empty.style.display = 'none';
}

function invNewOcultarImagen() {
  const img   = document.getElementById('inv-new-img');
  const empty = document.getElementById('inv-new-img-empty');
  img.src = '';
  img.style.display = 'none';
  empty.style.display = '';
}

function invNewStatus(icono, texto, spinning = false) {
  const wrap = document.getElementById('inv-new-status');
  const icon = document.getElementById('inv-new-status-icon');
  const txt  = document.getElementById('inv-new-status-txt');
  wrap.style.display = 'flex';
  icon.className = `fas fa-${icono}${spinning ? ' fa-spin' : ''}`;
  txt.textContent = texto;
}

function invNewOcultarStatus() {
  document.getElementById('inv-new-status').style.display = 'none';
}

async function openInvNew(codigo) {
  _invCodigo      = codigo;
  document.getElementById('inv-new-codigo').textContent   = codigo;
  document.getElementById('inv-new-nombre').value         = '';
  document.getElementById('inv-new-pventa').value         = '';
  document.getElementById('inv-new-pcosto').value         = '';
  document.getElementById('inv-new-cat').innerHTML        = catOptions();
  document.getElementById('inv-new-unidad').innerHTML     = unidadOptions();
  invNewOcultarImagen();
  invNewStatus('circle-notch', 'Intentando extraer info de internet…', true);
  document.getElementById('inv-new-overlay').classList.add('open');

  try {
    const data = await apiFetch(`/buscar-codigo/${encodeURIComponent(codigo)}`);
    if (data.encontrado) {
      document.getElementById('inv-new-nombre').value = data.nombre || '';
      if (data.tieneImagen) {
        const url = `/imagenes/${encodeURIComponent(codigo)}.jpg`;
        invNewMostrarImagen(url);
      }
      invNewStatus('check', 'Información obtenida de internet');
    } else {
      invNewStatus('triangle-exclamation', 'No se encontró info en internet');
    }
  } catch {
    invNewOcultarStatus();
  }

  setTimeout(() => document.getElementById('inv-new-nombre').focus(), 100);
}

function closeInvNew() {
  document.getElementById('inv-new-overlay').classList.remove('open');
  document.getElementById('inv-input')?.focus();
}

async function guardarInvNuevo() {
  const nombre = document.getElementById('inv-new-nombre').value.trim();
  const pVenta = parseFloat(document.getElementById('inv-new-pventa').value) || null;
  const pCosto = parseFloat(document.getElementById('inv-new-pcosto').value) || null;
  const cat    = document.getElementById('inv-new-cat').value;
  const unidad = document.getElementById('inv-new-unidad').value;

  if (!nombre) { toast('⚠️ El nombre es requerido'); return; }

  try {
    const prod = await apiFetch('/productos', {
      method: 'POST',
      body:   JSON.stringify({ codigo: _invCodigo, producto: nombre, pVenta, pCosto, categoria: cat, unidad, stock: 0 }),
    });
    closeInvNew();
    toast('✅ Producto registrado');
    if (_invActual) await guardarInvActual(false);
    _invActual   = { _id: String(prod._id), nombre: prod.producto, codigo: prod.codigo };
    _invCantidad = 1;
    renderInvActual();
  } catch (err) { toast(`❌ ${err.message}`); }
}

/* ─── VERSIÓN ─── */
let _versionData = null;

async function loadVersion() {
  try {
    const data = await apiFetch('/version');
    _versionData = data;
    const pill = document.getElementById('version-pill');
    if (pill) pill.textContent = data.current ?? 'sin versión';
  } catch { /* sin internet o git */ }
}

function openVersionModal() {
  if (!_versionData) return;
  const isAdmin = _currentUser?.tipo === 'admin';

  document.getElementById('version-current').textContent = _versionData.current ?? 'sin versión';
  document.getElementById('version-no-admin').style.display = isAdmin ? 'none' : '';

  const list = document.getElementById('version-list');
  if (!_versionData.tags.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:12px 0;">Sin versiones etiquetadas</div>';
  } else {
    list.innerHTML = _versionData.tags.map(tag => {
      const isCurrent = tag === _versionData.current;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:8px;background:var(--bg);border:1px solid ${isCurrent ? 'var(--primary)' : 'var(--border)'};">
          <span style="font-weight:600;${isCurrent ? 'color:var(--primary)' : ''}">${tag}${isCurrent ? ' <span style="font-size:11px;font-weight:400;">(actual)</span>' : ''}</span>
          ${isAdmin && !isCurrent
            ? `<button class="btn-primary" style="padding:5px 14px;font-size:13px;" onclick="doRollback('${tag}')">Bajar a esta</button>`
            : ''}
        </div>`;
    }).join('');
  }

  document.getElementById('version-overlay').classList.add('open');
}

function closeVersionModal() {
  document.getElementById('version-overlay').classList.remove('open');
}

async function doRollback(version) {
  if (!confirm(`¿Cambiar a la versión ${version}? El servidor se reiniciará.`)) return;
  try {
    await apiFetch('/version/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    toast(`🔄 Cambiando a ${version}... la página se recargará en 3s`);
    setTimeout(() => location.reload(), 3000);
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ─── SIDEBAR TOGGLE ─── */
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const collapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
}

// Restaurar estado al cargar
(function() {
  if (localStorage.getItem('sidebar_collapsed') === '1') {
    document.querySelector('.sidebar')?.classList.add('collapsed');
  }
})();

/* ─── USUARIOS ─── */
async function loadUsuarios() {
  try {
    const res   = await fetch(`${API}/usuarios`, { headers: authHeaders() });
    const lista = await res.json();
    renderUsuarios(lista);
  } catch { toast('❌ Error cargando usuarios'); }
}

function renderUsuarios(lista) {
  const ctr = document.getElementById('usr-list');
  if (!lista.length) { ctr.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:14px;">Sin usuarios</div>'; return; }

  ctr.innerHTML = lista.map(u => {
    const isSelf  = _currentUser && u.username === _currentUser.username;
    const tagBg   = u.tipo === 'admin' ? 'var(--primary-light)' : 'var(--bg)';
    const tagCl   = u.tipo === 'admin' ? 'var(--primary-dark)'  : 'var(--muted)';
    const tagTxt  = u.tipo === 'admin' ? 'Admin' : 'Vendedor';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
          padding:14px 20px;border-bottom:1px solid var(--border);gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);
            color:#fff;display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:14px;flex-shrink:0;">
            ${u.username.slice(0,2).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:600;font-size:14px;">${u.username}${isSelf ? ' <span style="font-size:11px;color:var(--muted);">(tú)</span>' : ''}</div>
            <span style="font-size:12px;font-weight:600;background:${tagBg};color:${tagCl};
              padding:2px 8px;border-radius:20px;">${tagTxt}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <select onchange="cambiarTipo('${u._id}', this.value)"
            style="padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;
              font-family:inherit;font-size:13px;cursor:pointer;">
            <option value="vendedor"${u.tipo==='vendedor'?' selected':''}>Vendedor</option>
            <option value="admin"${u.tipo==='admin'?' selected':''}>Admin</option>
          </select>
          ${!isSelf ? `<button onclick="eliminarUsuario('${u._id}','${u.username}')"
            style="border:none;background:var(--danger-bg);color:var(--danger);
              border-radius:7px;padding:6px 10px;cursor:pointer;font-size:13px;"
            title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function crearUsuario() {
  const username = document.getElementById('nu-user').value.trim();
  const password = document.getElementById('nu-pass').value;
  const tipo     = document.getElementById('nu-tipo').value;
  if (!username || !password) { toast('⚠️ Completa usuario y contraseña'); return; }
  try {
    const res = await fetch(`${API}/usuarios`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ username, password, tipo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(`✅ Usuario "${username}" creado`);
    document.getElementById('nu-user').value = '';
    document.getElementById('nu-pass').value = '';
    loadUsuarios();
  } catch (e) { toast(`❌ ${e.message}`); }
}

async function cambiarTipo(id, tipo) {
  try {
    const res = await fetch(`${API}/usuarios/${id}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ tipo }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('✅ Tipo actualizado');
    loadUsuarios();
  } catch (e) { toast(`❌ ${e.message}`); }
}

async function eliminarUsuario(id, nombre) {
  if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return;
  try {
    const res = await fetch(`${API}/usuarios/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast(`✅ Usuario eliminado`);
    loadUsuarios();
  } catch (e) { toast(`❌ ${e.message}`); }
}

/* ─── DASHBOARD ─── */
let _chartStock = null;

async function loadDashboard() {
  try {
    const [resDash, resProd] = await Promise.all([
      fetch(`${API}/dashboard`),
      fetch(`${API}/productos`),
    ]);
    const data  = await resDash.json();
    const prods = (await resProd.json()).map(mapDoc);

    renderDashCards(data.hoy);
    renderChartStock(prods);
    renderStockBajo(prods);
    renderCalendario(data.mes);
  } catch (err) {
    toast(`❌ Error cargando dashboard: ${err.message}`);
  }
}

function renderDashCards(hoy) {
  const margen = hoy.total > 0 ? ((hoy.ganancia / hoy.total) * 100).toFixed(1) : '0.0';
  document.getElementById('d-ventas').textContent   = fmt(hoy.total);
  document.getElementById('d-ganancia').textContent = fmt(hoy.ganancia);
  document.getElementById('d-trans').textContent    = hoy.transacciones;
  document.getElementById('d-margen').textContent   = margen + '%';
}

const PASTEL_COLORS = [
  '#3B82F6','#22C55E','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#EC4899','#84CC16','#F97316','#6366F1',
];

function renderChartStock(prods) {
  const sinStock  = prods.filter(p => p.stock === 0).length;
  const bajStock  = prods.filter(p => p.stock > 0 && p.stock <= 5).length;
  const normStock = prods.filter(p => p.stock > 5).length;

  if (_chartStock) { _chartStock.destroy(); _chartStock = null; }

  const ctx = document.getElementById('chart-stock').getContext('2d');
  _chartStock = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Sin stock', 'Stock bajo (≤5)', 'Stock normal (>5)'],
      datasets: [{
        data: [sinStock, bajStock, normStock],
        backgroundColor: ['#EF4444', '#F59E0B', '#22C55E'],
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 13 }, boxWidth: 14, padding: 14 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} productos`,
          },
        },
      },
    },
  });
}

function renderStockBajo(prods) {
  const ordenados = [...prods]
    .filter(p => p.stock >= 0)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 15);

  const ctr = document.getElementById('d-stock-bajo');
  if (!ordenados.length) { ctr.innerHTML = '<div style="color:var(--muted);font-size:14px;">Sin productos</div>'; return; }

  ctr.innerHTML = ordenados.map(p => {
    const sc = p.stock === 0 ? 'var(--danger)' : p.stock <= 5 ? 'var(--warning)' : 'var(--success)';
    const bg = p.stock === 0 ? 'var(--danger-bg)' : p.stock <= 5 ? 'var(--warning-bg)' : 'var(--success-bg)';
    return `<div style="display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;border-radius:8px;background:var(--bg);gap:12px;">
      <div style="font-size:13px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</div>
      <div style="font-size:12px;color:var(--muted);flex-shrink:0;">${p.cat}</div>
      <div style="background:${bg};color:${sc};font-size:12px;font-weight:700;
        padding:2px 10px;border-radius:20px;flex-shrink:0;">${p.stock} uds</div>
    </div>`;
  }).join('');
}

function renderCalendario(mes) {
  const ahora   = new Date();
  const anio    = ahora.getFullYear();
  const mesNum  = ahora.getMonth();
  const hoyDia  = ahora.getDate();
  const meses   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  document.getElementById('d-cal-titulo').textContent = `Ventas de ${meses[mesNum]} ${anio}`;

  const primerDia = new Date(anio, mesNum, 1).getDay(); // 0=Dom
  const diasMes   = new Date(anio, mesNum + 1, 0).getDate();

  // Mapear datos
  const totalesPorDia = {};
  for (const d of mes) totalesPorDia[d.dia] = d.total;

  let html = '';
  // Celdas vacías al inicio
  for (let i = 0; i < primerDia; i++) {
    html += `<div class="dash-cal-day empty-day"></div>`;
  }
  // Días del mes
  for (let d = 1; d <= diasMes; d++) {
    const total   = totalesPorDia[d] || 0;
    const esHoy   = d === hoyDia;
    const hasSale = total > 0;
    html += `<div class="dash-cal-day${hasSale ? ' has-sales' : ''}${esHoy ? ' today' : ''}">
      <span class="cal-day-num">${d}</span>
      ${hasSale
        ? `<span class="cal-day-total">${fmt(total)}</span>`
        : `<span class="cal-day-empty">—</span>`}
    </div>`;
  }

  document.getElementById('d-calendario').innerHTML = html;
}

/* ─── NUEVO PEDIDO ─── */
let pedRows = [];
let pedRowId = 0;

function initNuevoPedido() {
  const ahora = new Date();
  document.getElementById('ped-fecha').value = ahora.toISOString().split('T')[0];
  document.getElementById('ped-hora').value  = ahora.toTimeString().slice(0, 5);
  document.getElementById('ped-nota').value  = '';

  // Poblar proveedor
  const sel = document.getElementById('ped-proveedor');
  sel.innerHTML = '<option value="">Sin proveedor</option>' +
    cfgProveedores.map(p => `<option value="${p}">${p}</option>`).join('');

  // Limpiar filas
  pedRows = [];
  pedRowId = 0;
  document.getElementById('ped-body').innerHTML = '';
  pedUpdateTotal();
  pedAddRow();
}

function pedAddRow() {
  const id  = ++pedRowId;
  const row = { id, productoId: '', nombre: '', cantidad: 1, unidad: '', costo: 0 };
  pedRows.push(row);

  const tr = document.createElement('tr');
  tr.id = `ped-row-${id}`;
  tr.innerHTML = `
    <td>
      <input class="ped-input" type="text" placeholder="Nombre o código…"
        id="ped-n-${id}"
        oninput="pedBuscar(${id}, this.value)"
        onkeydown="pedNombreKeydown(event, ${id})"
        autocomplete="off">
      <div id="ped-sug-${id}" style="position:relative;"></div>
    </td>
    <td style="width:90px;">
      <input class="ped-input" type="number" min="0" step="any" value="1"
        id="ped-q-${id}" oninput="pedCalc(${id})">
    </td>
    <td style="width:90px;">
      <select class="ped-select" id="ped-u-${id}">
        ${unidadOptions('')}
      </select>
    </td>
    <td style="width:120px;">
      <input class="ped-input" type="number" min="0" step="0.01" placeholder="0.00"
        id="ped-c-${id}" oninput="pedCalc(${id})">
    </td>
    <td style="width:110px;">
      <span class="ped-sub" id="ped-s-${id}">$0.00</span>
    </td>
    <td style="width:36px;">
      <button class="btn-row-del" onclick="pedRemoveRow(${id})">
        <i class="fas fa-times"></i>
      </button>
    </td>`;
  document.getElementById('ped-body').appendChild(tr);
}

let _pedDebounce = {};
let _pedSugs     = {}; // id → lista de productos encontrados

async function pedBuscarNow(id) {
  const q   = document.getElementById(`ped-n-${id}`)?.value.trim() || '';
  const ctr = document.getElementById(`ped-sug-${id}`);
  _pedSugs[id] = [];
  if (!q) { ctr.innerHTML = ''; return; }
  try {
    const res  = await fetch(`${API}/productos?q=${encodeURIComponent(q)}`);
    const list = (await res.json()).slice(0, 6).map(mapDoc);
    _pedSugs[id] = list;
    if (!list.length) { ctr.innerHTML = ''; return; }
    ctr.innerHTML = `<div style="position:absolute;top:2px;left:0;right:0;background:var(--card);
      border:1.5px solid var(--primary);border-radius:8px;z-index:200;box-shadow:var(--shadow-md);overflow:hidden;">
      ${list.map(p => `
        <div onclick="pedSelectProducto(${id}, ${JSON.stringify(p)})"
          style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);"
          onmouseover="this.style.background='var(--primary-light)'"
          onmouseout="this.style.background=''">
          <span style="font-weight:600;">${p.name}</span>
          <span style="color:var(--muted);font-size:12px;margin-left:6px;">${p.sku || ''}</span>
          <span style="float:right;color:var(--primary);font-weight:600;">${fmt(p.retail || p.price)}</span>
        </div>`).join('')}
    </div>`;
  } catch { ctr.innerHTML = ''; }
}

function pedBuscar(id, q) {
  clearTimeout(_pedDebounce[id]);
  _pedSugs[id] = [];
  _pedDebounce[id] = setTimeout(() => pedBuscarNow(id), 250);
}

async function pedNombreKeydown(e, id) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(_pedDebounce[id]);
  await pedBuscarNow(id);
  const p = (_pedSugs[id] || [])[0];
  if (!p) { toast('⚠️ Producto no encontrado'); return; }
  pedSelectProducto(id, p);
  // Mover foco a cantidad
  document.getElementById(`ped-q-${id}`)?.focus();
}

function pedSelectProducto(id, p) {
  const row = pedRows.find(r => r.id === id);
  if (!row) return;
  row.productoId = p._id;
  row.nombre     = p.name;
  row.unidad     = p.unidad || '';
  document.getElementById(`ped-n-${id}`).value = p.name;
  document.getElementById(`ped-sug-${id}`).innerHTML = '';

  // Unidad del producto
  const sel = document.getElementById(`ped-u-${id}`);
  for (const opt of sel.options) if (opt.value === p.unidad) { opt.selected = true; break; }

  // Costo = precio retail (pCosto) del producto
  const costo = p.retail || 0;
  document.getElementById(`ped-c-${id}`).value = costo > 0 ? costo.toFixed(2) : '';
  pedCalc(id);
}

function pedCalc(id) {
  const q   = parseFloat(document.getElementById(`ped-q-${id}`)?.value) || 0;
  const c   = parseFloat(document.getElementById(`ped-c-${id}`)?.value) || 0;
  const sub = q * c;
  const row = pedRows.find(r => r.id === id);
  if (row) { row.cantidad = q; row.costo = c; row.unidad = document.getElementById(`ped-u-${id}`)?.value || ''; }
  document.getElementById(`ped-s-${id}`).textContent = fmt(sub);
  pedUpdateTotal();
}

function pedUpdateTotal() {
  const total = pedRows.reduce((s, r) => {
    const q = parseFloat(document.getElementById(`ped-q-${r.id}`)?.value) || 0;
    const c = parseFloat(document.getElementById(`ped-c-${r.id}`)?.value) || 0;
    return s + q * c;
  }, 0);
  document.getElementById('ped-total').textContent = fmt(total);
}

function pedRemoveRow(id) {
  pedRows = pedRows.filter(r => r.id !== id);
  document.getElementById(`ped-row-${id}`)?.remove();
  pedUpdateTotal();
}

async function guardarPedido() {
  const proveedor = document.getElementById('ped-proveedor').value.trim();
  const fecha     = document.getElementById('ped-fecha').value;
  const hora      = document.getElementById('ped-hora').value || '00:00';
  const nota      = document.getElementById('ped-nota').value.trim();

  if (!fecha) { toast('⚠️ Selecciona una fecha'); return; }

  // Recoger productos con datos actuales del DOM
  const productos = pedRows.map(r => ({
    productoId: r.productoId,
    nombre:     document.getElementById(`ped-n-${r.id}`)?.value.trim() || '',
    cantidad:   parseFloat(document.getElementById(`ped-q-${r.id}`)?.value) || 0,
    unidad:     document.getElementById(`ped-u-${r.id}`)?.value || '',
    costo:      parseFloat(document.getElementById(`ped-c-${r.id}`)?.value) || 0,
  })).filter(p => p.nombre && p.cantidad > 0);

  if (!productos.length) { toast('⚠️ Agrega al menos un producto'); return; }

  try {
    const res = await fetch(`${API}/pedidos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ proveedor, fecha, hora, nota, productos }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const ped = await res.json();
    toast(`✅ ${ped.folio} guardado — inventario actualizado`);
    initNuevoPedido();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ─── PEDIDOS HISTORIAL ─── */
let _todosLosPedidos = [];

async function loadPedidos() {
  document.getElementById('pd-body').innerHTML =
    `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted);">
      <i class="fas fa-circle-notch fa-spin"></i> Cargando…</td></tr>`;
  try {
    const res  = await fetch(`${API}/pedidos`);
    const data = await res.json();
    _todosLosPedidos = data.pedidos || [];
    renderPedidosStats(_todosLosPedidos);
    renderPedidosTable(_todosLosPedidos);
  } catch {
    document.getElementById('pd-body').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger);">Error al cargar pedidos</td></tr>`;
  }
}

function filtrarPedidos() {
  const q = document.getElementById('pd-search').value.toLowerCase();
  const filtered = _todosLosPedidos.filter(p =>
    (p.proveedor || '').toLowerCase().includes(q) ||
    (p.folio     || '').toLowerCase().includes(q)
  );
  renderPedidosTable(filtered);
}

function renderPedidosStats(pedidos) {
  const total  = pedidos.reduce((s, p) => s + p.total, 0);
  const ultimo = pedidos.length
    ? new Date(pedidos[0].fecha).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
    : '—';
  document.getElementById('pd-count').textContent = pedidos.length;
  document.getElementById('pd-total').textContent = fmt(total);
  document.getElementById('pd-ultimo').textContent = ultimo;
}

function renderPedidosTable(pedidos) {
  if (!pedidos.length) {
    document.getElementById('pd-body').innerHTML =
      `<tr><td colspan="7" class="empty">Sin pedidos registrados</td></tr>`;
    return;
  }

  document.getElementById('pd-body').innerHTML = pedidos.map(p => {
    const fecha = new Date(p.fecha);
    const fStr  = fecha.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });

    const detalle = p.productos.map(pr => `
      <div class="venta-prod-item">
        <span style="flex:1;">${pr.nombre}</span>
        <span style="color:var(--muted);font-size:12px;min-width:80px;text-align:right;">${fmt(pr.costo)} / ${pr.unidad || 'u.'}</span>
        <span style="color:var(--muted);font-size:12px;min-width:60px;text-align:right;">× ${pr.cantidad} ${pr.unidad || 'u.'}</span>
        <span style="font-weight:600;min-width:72px;text-align:right;">${fmt(pr.subtotal)}</span>
      </div>`).join('');

    return `
      <tr class="expandable" onclick="toggleDetalle('pd-${p._id}')">
        <td style="color:var(--muted);font-size:12px;">
          <i class="fas fa-chevron-right" id="ico-pd-${p._id}" style="transition:transform .2s;"></i>
        </td>
        <td style="font-family:monospace;font-weight:600;font-size:13px;">${p.folio}</td>
        <td>${fStr}</td>
        <td>${p.proveedor || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:center;">${p.productos.length} prod.</td>
        <td style="font-weight:700;">${fmt(p.total)}</td>
        <td style="color:var(--muted);font-size:13px;">${p.nota || '—'}</td>
      </tr>
      <tr id="det-pd-${p._id}">
        <td colspan="7" style="padding:0 18px;">
          <div class="venta-row-detail" id="body-pd-${p._id}">
            <div style="font-weight:600;font-size:12px;color:var(--muted);margin-bottom:6px;">PRODUCTOS DEL PEDIDO</div>
            <div class="venta-prod-list">${detalle}</div>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function toggleDetalle(id) {
  const body = document.getElementById(`body-${id}`);
  const ico  = document.getElementById(`ico-${id}`);
  const open = body.classList.toggle('open');
  ico.style.transform = open ? 'rotate(90deg)' : '';
}

/* ─── CAJA ─── */
let _cajaTipo = 'deposito';

function setCajaTipo(tipo) {
  _cajaTipo = tipo;
  const isDeposito = tipo === 'deposito';
  const dep = document.getElementById('caja-btn-dep');
  const ret = document.getElementById('caja-btn-ret');
  dep.style.borderColor = isDeposito ? 'var(--success)' : 'var(--border)';
  dep.style.background  = isDeposito ? 'var(--success-bg)' : 'var(--card)';
  dep.style.color       = isDeposito ? '#166534' : 'var(--muted)';
  ret.style.borderColor = !isDeposito ? 'var(--danger)' : 'var(--border)';
  ret.style.background  = !isDeposito ? '#fef2f2' : 'var(--card)';
  ret.style.color       = !isDeposito ? '#991b1b' : 'var(--muted)';
}

function initCajaMov() {
  setCajaTipo('deposito');
}

async function guardarMovCaja() {
  const monto    = parseFloat(document.getElementById('caja-monto').value);
  const concepto = document.getElementById('caja-concepto').value.trim();
  if (!monto || monto <= 0) { toast('⚠️ Ingresa un monto válido'); return; }

  try {
    await apiFetch('/caja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: _cajaTipo, monto, concepto }),
    });
    document.getElementById('caja-monto').value    = '';
    document.getElementById('caja-concepto').value = '';
    toast(`✅ ${_cajaTipo === 'deposito' ? 'Depósito' : 'Retiro'} registrado`);
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function initCajaReporte() {
  const hoy = new Date().toLocaleDateString('en-CA');
  document.getElementById('caja-fecha').value = hoy;
  await loadCajaReporte();
}

let _cajaReporteData = null; // cache para imprimir sin refetch

async function loadCajaReporte() {
  const fecha = document.getElementById('caja-fecha').value;
  if (!fecha) return;
  try {
    const { movimientos, ventas } = await apiFetch(`/caja?fecha=${fecha}`);

    const depositos     = movimientos.filter(m => m.tipo === 'deposito').reduce((s, m) => s + m.monto, 0);
    const retiros       = movimientos.filter(m => m.tipo === 'retiro').reduce((s, m)  => s + m.monto, 0);
    const totalVentas   = ventas.reduce((s, v) => s + (v.total ?? 0), 0);
    const balance       = depositos - retiros + totalVentas;
    _cajaReporteData    = { fecha, movimientos, ventas, depositos, retiros, totalVentas, balance };

    document.getElementById('cr-depositos').textContent = fmt(depositos);
    document.getElementById('cr-retiros').textContent   = fmt(retiros);
    document.getElementById('cr-ventas').textContent    = fmt(totalVentas);
    document.getElementById('cr-balance').textContent   = fmt(balance);

    const tbody = document.getElementById('caja-reporte-body');
    const empty = document.getElementById('caja-reporte-empty');

    if (!movimientos.length && !ventas.length) {
      tbody.innerHTML     = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    // Mezclar movimientos y ventas ordenados por hora
    const filas = [
      ...movimientos.map(m => ({ _t: new Date(m.creadoEn), tipo: 'mov', data: m })),
      ...ventas.map(v      => ({ _t: new Date(v.fecha),    tipo: 'venta', data: v })),
    ].sort((a, b) => a._t - b._t);

    const hora = d => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    tbody.innerHTML = filas.map(({ tipo, data }) => {
      if (tipo === 'mov') {
        const color = data.tipo === 'deposito' ? 'var(--success)' : 'var(--danger)';
        return `<tr>
          <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${hora(data.creadoEn)}</td>
          <td style="padding:12px 16px;">
            <span class="badge" style="background:${color};">${data.tipo === 'deposito' ? 'Depósito' : 'Retiro'}</span>
          </td>
          <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${data.concepto || '—'}</td>
          <td style="padding:12px 16px;text-align:right;font-weight:700;">${fmt(data.monto)}</td>
        </tr>`;
      } else {
        return `<tr>
          <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${hora(data.fecha)}</td>
          <td style="padding:12px 16px;">
            <span class="badge" style="background:var(--primary-light);color:var(--primary-dark);">Venta</span>
          </td>
          <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${data.folio || '—'}</td>
          <td style="padding:12px 16px;text-align:right;font-weight:700;color:var(--primary-dark);">+${fmt(data.total)}</td>
        </tr>`;
      }
    }).join('');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

function imprimirCajaReporte() {
  if (!_cajaReporteData) { toast('⚠️ Carga el reporte primero'); return; }
  const { fecha, movimientos, ventas, depositos, retiros, totalVentas, balance } = _cajaReporteData;

  const money = n => '$' + Number(n).toFixed(2);
  const hora  = d => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const filas = [
    ...movimientos.map(m => ({ _t: new Date(m.creadoEn), tipo: 'mov', data: m })),
    ...ventas.map(v      => ({ _t: new Date(v.fecha),    tipo: 'venta', data: v })),
  ].sort((a, b) => a._t - b._t).map(({ tipo, data }) => {
    if (tipo === 'mov') {
      const signo = data.tipo === 'deposito' ? '+' : '-';
      const label = data.tipo === 'deposito' ? 'DEP' : 'RET';
      return `<tr>
        <td><div>${label} ${data.concepto || '—'}</div><div class="hora">${hora(data.creadoEn)}</div></td>
        <td class="num">${signo}${money(data.monto)}</td>
      </tr>`;
    } else {
      return `<tr>
        <td><div>VTA ${data.folio || '—'}</div><div class="hora">${hora(data.fecha)}</div></td>
        <td class="num">+${money(data.total)}</td>
      </tr>`;
    }
  }).join('');

  const cfg         = getPrintCfg('caja');
  const margen      = cfg.margen;
  const fuente      = cfg.fuente;
  const fuenteMonto = cfg.fuenteMonto;
  const bodyW       = (58 - margen * 2) + 'mm';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Caja ${fechaFmt}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:58mm auto;margin:2mm ${margen}mm;}
body{font-family:Arial,Helvetica,sans-serif;font-size:${fuente}pt;width:${bodyW};color:#000;}
.c{text-align:center;}
.dash{border:none;border-top:1px dashed #000;margin:3px 0;}
.solid{border:none;border-top:1.5px solid #000;margin:3px 0;}
table{width:100%;border-collapse:collapse;}
th{font-size:7pt;text-transform:uppercase;border-bottom:1px solid #000;padding:3px 2px;text-align:left;}
td{padding:3px 2px;font-size:8pt;vertical-align:top;}
td + td{border-top:none;}
tr + tr td{border-top:1px dotted #ccc;}
.hora{font-size:8pt;margin-top:1px;}
.num{text-align:right;font-size:${fuenteMonto}pt;white-space:nowrap;padding-right:2mm;}
.res{display:flex;justify-content:space-between;margin:1.5px 0;padding-right:2mm;font-size:${fuenteMonto}pt;}
.bold{font-weight:700;}
</style></head><body>
<div class="c bold" style="font-size:10pt;">REPORTE DE CAJA</div>
<div class="c">${fechaFmt}</div>
<hr class="solid">
<table>
  <thead><tr><th>Tipo / Concepto</th><th class="num">Monto</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="4" style="text-align:center;">Sin movimientos</td></tr>'}</tbody>
</table>
<hr class="solid">
<div class="res"><span>Depósitos</span><span>+${money(depositos)}</span></div>
<div class="res"><span>Retiros</span><span>-${money(retiros)}</span></div>
<div class="res"><span>Ventas efectivo</span><span>+${money(totalVentas)}</span></div>
<hr class="dash">
<div class="res bold"><span>BALANCE EN CAJA</span><span>${money(balance)}</span></div>
</body></html>`;

  _printHtml(html, 250);
}