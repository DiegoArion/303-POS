/**
 * importar-precios.js
 * Lee "extras/inventario 1.xlsx", busca cada producto en la BD local por código/SKU,
 * y si tiene P. Venta distinto de 0 lo actualiza en local y en Atlas.
 *
 * Uso:
 *   node importar-precios.js
 *   node importar-precios.js --solo-local   (sin tocar Atlas)
 *   node importar-precios.js --dry-run      (solo muestra qué cambiaría)
 */

const path       = require('path');
const XLSX       = require('xlsx');
const { MongoClient } = require('mongodb');

const LOCAL_URI  = 'mongodb://localhost:27017';
const ATLAS_URI  = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_NAME    = 'pos_prod';
const EXCEL_PATH = path.join(__dirname, 'inventario 1.xlsx');

const soloLocal = process.argv.includes('--solo-local');
const dryRun    = process.argv.includes('--dry-run');

function parsePrecio(val) {
  if (val == null) return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : parseFloat(n.toFixed(2));
}

async function main() {
  // Leer Excel
  const wb   = XLSX.readFile(EXCEL_PATH);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  // Filtrar filas con código válido y P. Venta > 0
  const entradas = rows
    .map(r => ({
      codigo: String(r['Código'] ?? '').trim(),
      pVenta: parsePrecio(r['P. Venta']),
    }))
    .filter(e => e.codigo && e.pVenta && e.pVenta > 0);

  console.log(`📋 ${rows.length} filas en Excel → ${entradas.length} con P. Venta > 0`);
  if (dryRun) console.log('⚠️  Modo DRY-RUN — no se escribirá nada\n');

  // Conectar MongoDB local
  const local = new MongoClient(LOCAL_URI);
  await local.connect();
  const db = local.db(DB_NAME);

  // Conectar Atlas (opcional)
  let dbAtlas = null;
  if (!soloLocal && !dryRun) {
    try {
      const atlas = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 8000 });
      await atlas.connect();
      dbAtlas = atlas.db(DB_NAME);
      console.log('✅ Atlas conectado\n');
    } catch {
      console.log('⚠️  Sin conexión a Atlas — solo se actualizará local\n');
    }
  }

  let actualizados = 0, noEncontrados = 0, sinCambio = 0;

  for (const { codigo, pVenta } of entradas) {
    const prod = await db.collection('productos').findOne({ codigo });

    if (!prod) {
      console.log(`  ✗ No encontrado: ${codigo}`);
      noEncontrados++;
      continue;
    }

    // Solo actualizar si el precio actual es null o 0
    const precioActual = prod.pVenta;
    if (precioActual && precioActual > 0) {
      sinCambio++;
      continue;
    }

    const update = {
      pVenta,
      actualizadoEn: new Date(),
    };

    console.log(`  ✓ ${prod.producto} (${codigo}) → pVenta: $${pVenta}`);

    if (!dryRun) {
      await db.collection('productos').updateOne({ codigo }, { $set: update });
      if (dbAtlas) {
        try {
          await dbAtlas.collection('productos').updateOne({ codigo }, { $set: update });
        } catch {
          console.log(`    ⚠️  Falló actualización en Atlas para ${codigo}`);
        }
      }
    }
    actualizados++;
  }

  console.log(`\n📊 Resultado:`);
  console.log(`   Actualizados : ${actualizados}`);
  console.log(`   Ya tenían precio: ${sinCambio}`);
  console.log(`   No encontrados: ${noEncontrados}`);
  if (dryRun) console.log('   (nada fue escrito — dry-run)');

  await local.close();
  process.exit(0);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
