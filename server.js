const express            = require('express');
const cors               = require('cors');
const path               = require('path');
const crypto             = require('crypto');
const https              = require('https');
const fs                 = require('fs');
const { execSync }       = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');

const IMAGENES_DIR = path.join(__dirname, 'imagenes');
if (!fs.existsSync(IMAGENES_DIR)) fs.mkdirSync(IMAGENES_DIR);

// ── Config ───────────────────────────────────────────────────────
const IS_PROD   = process.env.DB_MODE === 'prod';
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME   = IS_PROD ? 'pos_prod' : 'pos';
const PORT      = 3000;

// ── Helpers ──────────────────────────────────────────────────────
const hashPwd = pw => crypto.createHash('sha256').update(pw + 'pos-salt-2024').digest('hex');
const round2  = n  => parseFloat(Number(n).toFixed(2));
const localDate = () => new Date().toLocaleDateString('en-CA');

// Envuelve handlers async — centraliza el try/catch
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// Construye el documento de producto normalizado
function buildProductDoc({ codigo, producto, pCosto, pVenta, stock, categoria, proveedor, unidad }) {
  const parseNum = (v, fn) => v !== undefined && v !== '' && v != null ? fn(Number(v)) : null;
  return {
    codigo:        (codigo    ?? '').trim(),
    producto:      producto.trim(),
    pCosto:        parseNum(pCosto,  n => round2(n)),
    pVenta:        parseNum(pVenta,  n => round2(n)),
    stock:         parseNum(stock,   n => parseInt(n)) ?? 0,
    categoria:     (categoria ?? '').trim(),
    proveedor:     (proveedor ?? '').trim(),
    unidad:        (unidad    ?? '').trim(),
    actualizadoEn: new Date(),
  };
}

// Calcula ganancia de una venta
const calcGanancia = venta =>
  venta.productos.reduce((s, p) =>
    p.pCosto != null ? s + (p.pVenta - p.pCosto) * p.cantidad : s, 0);

// ── Auth ─────────────────────────────────────────────────────────
const sessions = new Map(); // token → { username, tipo, _id }

// ── Conexión ─────────────────────────────────────────────────────
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';

let db;
let dbAtlas = null; // cliente Atlas opcional — solo para propagar eliminaciones en prod
const client = new MongoClient(MONGO_URI);

async function conectar() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✅ MongoDB conectado — base: ${DB_NAME} (${IS_PROD ? 'PRODUCCIÓN · Atlas' : 'desarrollo · local'})`);

  if (IS_PROD) {
    try {
      const atlasClient = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 8000 });
      await atlasClient.connect();
      dbAtlas = atlasClient.db('pos_prod');
      console.log('✅ Atlas conectado — eliminaciones se propagarán a la nube');
    } catch {
      console.log('⚠️  Sin conexión a Atlas — eliminaciones solo locales hasta que haya internet');
    }
  }

  const existe = await db.collection('usuarios').countDocuments();
  if (existe === 0) {
    await db.collection('usuarios').insertMany([
      { username: 'admin',    password: hashPwd('admin123'), tipo: 'admin',    creadoEn: new Date() },
      { username: 'vendedor', password: hashPwd('venta123'), tipo: 'vendedor', creadoEn: new Date() },
    ]);
    console.log('✅ Usuarios iniciales creados — admin:admin123 / vendedor:venta123');
  }
}

// ── App ───────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // base64 de uploads manuales (solo tránsito, no se guarda en DB)

// ── Productos ────────────────────────────────────────────────────
app.get('/api/productos', wrap(async (req, res) => {
  const { q, cat, codigo } = req.query;
  const filtro = {};
  if (cat && cat !== 'Todos') filtro.categoria = { $regex: new RegExp(`^${cat}$`, 'i') };
  if (codigo) filtro.codigo = codigo;                          // búsqueda exacta por código
  else if (q) filtro.$or = [
    { producto:  { $regex: q, $options: 'i' } },
    { codigo:    { $regex: q, $options: 'i' } },
    { categoria: { $regex: q, $options: 'i' } },
  ];
  res.json(await db.collection('productos').find(filtro).sort({ producto: 1 }).toArray());
}));

app.post('/api/productos', wrap(async (req, res) => {
  if (!req.body.producto?.trim()) return res.status(400).json({ error: 'El nombre del producto es requerido' });
  const doc = buildProductDoc(req.body);
  const result = await db.collection('productos').insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
}));

app.get('/api/productos/generar-codigo', wrap(async (_req, res) => {
  const ultimo = await db.collection('productos')
    .find({ codigo: { $regex: '^2\\d{12}$' } })
    .sort({ codigo: -1 })
    .limit(1)
    .toArray();

  let base12;
  if (ultimo.length) {
    base12 = String(parseInt(ultimo[0].codigo.slice(0, 12)) + 1).padStart(12, '0');
  } else {
    base12 = '200000000001';
  }

  // Dígito verificador EAN-13
  const digits = base12.split('').map(Number);
  const suma   = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  const check  = (10 - (suma % 10)) % 10;

  res.json({ codigo: base12 + check });
}));

app.put('/api/productos/:id', wrap(async (req, res) => {
  if (!req.body.producto?.trim()) return res.status(400).json({ error: 'El nombre del producto es requerido' });
  const update = buildProductDoc(req.body);
  const result = await db.collection('productos').updateOne(
    { _id: ObjectId.createFromHexString(req.params.id) }, { $set: update }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ _id: req.params.id, ...update });
}));

app.delete('/api/productos/:id', wrap(async (req, res) => {
  const oid = ObjectId.createFromHexString(req.params.id);

  const result = await db.collection('productos').deleteOne({ _id: oid });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });

  // Propagar eliminación a Atlas, o guardar como pendiente
  if (dbAtlas) {
    try {
      await dbAtlas.collection('productos').deleteOne({ _id: oid });
    } catch {
      await db.collection('_eliminaciones').insertOne({ coleccion: 'productos', docId: oid, deletedAt: new Date() });
    }
  } else if (IS_PROD) {
    await db.collection('_eliminaciones').insertOne({ coleccion: 'productos', docId: oid, deletedAt: new Date() });
  }

  res.json({ ok: true });
}));

app.post('/api/productos/bulk', wrap(async (req, res) => {
  const { productos } = req.body;
  if (!Array.isArray(productos) || !productos.length) return res.status(400).json({ error: 'Sin productos' });

  const resultados = { insertados: 0, errores: [] };
  for (const [i, p] of productos.entries()) {
    if (!p.producto?.trim()) { resultados.errores.push({ fila: i + 1, error: 'Nombre requerido' }); continue; }
    try {
      await db.collection('productos').insertOne(buildProductDoc(p));
      resultados.insertados++;
    } catch (e) {
      resultados.errores.push({ fila: i + 1, error: e.message });
    }
  }
  res.status(201).json(resultados);
}));

// ── Categorías ───────────────────────────────────────────────────
app.get('/api/categorias', wrap(async (_req, res) => {
  const cats = await db.collection('productos').distinct('categoria');
  res.json(cats.filter(Boolean).sort());
}));

// ── Config ───────────────────────────────────────────────────────
app.get('/api/config', wrap(async (_req, res) => {
  const docs = await db.collection('config').find({}).toArray();
  const cfg  = { categorias: [], proveedores: [], unidades: [] };
  for (const d of docs) if (d.tipo in cfg) cfg[d.tipo] = d.valores ?? [];
  res.json(cfg);
}));

app.put('/api/config/:tipo', wrap(async (req, res) => {
  const { tipo } = req.params;
  if (!['categorias', 'proveedores', 'unidades'].includes(tipo))
    return res.status(400).json({ error: 'Tipo inválido' });
  const valores = (req.body.valores ?? []).map(v => String(v).trim()).filter(Boolean);
  await db.collection('config').updateOne({ tipo }, { $set: { tipo, valores, updatedAt: new Date() } }, { upsert: true });
  res.json({ tipo, valores });
}));

// ── Ventas ───────────────────────────────────────────────────────
app.post('/api/ventas', wrap(async (req, res) => {
  const { productos, metodoPago, nota } = req.body;
  if (!productos?.length) return res.status(400).json({ error: 'Sin productos' });
  if (!['efectivo', 'tarjeta'].includes(metodoPago)) return res.status(400).json({ error: 'Método de pago inválido' });

  const ultima   = await db.collection('ventas').findOne({}, { sort: { folio_num: -1 } });
  const folioNum = (ultima?.folio_num ?? 0) + 1;
  const total    = round2(productos.reduce((s, p) => s + p.pVenta * p.cantidad, 0));

  const venta = {
    folio:        'VTA-' + String(folioNum).padStart(5, '0'),
    folio_num:    folioNum,
    fecha:        new Date(),
    productos:    productos.map(p => ({
      codigo:   p.codigo   || '',
      nombre:   p.nombre,
      pVenta:   p.pVenta,
      pCosto:   p.pCosto ?? null,
      cantidad: p.cantidad,
      unidad:   p.unidad  || '',
      ...(p.esGranel ? { esGranel: true } : {}),
      subtotal: round2(p.pVenta * p.cantidad),
    })),
    numProductos: productos.reduce((s, p) => s + p.cantidad, 0),
    subtotal:     total,
    iva:          0,
    total,
    metodoPago,
    ...(nota?.trim() ? { nota: nota.trim() } : {}),
  };

  const result = await db.collection('ventas').insertOne(venta);

  // Descontar stock de cada producto vendido
  const stockOps = productos
    .filter(p => p.productoId)
    .map(p => ({
      updateOne: {
        filter: { _id: ObjectId.createFromHexString(p.productoId) },
        update: { $inc: { stock: -p.cantidad } },
      },
    }));
  if (stockOps.length) await db.collection('productos').bulkWrite(stockOps);

  res.status(201).json({ ...venta, _id: result.insertedId });
}));

app.patch('/api/ventas/:id/nota', wrap(async (req, res) => {
  const nota   = (req.body.nota ?? '').trim();
  const result = await db.collection('ventas').updateOne(
    { _id: ObjectId.createFromHexString(req.params.id) },
    nota ? { $set: { nota } } : { $unset: { nota: '' } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Venta no encontrada' });
  res.json({ ok: true, nota });
}));

app.get('/api/ventas', wrap(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit ?? 50), 200);
  const skip   = parseInt(req.query.skip ?? 0);
  const filtro = req.query.metodo ? { metodoPago: req.query.metodo } : {};
  const [docs, total] = await Promise.all([
    db.collection('ventas').find(filtro).sort({ fecha: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('ventas').countDocuments(filtro),
  ]);
  res.json({ ventas: docs, total });
}));

// ── Pedidos ──────────────────────────────────────────────────────
app.post('/api/pedidos', wrap(async (req, res) => {
  const { proveedor, fecha, hora, nota, productos } = req.body;
  if (!Array.isArray(productos) || !productos.length) return res.status(400).json({ error: 'Sin productos' });

  const ultimo   = await db.collection('pedidos').findOne({}, { sort: { folio_num: -1 } });
  const folioNum = (ultimo?.folio_num ?? 0) + 1;

  const items = productos.map(p => ({
    productoId: p.productoId || '',
    nombre:     p.nombre.trim(),
    cantidad:   parseFloat(p.cantidad),
    unidad:     (p.unidad || '').trim(),
    costo:      round2(p.costo),
    subtotal:   round2(p.cantidad * p.costo),
  }));

  const pedido = {
    folio:     'PED-' + String(folioNum).padStart(5, '0'),
    folio_num: folioNum,
    fecha:     new Date(`${fecha}T${hora || '00:00'}:00`),
    proveedor: (proveedor || '').trim(),
    productos: items,
    total:     round2(items.reduce((s, i) => s + i.subtotal, 0)),
    ...(nota ? { nota: nota.trim() } : {}),
    creadoEn:  new Date(),
  };

  const result = await db.collection('pedidos').insertOne(pedido);

  for (const item of items) {
    if (!item.productoId) continue;
    try {
      await db.collection('productos').updateOne(
        { _id: ObjectId.createFromHexString(item.productoId) }, { $inc: { stock: item.cantidad } }
      );
    } catch { /* id inválido, ignorar */ }
  }

  res.status(201).json({ ...pedido, _id: result.insertedId });
}));

app.get('/api/pedidos', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? 100), 500);
  const skip  = parseInt(req.query.skip ?? 0);
  const docs  = await db.collection('pedidos').find({}).sort({ fecha: -1 }).skip(skip).limit(limit).toArray();
  res.json({ pedidos: docs });
}));

// ── Auth ─────────────────────────────────────────────────────────
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
  const user = await db.collection('usuarios').findOne({ username: username.trim() });
  if (!user || user.password !== hashPwd(password))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: user.username, tipo: user.tipo, _id: String(user._id) });
  res.json({ token, username: user.username, tipo: user.tipo });
}));

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.headers['x-token']);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers['x-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'No autorizado' });
  res.json(sessions.get(token));
});

// ── Usuarios ─────────────────────────────────────────────────────
app.get('/api/usuarios', wrap(async (_req, res) => {
  const docs = await db.collection('usuarios')
    .find({}, { projection: { password: 0 } }).sort({ creadoEn: 1 }).toArray();
  res.json(docs);
}));

app.post('/api/usuarios', wrap(async (req, res) => {
  const { username, password, tipo } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Datos incompletos' });
  if (!['admin', 'vendedor'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (await db.collection('usuarios').findOne({ username: username.trim() }))
    return res.status(400).json({ error: 'El nombre de usuario ya existe' });
  const doc = { username: username.trim(), password: hashPwd(password), tipo, creadoEn: new Date() };
  const result = await db.collection('usuarios').insertOne(doc);
  res.status(201).json({ _id: result.insertedId, username: doc.username, tipo });
}));

app.patch('/api/usuarios/:id', wrap(async (req, res) => {
  const { tipo, password } = req.body;
  const set = {};
  if (tipo && ['admin', 'vendedor'].includes(tipo)) set.tipo = tipo;
  if (password?.trim()) set.password = hashPwd(password);
  if (!Object.keys(set).length) return res.status(400).json({ error: 'Sin cambios' });
  set.actualizadoEn = new Date();
  await db.collection('usuarios').updateOne({ _id: ObjectId.createFromHexString(req.params.id) }, { $set: set });
  res.json({ ok: true });
}));

app.delete('/api/usuarios/:id', wrap(async (req, res) => {
  const user = await db.collection('usuarios').findOne({ _id: ObjectId.createFromHexString(req.params.id) });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.tipo === 'admin') {
    const admins = await db.collection('usuarios').countDocuments({ tipo: 'admin' });
    if (admins <= 1) return res.status(400).json({ error: 'No puedes eliminar el único administrador' });
  }
  await db.collection('usuarios').deleteOne({ _id: ObjectId.createFromHexString(req.params.id) });
  res.json({ ok: true });
}));

// ── Caja ─────────────────────────────────────────────────────────
app.post('/api/caja', wrap(async (req, res) => {
  const { tipo, monto, concepto } = req.body;
  if (!['deposito', 'retiro'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const ahora = new Date();
  const doc   = { tipo, monto: Number(monto), concepto: concepto?.trim() || '', fecha: localDate(), creadoEn: ahora };
  const result = await db.collection('caja').insertOne(doc);
  res.json({ _id: String(result.insertedId), ...doc });
}));

app.get('/api/caja', wrap(async (req, res) => {
  const fecha = req.query.fecha || localDate();
  const movs  = await db.collection('caja').find({ fecha }).sort({ creadoEn: 1 }).toArray();
  res.json(movs);
}));

// ── Dashboard ────────────────────────────────────────────────────
app.get('/api/dashboard', wrap(async (_req, res) => {
  const ahora     = new Date();
  const inicioDia = new Date(ahora); inicioDia.setHours(0,0,0,0);
  const finDia    = new Date(ahora); finDia.setHours(23,59,59,999);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const finMes    = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);

  const [ventasHoy, ventasMes] = await Promise.all([
    db.collection('ventas').find({ fecha: { $gte: inicioDia, $lte: finDia   } }).toArray(),
    db.collection('ventas').find({ fecha: { $gte: inicioMes, $lte: finMes   } }).toArray(),
  ]);

  const porHora          = Array(24).fill(0);
  const porHoraGanancia  = Array(24).fill(0);
  let   gananciaHoy      = 0;

  for (const v of ventasHoy) {
    const h = new Date(v.fecha).getHours();
    porHora[h] += v.total;
    const g     = calcGanancia(v);
    gananciaHoy        += g;
    porHoraGanancia[h] += g;
  }

  const diasEnMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
  const porDia    = Array.from({ length: diasEnMes }, (_, i) => ({ dia: i + 1, total: 0, ganancia: 0 }));

  for (const v of ventasMes) {
    const idx = new Date(v.fecha).getDate() - 1;
    porDia[idx].total    += v.total;
    porDia[idx].ganancia += calcGanancia(v);
  }

  porDia.forEach(d => { d.total = round2(d.total); d.ganancia = round2(d.ganancia); });

  res.json({
    hoy: {
      total:          round2(ventasHoy.reduce((s, v) => s + v.total, 0)),
      ganancia:       round2(gananciaHoy),
      transacciones:  ventasHoy.length,
      porHora:        porHora.map(round2),
      porHoraGanancia: porHoraGanancia.map(round2),
    },
    mes: porDia,
  });
}));

// ── Inventariado ─────────────────────────────────────────────────
app.post('/api/inventariado', wrap(async (req, res) => {
  const { productoId, nombre, cantidad, stockAnterior, proveedor, pVenta } = req.body;
  if (!nombre || cantidad == null) return res.status(400).json({ error: 'Datos incompletos' });
  const ahora = new Date();
  const doc = {
    productoId:    productoId || null,
    nombre,
    cantidad:      parseInt(cantidad),
    stockAnterior: stockAnterior ?? null,
    proveedor:     proveedor || '',
    pVenta:        pVenta ?? null,
    variacion:     stockAnterior != null ? parseInt(cantidad) - stockAnterior : null,
    fecha:         localDate(),
    hora:          ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    creadoEn:      ahora,
  };
  await db.collection('inventariado').insertOne(doc);
  if (productoId) {
    await db.collection('productos').updateOne(
      { _id: ObjectId.createFromHexString(productoId) },
      { $set: { stock: parseInt(cantidad) } }
    );
  }
  res.json(doc);
}));

app.get('/api/inventariado', wrap(async (_req, res) => {
  const logs = await db.collection('inventariado').find({}).sort({ creadoEn: -1 }).toArray();
  res.json(logs);
}));

app.delete('/api/inventariado', wrap(async (_req, res) => {
  await db.collection('inventariado').deleteMany({});
  res.json({ ok: true });
}));

// ── Reportes de inventario ────────────────────────────────────────
app.post('/api/inv-reportes', wrap(async (req, res) => {
  const { tipo } = req.body;
  const ahora    = new Date();

  // Leer los registros del inventariado activo
  const logs = await db.collection('inventariado').find({}).sort({ creadoEn: 1 }).toArray();
  if (!logs.length) return res.status(400).json({ error: 'Sin productos' });

  // Para inventario completo: calcular los productos no revisados
  let pendientes = [];
  if (tipo === 'completo') {
    const scannedIds = logs.map(p => p.productoId).filter(Boolean);
    const excluir    = scannedIds.map(id => ObjectId.createFromHexString(String(id)));
    pendientes = await db.collection('productos')
      .find(excluir.length ? { _id: { $nin: excluir } } : {})
      .sort({ producto: 1 })
      .toArray();
  }

  const valorTotal = logs.reduce((s, r) =>
    r.variacion != null && r.pVenta != null ? s + r.variacion * r.pVenta : s, 0);

  const doc = {
    tipo:       tipo || 'parcial',
    fecha:      localDate(),
    hora:       ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    creadoEn:   ahora,
    productos:  logs,
    pendientes,
    stats: {
      inventariados:  logs.length,
      sinInventariar: pendientes.length,
      conVariacion:   logs.filter(p => p.variacion !== 0 && p.variacion != null).length,
      faltantes:      logs.filter(p => p.variacion != null && p.variacion < 0).length,
      valorTotal,
    },
  };

  await db.collection('inv_reportes').insertOne(doc);
  await db.collection('inventariado').deleteMany({});
  res.json(doc);
}));

app.get('/api/inv-reportes', wrap(async (req, res) => {
  const { mes } = req.query; // formato "2026-04"
  const filtro  = mes ? { fecha: { $regex: `^${mes}` } } : {};
  const lista   = await db.collection('inv_reportes').find(filtro, {
    projection: { productos: 0, pendientes: 0 },
  }).sort({ creadoEn: -1 }).toArray();
  res.json(lista);
}));

app.get('/api/inv-reportes/:id', wrap(async (req, res) => {
  const doc = await db.collection('inv_reportes').findOne({
    _id: ObjectId.createFromHexString(req.params.id),
  });
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json(doc);
}));

// ── Búsqueda externa por código de barras ────────────────────────
function fetchHtml(url, redireccion = 0) {
  return new Promise((resolve, reject) => {
    if (redireccion > 4) return reject(new Error('Demasiadas redirecciones'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location, redireccion + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}


app.get('/api/buscar-codigo/:codigo', wrap(async (req, res) => {
  const { codigo } = req.params;
  try {
    const html = await fetchHtml(`https://go-upc.com/search?q=${encodeURIComponent(codigo)}`);

    // Nombre: primer <h1>
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const nombre  = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : null;

    if (!nombre || /not found|sin resultado|no result/i.test(nombre)) {
      return res.json({ encontrado: false });
    }

    // Imagen: primer img apuntando a S3 de go-upc → guardar en disco
    const imgMatch = html.match(/<img[^>]+src=["'](https:\/\/go-upc\.s3[^"']+)["']/i);
    const imgUrl   = imgMatch ? imgMatch[1] : null;
    let tieneImagen = false;
    if (imgUrl) {
      try {
        const buf = await fetchBuffer(imgUrl);
        const ext = /\.png(\?|$)/i.test(imgUrl) ? 'png' : 'jpg';
        fs.writeFileSync(path.join(IMAGENES_DIR, `${codigo}.${ext}`), buf);
        tieneImagen = true;
      } catch { /* sin imagen */ }
    }

    res.json({ encontrado: true, nombre, tieneImagen });
  } catch {
    res.json({ encontrado: false });
  }
}));

// ── Upload de imagen manual ───────────────────────────────────────
app.post('/api/imagenes', wrap(async (req, res) => {
  const { codigo, base64 } = req.body;
  if (!codigo || !base64) return res.status(400).json({ error: 'Faltan datos' });
  const match = base64.match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Formato inválido' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  const filename = `${codigo}.${ext}`;
  fs.writeFileSync(path.join(IMAGENES_DIR, filename), buf);
  res.json({ ok: true, url: `/imagenes/${filename}` });
}));

// ── Versión ──────────────────────────────────────────────────────
function gitCmd(cmd) {
  return execSync(cmd, { cwd: __dirname, timeout: 8000 }).toString().trim();
}

app.get('/api/version', wrap(async (_req, res) => {
  try {
    const current = gitCmd('git describe --tags --abbrev=0');
    const tags    = gitCmd('git tag --sort=-version:refname').split('\n').filter(Boolean);
    res.json({ current, tags });
  } catch {
    res.json({ current: null, tags: [] });
  }
}));

app.post('/api/version/rollback', wrap(async (req, res) => {
  const session = sessions.get(req.headers['x-token']);
  if (!session || session.tipo !== 'admin') return res.status(403).json({ error: 'Solo administradores' });

  const { version } = req.body;
  if (!version) return res.status(400).json({ error: 'Versión requerida' });

  try {
    gitCmd(`git checkout ${version}`);
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 400);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// ── Estáticos y arranque ─────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.css')) res.set('Content-Type', 'text/css; charset=utf-8');
    if (filePath.endsWith('.js'))  res.set('Content-Type', 'application/javascript; charset=utf-8');
    if (filePath.endsWith('.html')) res.set('Content-Type', 'text/html; charset=utf-8');
  }
}));

conectar().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🗄️  Base de datos: ${IS_PROD ? '🔴 PRODUCCIÓN (Atlas · pos_prod)' : '🟡 TEST (local · pos)'}`);
  });
}).catch(err => {
  console.error('❌ No se pudo conectar a MongoDB:', err.message);
  process.exit(1);
});
