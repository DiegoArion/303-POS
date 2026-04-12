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
  });
});

/* ─── HELPERS ─── */
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  return '$' + Number(n).toFixed(2);
}

function stockColor(s)  { return s === 0 ? 'var(--danger)' : s <= 5 ? 'var(--warning)' : 'var(--success)'; }
function stockLabel(s)  { return s === 0 ? 'Sin stock' : s <= 5 ? 'Poco stock' : s <= 10 ? 'Stock bajo' : 'En stock'; }

function avatar(p) {
  return `<div style="width:36px;height:36px;border-radius:9px;background:var(--primary-light);
    color:var(--primary-dark);display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:15px;flex-shrink:0;">${p.ini}</div>`;
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
        <div style="width:44px;height:44px;border-radius:10px;background:var(--primary-light);
          color:var(--primary-dark);display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:20px;">${p.ini}</div>
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
        <div style="width:30px;height:30px;border-radius:7px;background:var(--primary-light);
          color:var(--primary-dark);display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:13px;flex-shrink:0;">${it.ini}</div>
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
        <div style="width:52px;height:52px;border-radius:12px;background:var(--primary-light);
          color:var(--primary-dark);display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:22px;margin-bottom:10px;">${p.ini}</div>
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
            <div style="width:32px;height:32px;border-radius:8px;background:var(--primary-light);
              color:var(--primary-dark);display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:14px;flex-shrink:0;">${p.ini}</div>
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
        </td>
      </tr>`;
  }).join('');
}

/* ─── MODAL PRODUCTO ─── */
function openModal(id = null) {
  const overlay = document.getElementById('modal-overlay');

  // Poblar selects
  document.getElementById('f-categoria').innerHTML = catOptions();
  document.getElementById('f-proveedor').innerHTML = provOptions();
  document.getElementById('f-unidad').innerHTML    = unidadOptions();

  if (id) {
    // Modo editar
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
  } else {
    // Modo nuevo
    document.getElementById('modal-title').textContent    = 'Agregar producto';
    document.getElementById('modal-sub').textContent      = 'Los campos marcados con * son obligatorios';
    document.getElementById('btn-submit-txt').textContent = 'Agregar';
    document.getElementById('prod-form').reset();
    document.getElementById('f-id').value = '';
  }

  // Limpiar errores
  document.querySelectorAll('.field input').forEach(i => i.classList.remove('error'));
  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-nombre').focus(), 220);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
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
  const venta  = document.getElementById('f-venta').value.trim();
  const id     = document.getElementById('f-id').value;

  // Validar
  let valid = true;
  const nEl = document.getElementById('f-nombre');
  const vEl = document.getElementById('f-venta');
  if (!nombre) { nEl.classList.add('error'); valid = false; } else nEl.classList.remove('error');
  if (!venta)  { vEl.classList.add('error'); valid = false; } else vEl.classList.remove('error');
  if (!valid) return;

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

  const payload = {
    producto:  nombre,
    codigo:    document.getElementById('f-codigo').value.trim(),
    categoria: document.getElementById('f-categoria').value,
    proveedor: document.getElementById('f-proveedor').value,
    unidad:    document.getElementById('f-unidad').value,
    pCosto:    document.getElementById('f-costo').value,
    pVenta:    venta,
    stock:     document.getElementById('f-stock').value || 0,
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
    <td><input class="cell-input" type="text"   placeholder="Nombre del producto" data-field="producto"></td>
    <td><input class="cell-input" type="text"   placeholder="BEB-001"             data-field="codigo"></td>
    <td><select class="cell-select" data-field="categoria">${catOptions(categoria)}</select></td>
    <td><select class="cell-select" data-field="proveedor">${provOptions(proveedor)}</select></td>
    <td><select class="cell-select" data-field="unidad">${unidadOptions(unidad)}</select></td>
    <td><input class="cell-input" type="number" placeholder="0.00" min="0" step="0.01" data-field="pCosto"></td>
    <td><input class="cell-input" type="number" placeholder="0.00" min="0" step="0.01" data-field="pVenta"></td>
    <td><input class="cell-input" type="number" placeholder="0"    min="0" step="1"    data-field="stock" value="0"></td>
    <td><button class="btn-row-del" onclick="bulkDelRow(${id})" title="Eliminar fila"><i class="fas fa-times"></i></button></td>
  `;
  document.getElementById('bulk-body').appendChild(tr);
  updateBulkCount();
  tr.querySelector('[data-field="producto"]').focus();
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
    const venta  = get('pVenta');

    // Fila completamente vacía → ignorar
    if (!nombre && !get('codigo') && !venta && !get('pCosto')) continue;

    if (!nombre) { tr.querySelector('[data-field="producto"]').classList.add('err'); valid = false; }
    if (!venta)  { tr.querySelector('[data-field="pVenta"]').classList.add('err');   valid = false; }

    productos.push({
      producto:  nombre,
      codigo:    get('codigo'),
      categoria: get('categoria'),
      proveedor: get('proveedor'),
      unidad:    get('unidad'),
      pCosto:    get('pCosto') || null,
      pVenta:    venta  || null,
      stock:     get('stock')  || 0,
    });
  }

  if (!valid)           { toast('❌ Completa los campos obligatorios'); return; }
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

async function checkAuth() {
  const token = localStorage.getItem('pos_token');
  if (!token) { showLogin(); return; }
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { 'x-token': token } });
    if (!res.ok) { localStorage.removeItem('pos_token'); showLogin(); return; }
    _currentUser = await res.json();
    applyUser();
    hideLogin();
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

async function initCajaMov() {
  setCajaTipo('deposito');
  await loadCajaHoy();
}

async function loadCajaHoy() {
  const fecha = new Date().toLocaleDateString('en-CA');
  try {
    const data = await apiFetch(`/api/caja?fecha=${fecha}`);
    const movs = data.movimientos || [];
    const balance = movs.reduce((s, m) => m.tipo === 'deposito' ? s + m.monto : s - m.monto, 0);

    document.getElementById('caja-hoy-balance').textContent = fmt(balance);

    const list = document.getElementById('caja-hoy-list');
    if (!movs.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);">Sin movimientos hoy</div>`;
      return;
    }
    list.innerHTML = movs.map(m => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border);">
        <span class="badge" style="background:${m.tipo === 'deposito' ? 'var(--success)' : 'var(--danger)'};">
          ${m.tipo === 'deposito' ? 'Depósito' : 'Retiro'}
        </span>
        <span style="font-weight:700;min-width:80px;">${fmt(m.monto)}</span>
        <span style="color:var(--muted);font-size:13px;flex:1;">${m.concepto || '—'}</span>
        <span style="color:var(--muted);font-size:12px;">${m.hora || ''}</span>
      </div>`).join('');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function guardarMovCaja() {
  const monto    = parseFloat(document.getElementById('caja-monto').value);
  const concepto = document.getElementById('caja-concepto').value.trim();
  if (!monto || monto <= 0) { toast('⚠️ Ingresa un monto válido'); return; }

  try {
    await apiFetch('/api/caja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: _cajaTipo, monto, concepto }),
    });
    document.getElementById('caja-monto').value    = '';
    document.getElementById('caja-concepto').value = '';
    toast(`✅ ${_cajaTipo === 'deposito' ? 'Depósito' : 'Retiro'} registrado`);
    await loadCajaHoy();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function initCajaReporte() {
  const hoy = new Date().toLocaleDateString('en-CA');
  document.getElementById('caja-fecha').value = hoy;
  await loadCajaReporte();
}

async function loadCajaReporte() {
  const fecha = document.getElementById('caja-fecha').value;
  if (!fecha) return;
  try {
    const data = await apiFetch(`/api/caja?fecha=${fecha}`);
    const movs = data.movimientos || [];
    const depositos = movs.filter(m => m.tipo === 'deposito').reduce((s, m) => s + m.monto, 0);
    const retiros   = movs.filter(m => m.tipo === 'retiro').reduce((s, m)  => s + m.monto, 0);
    const balance   = depositos - retiros;

    document.getElementById('cr-depositos').textContent = fmt(depositos);
    document.getElementById('cr-retiros').textContent   = fmt(retiros);
    document.getElementById('cr-balance').textContent   = fmt(balance);

    const tbody = document.getElementById('caja-reporte-body');
    const empty = document.getElementById('caja-reporte-empty');

    if (!movs.length) {
      tbody.innerHTML     = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = movs.map(m => `
      <tr>
        <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${m.hora || ''}</td>
        <td style="padding:12px 16px;">
          <span class="badge" style="background:${m.tipo === 'deposito' ? 'var(--success)' : 'var(--danger)'};">
            ${m.tipo === 'deposito' ? 'Depósito' : 'Retiro'}
          </span>
        </td>
        <td style="padding:12px 16px;color:var(--muted);font-size:13px;">${m.concepto || '—'}</td>
        <td style="padding:12px 16px;text-align:right;font-weight:700;">${fmt(m.monto)}</td>
      </tr>`).join('');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}