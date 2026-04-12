const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const { MongoClient } = require('mongodb');

function hashPwd(pw) {
  return crypto.createHash('sha256').update(pw + 'pos-salt-2024').digest('hex');
}

const sessions = new Map(); // token → { username, tipo, _id }

const MONGO_URI  = 'mongodb+srv://Pos_db_user:DiIXdP9KWJzBARDS@lena.grmlcs0.mongodb.net/?appName=Lena';
const DB_NAME    = 'pos_prod';
const PORT       = 3000;

const app    = express();
const client = new MongoClient(MONGO_URI);

app.use(cors());
app.use(express.json());

// ── Conexión compartida ──────────────────────────────────────────
let db;
async function conectar() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✅ MongoDB conectado — base: ${DB_NAME}`);
  await seedUsuarios();
}

async function seedUsuarios() {
  const existe = await db.collection('usuarios').countDocuments();
  if (existe === 0) {
    await db.collection('usuarios').insertMany([
      { username: 'admin',    password: hashPwd('admin123'), tipo: 'admin',    creadoEn: new Date() },
      { username: 'vendedor', password: hashPwd('venta123'), tipo: 'vendedor', creadoEn: new Date() },
    ]);
    console.log('✅ Usuarios iniciales creados — admin:admin123 / vendedor:venta123');
  }
}

// ── GET /api/productos ───────────────────────────────────────────
// Parámetros opcionales: ?q=texto  &cat=Categoria
app.get('/api/productos', async (req, res) => {
  try {
    const { q, cat } = req.query;
    const filtro = {};

    if (cat && cat !== 'Todos') {
      filtro.categoria = { $regex: new RegExp(`^${cat}$`, 'i') };
    }
    if (q) {
      filtro.$or = [
        { producto:  { $regex: q, $options: 'i' } },
        { codigo:    { $regex: q, $options: 'i' } },
        { categoria: { $regex: q, $options: 'i' } },
      ];
    }

    const docs = await db.collection('productos')
      .find(filtro)
      .sort({ producto: 1 })
      .toArray();

    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/dashboard ──────────────────────────────────────────
app.get('/api/dashboard', async (_req, res) => {
  try {
    const ahora      = new Date();
    const inicioDia  = new Date(ahora); inicioDia.setHours(0,0,0,0);
    const finDia     = new Date(ahora); finDia.setHours(23,59,59,999);
    const inicioMes  = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const finMes     = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);

    const [ventasHoy, ventasMes] = await Promise.all([
      db.collection('ventas').find({ fecha: { $gte: inicioDia, $lte: finDia } }).toArray(),
      db.collection('ventas').find({ fecha: { $gte: inicioMes, $lte: finMes } }).toArray(),
    ]);

    // ── Hoy ──
    const totalHoy = ventasHoy.reduce((s, v) => s + v.total, 0);
    const porHora  = Array(24).fill(0);
    const porHoraGanancia = Array(24).fill(0);
    let gananciaHoy = 0;

    for (const v of ventasHoy) {
      const h = new Date(v.fecha).getHours();
      porHora[h] += v.total;
      for (const p of v.productos) {
        if (p.pCosto != null) {
          const g = (p.pVenta - p.pCosto) * p.cantidad;
          gananciaHoy   += g;
          porHoraGanancia[h] += g;
        }
      }
    }

    // ── Mes ──
    const diasEnMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
    const porDia    = Array.from({ length: diasEnMes }, (_, i) => ({
      dia: i + 1, total: 0, ganancia: 0,
    }));

    for (const v of ventasMes) {
      const idx = new Date(v.fecha).getDate() - 1;
      porDia[idx].total += v.total;
      for (const p of v.productos) {
        if (p.pCosto != null)
          porDia[idx].ganancia += (p.pVenta - p.pCosto) * p.cantidad;
      }
    }

    // Redondear
    porDia.forEach(d => {
      d.total    = parseFloat(d.total.toFixed(2));
      d.ganancia = parseFloat(d.ganancia.toFixed(2));
    });
    porHoraGanancia.forEach((v, i) => { porHoraGanancia[i] = parseFloat(v.toFixed(2)); });

    res.json({
      hoy: {
        total:          parseFloat(totalHoy.toFixed(2)),
        ganancia:       parseFloat(gananciaHoy.toFixed(2)),
        transacciones:  ventasHoy.length,
        porHora:        porHora.map(v => parseFloat(v.toFixed(2))),
        porHoraGanancia,
      },
      mes: porDia,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/categorias ─────────────────────────────────────────
app.get('/api/categorias', async (req, res) => {
  try {
    const cats = await db.collection('productos').distinct('categoria');
    res.json(cats.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/config ──────────────────────────────────────────────
app.get('/api/config', async (_req, res) => {
  try {
    const docs = await db.collection('config').find({}).toArray();
    const cfg  = { categorias: [], proveedores: [], unidades: [] };
    for (const d of docs) if (d.tipo in cfg) cfg[d.tipo] = d.valores ?? [];
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/config/:tipo ────────────────────────────────────────
app.put('/api/config/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    if (!['categorias', 'proveedores', 'unidades'].includes(tipo))
      return res.status(400).json({ error: 'Tipo inválido' });

    const valores = (req.body.valores ?? [])
      .map(v => String(v).trim())
      .filter(Boolean);

    await db.collection('config').updateOne(
      { tipo },
      { $set: { tipo, valores } },
      { upsert: true }
    );
    res.json({ tipo, valores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/productos ──────────────────────────────────────────
app.post('/api/productos', async (req, res) => {
  try {
    const { codigo, producto, pCosto, pVenta, stock, categoria, proveedor, unidad } = req.body;
    if (!producto?.trim()) return res.status(400).json({ error: 'El nombre del producto es requerido' });

    const doc = {
      codigo:    (codigo    ?? '').trim(),
      producto:  producto.trim(),
      pCosto:    pCosto  !== undefined && pCosto  !== '' ? parseFloat(Number(pCosto).toFixed(2))  : null,
      pVenta:    pVenta  !== undefined && pVenta  !== '' ? parseFloat(Number(pVenta).toFixed(2))  : null,
      stock:     stock   !== undefined && stock   !== '' ? parseInt(stock)  : 0,
      categoria: (categoria ?? '').trim(),
      proveedor: (proveedor ?? '').trim(),
      unidad:    (unidad    ?? '').trim(),
      actualizadoEn: new Date(),
    };

    const result = await db.collection('productos').insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/productos/:id ───────────────────────────────────────
app.put('/api/productos/:id', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { codigo, producto, pCosto, pVenta, stock, categoria, proveedor, unidad } = req.body;
    if (!producto?.trim()) return res.status(400).json({ error: 'El nombre del producto es requerido' });

    const update = {
      codigo:    (codigo    ?? '').trim(),
      producto:  producto.trim(),
      pCosto:    pCosto  !== undefined && pCosto  !== '' ? parseFloat(Number(pCosto).toFixed(2))  : null,
      pVenta:    pVenta  !== undefined && pVenta  !== '' ? parseFloat(Number(pVenta).toFixed(2))  : null,
      stock:     stock   !== undefined && stock   !== '' ? parseInt(stock)  : 0,
      categoria: (categoria ?? '').trim(),
      proveedor: (proveedor ?? '').trim(),
      unidad:    (unidad    ?? '').trim(),
      actualizadoEn: new Date(),
    };

    const result = await db.collection('productos').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ _id: req.params.id, ...update });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/productos/bulk ─────────────────────────────────────
app.post('/api/productos/bulk', async (req, res) => {
  try {
    const { productos } = req.body;
    if (!Array.isArray(productos) || !productos.length)
      return res.status(400).json({ error: 'Sin productos' });

    const resultados = { insertados: 0, errores: [] };

    for (const [i, p] of productos.entries()) {
      if (!p.producto?.trim()) {
        resultados.errores.push({ fila: i + 1, error: 'Nombre requerido' });
        continue;
      }
      try {
        await db.collection('productos').insertOne({
          codigo:    (p.codigo    ?? '').trim(),
          producto:  p.producto.trim(),
          pCosto:    p.pCosto !== '' && p.pCosto != null ? parseFloat(Number(p.pCosto).toFixed(2)) : null,
          pVenta:    p.pVenta !== '' && p.pVenta != null ? parseFloat(Number(p.pVenta).toFixed(2)) : null,
          stock:     p.stock  !== '' && p.stock  != null ? parseInt(p.stock) : 0,
          categoria: (p.categoria ?? '').trim(),
          proveedor: (p.proveedor ?? '').trim(),
          unidad:    (p.unidad    ?? '').trim(),
          actualizadoEn: new Date(),
        });
        resultados.insertados++;
      } catch (e) {
        resultados.errores.push({ fila: i + 1, error: e.message });
      }
    }

    res.status(201).json(resultados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ventas ─────────────────────────────────────────────
app.post('/api/ventas', async (req, res) => {
  try {
    const { productos, metodoPago, nota } = req.body;

    if (!productos?.length) return res.status(400).json({ error: 'Sin productos' });
    if (!['efectivo', 'tarjeta'].includes(metodoPago))
      return res.status(400).json({ error: 'Método de pago inválido' });

    // Folio único correlativo
    const ultima = await db.collection('ventas').findOne({}, { sort: { folio_num: -1 } });
    const folioNum = (ultima?.folio_num ?? 0) + 1;
    const folio    = 'VTA-' + String(folioNum).padStart(5, '0');

    const subtotal = parseFloat(productos.reduce((s, p) => s + p.pVenta * p.cantidad, 0).toFixed(2));
    const iva      = 0;
    const total    = subtotal;

    const venta = {
      folio,
      folio_num:   folioNum,
      fecha:       new Date(),
      productos:   productos.map(p => ({
        codigo:    p.codigo   || '',
        nombre:    p.nombre,
        pVenta:    p.pVenta,
        pCosto:    p.pCosto   ?? null,
        cantidad:  p.cantidad,
        unidad:    p.unidad   || '',
        ...(p.esGranel ? { esGranel: true } : {}),
        subtotal:  parseFloat((p.pVenta * p.cantidad).toFixed(2)),
      })),
      numProductos: productos.reduce((s, p) => s + p.cantidad, 0),
      subtotal:     parseFloat(subtotal.toFixed(2)),
      iva,
      total,
      metodoPago,
      ...(nota?.trim() ? { nota: nota.trim() } : {}),
    };

    const result = await db.collection('ventas').insertOne(venta);
    res.status(201).json({ ...venta, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/ventas/:id/nota ───────────────────────────────────
app.patch('/api/ventas/:id/nota', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const nota = (req.body.nota ?? '').trim();
    const result = await db.collection('ventas').updateOne(
      { _id: new ObjectId(req.params.id) },
      nota ? { $set: { nota } } : { $unset: { nota: '' } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json({ ok: true, nota });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ventas ──────────────────────────────────────────────
// ?limit=50  &skip=0  &metodo=efectivo|tarjeta
app.get('/api/ventas', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  ?? 50), 200);
    const skip   = parseInt(req.query.skip ?? 0);
    const filtro = {};
    if (req.query.metodo) filtro.metodoPago = req.query.metodo;

    const [docs, total] = await Promise.all([
      db.collection('ventas').find(filtro).sort({ fecha: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('ventas').countDocuments(filtro),
    ]);

    res.json({ ventas: docs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pedidos ────────────────────────────────────────────
app.post('/api/pedidos', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { proveedor, fecha, hora, nota, productos } = req.body;

    if (!Array.isArray(productos) || !productos.length)
      return res.status(400).json({ error: 'Sin productos' });

    // Folio correlativo
    const ultimo   = await db.collection('pedidos').findOne({}, { sort: { folio_num: -1 } });
    const folioNum = (ultimo?.folio_num ?? 0) + 1;
    const folio    = 'PED-' + String(folioNum).padStart(5, '0');

    const items = productos.map(p => ({
      productoId: p.productoId || '',
      nombre:     p.nombre.trim(),
      cantidad:   parseFloat(p.cantidad),
      unidad:     (p.unidad || '').trim(),
      costo:      parseFloat(Number(p.costo).toFixed(2)),
      subtotal:   parseFloat((p.cantidad * p.costo).toFixed(2)),
    }));

    const total = parseFloat(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2));

    const pedido = {
      folio,
      folio_num: folioNum,
      fecha:     new Date(`${fecha}T${hora || '00:00'}:00`),
      proveedor: (proveedor || '').trim(),
      productos: items,
      total,
      ...(nota ? { nota: nota.trim() } : {}),
      creadoEn: new Date(),
    };

    // Guardar pedido
    const result = await db.collection('pedidos').insertOne(pedido);

    // Actualizar stock de cada producto con id registrado
    for (const item of items) {
      if (!item.productoId) continue;
      try {
        await db.collection('productos').updateOne(
          { _id: new ObjectId(item.productoId) },
          { $inc: { stock: item.cantidad } }
        );
      } catch { /* id inválido, ignorar */ }
    }

    res.status(201).json({ ...pedido, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/pedidos ─────────────────────────────────────────────
app.get('/api/pedidos', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? 100), 500);
    const skip  = parseInt(req.query.skip ?? 0);
    const docs  = await db.collection('pedidos').find({}).sort({ fecha: -1 }).skip(skip).limit(limit).toArray();
    res.json({ pedidos: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
    const user = await db.collection('usuarios').findOne({ username: username.trim() });
    if (!user || user.password !== hashPwd(password))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username: user.username, tipo: user.tipo, _id: String(user._id) });
    res.json({ token, username: user.username, tipo: user.tipo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/auth/logout ────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────────────────────────────
app.get('/api/auth/me', (req, res) => {
  const token = req.headers['x-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'No autorizado' });
  res.json(sessions.get(token));
});

// ── GET /api/usuarios ────────────────────────────────────────────
app.get('/api/usuarios', async (_req, res) => {
  try {
    const docs = await db.collection('usuarios')
      .find({}, { projection: { password: 0 } })
      .sort({ creadoEn: 1 }).toArray();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/usuarios ───────────────────────────────────────────
app.post('/api/usuarios', async (req, res) => {
  try {
    const { username, password, tipo } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error: 'Datos incompletos' });
    if (!['admin', 'vendedor'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    const existe = await db.collection('usuarios').findOne({ username: username.trim() });
    if (existe) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    const doc = { username: username.trim(), password: hashPwd(password), tipo, creadoEn: new Date() };
    const result = await db.collection('usuarios').insertOne(doc);
    res.status(201).json({ _id: result.insertedId, username: doc.username, tipo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/usuarios/:id ──────────────────────────────────────
app.patch('/api/usuarios/:id', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { tipo, password } = req.body;
    const set = {};
    if (tipo && ['admin', 'vendedor'].includes(tipo)) set.tipo = tipo;
    if (password?.trim()) set.password = hashPwd(password);
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Sin cambios' });
    await db.collection('usuarios').updateOne({ _id: new ObjectId(req.params.id) }, { $set: set });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/usuarios/:id ─────────────────────────────────────
app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const user = await db.collection('usuarios').findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.tipo === 'admin') {
      const admins = await db.collection('usuarios').countDocuments({ tipo: 'admin' });
      if (admins <= 1) return res.status(400).json({ error: 'No puedes eliminar el único administrador' });
    }
    await db.collection('usuarios').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Archivos estáticos (después de las rutas API) ────────────────
app.use(express.static(path.join(__dirname)));

// ── Arranque ─────────────────────────────────────────────────────
conectar().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('❌ No se pudo conectar a MongoDB:', err.message);
  process.exit(1);
});
