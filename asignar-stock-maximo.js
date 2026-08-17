/**
 * asignar-stock-maximo.js
 *
 * Asigna a cada producto el campo `stockMaximo` usando la cantidad de unidades
 * que se vendió la SEMANA PASADA completa (lunes→domingo). Productos sin ventas
 * esa semana quedan en 0.
 *
 * Uso:
 *   node asignar-stock-maximo.js          → base pos_prod (producción)
 *   DB_MODE=dev node asignar-stock-maximo.js  → base pos (desarrollo)
 *
 * ⚠️ Es reutilizable: cada vez que lo corras RECALCULA con la semana pasada más
 *    reciente y SOBREESCRIBE el stockMaximo (incluye ediciones manuales).
 */

const { MongoClient } = require('mongodb');

const LOCAL_URI = 'mongodb://localhost:27017';
const DB_NAME   = process.env.DB_MODE === 'dev' ? 'pos' : 'pos_prod';

const round2 = n => parseFloat(Number(n).toFixed(2));
function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

async function main() {
  const client = new MongoClient(LOCAL_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  log(`Base: ${DB_NAME}`);

  // ── Rango de la semana pasada (lunes 00:00 → domingo 23:59:59) ──
  const base = new Date();
  const dow  = (base.getDay() + 6) % 7;              // 0=Lun … 6=Dom
  const inicioSemanaActual = new Date(base);
  inicioSemanaActual.setDate(base.getDate() - dow);
  inicioSemanaActual.setHours(0, 0, 0, 0);

  const inicio = new Date(inicioSemanaActual); inicio.setDate(inicioSemanaActual.getDate() - 7);
  const fin    = new Date(inicioSemanaActual); fin.setMilliseconds(-1);   // domingo pasado 23:59:59.999

  log(`Semana pasada: ${inicio.toLocaleDateString()} → ${fin.toLocaleDateString()}`);

  // ── Unidades vendidas por producto esa semana (clave = código o nombre) ──
  const ventas = await db.collection('ventas')
    .find({ fecha: { $gte: inicio, $lte: fin }, cancelada: { $ne: true } })
    .toArray();

  const vendidas = new Map();
  for (const v of ventas) {
    for (const p of (v.productos || [])) {
      const clave = p.codigo || p.nombre;
      if (!clave) continue;
      vendidas.set(clave, (vendidas.get(clave) || 0) + p.cantidad);
    }
  }
  log(`Ventas en la semana: ${ventas.length} · productos distintos vendidos: ${vendidas.size}`);

  // ── Asignar stockMaximo a cada producto + acumular objetivo por proveedor ──
  const productos = await db.collection('productos')
    .find({}, { projection: { codigo: 1, producto: 1, proveedor: 1, pCosto: 1 } }).toArray();
  const ahora = new Date();

  const objetivoProv = new Map();   // proveedor → objetivo en dinero (a costo)
  let conValor = 0;

  const ops = productos.map(prod => {
    const clave = prod.codigo || prod.producto;
    const stockMaximo = Math.round(vendidas.get(clave) || 0);
    if (stockMaximo > 0) conValor++;

    // Objetivo por proveedor = Σ (stockMaximo × precio de compra)
    const costo = (prod.pCosto != null && prod.pCosto > 0) ? prod.pCosto : 0;
    const prov  = prod.proveedor || '';
    if (prov) objetivoProv.set(prov, (objetivoProv.get(prov) || 0) + stockMaximo * costo);

    return {
      updateOne: {
        filter: { _id: prod._id },
        update: { $set: { stockMaximo, actualizadoEn: ahora } },   // actualizadoEn → el sync lo sube a Atlas
      },
    };
  });

  if (ops.length) await db.collection('productos').bulkWrite(ops, { ordered: false });
  log(`✅ Productos: ${productos.length} actualizados (${conValor} con stockMaximo > 0, el resto en 0)`);

  // ── Guardar objetivo por proveedor en config (se sincroniza por LWW) ──
  const montos = [...objetivoProv.entries()].map(([proveedor, monto]) => ({ proveedor, stockMaximo: round2(monto) }));
  await db.collection('config').updateOne(
    { tipo: 'resurtido_montos' },
    { $set: { tipo: 'resurtido_montos', valores: montos, updatedAt: ahora } },
    { upsert: true }
  );
  log(`✅ Objetivo por proveedor guardado en config → ${montos.length} proveedores`);

  await client.close();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
