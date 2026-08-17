/**
 * subir-stock-maximo.js — Sube SOLO el campo stockMaximo de cada producto
 * desde la base local (pos_prod) a Atlas, emparejando por _id.
 *
 * Bumpea actualizadoEn en Atlas para que otras máquinas (Linux) lo bajen por LWW.
 * No toca ningún otro campo del producto.
 *
 * Uso: node subir-stock-maximo.js
 */

const { MongoClient } = require('mongodb');

const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_NAME   = 'pos_prod';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

async function main() {
  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([local.connect(), atlas.connect()]);
  log('✅ Conectado a Local y Atlas');

  const productos = await local.db(DB_NAME).collection('productos')
    .find({ stockMaximo: { $exists: true } }, { projection: { stockMaximo: 1 } })
    .toArray();
  log(`Productos con stockMaximo en local: ${productos.length}`);

  const ahora = new Date();
  const ops = productos.map(p => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { stockMaximo: p.stockMaximo, actualizadoEn: ahora } },
      // sin upsert: solo actualiza los que ya existen en Atlas
    },
  }));

  if (ops.length) {
    const r = await atlas.db(DB_NAME).collection('productos').bulkWrite(ops, { ordered: false });
    log(`✅ Atlas actualizado — ${r.modifiedCount} productos con stockMaximo (de ${ops.length} enviados)`);
  }

  // Objetivo por proveedor (config resurtido_montos) → Atlas, para que la Linux lo baje por LWW
  const cfgMontos = await local.db(DB_NAME).collection('config').findOne({ tipo: 'resurtido_montos' });
  if (cfgMontos) {
    await atlas.db(DB_NAME).collection('config').replaceOne(
      { _id: cfgMontos._id }, cfgMontos, { upsert: true }
    );
    log(`✅ Atlas: config 'resurtido_montos' subido (${(cfgMontos.valores || []).length} proveedores)`);
  } else {
    log('⚠️  No hay config resurtido_montos en local (¿corriste asignar-stock-maximo.js?)');
  }

  await Promise.all([local.close(), atlas.close()]);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
