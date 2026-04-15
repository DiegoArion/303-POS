/**
 * sync.js — Sincroniza la DB local pos_prod → Atlas pos_prod cada 5 minutos.
 * Solo corre en modo producción (DB_MODE=prod).
 */

const { MongoClient } = require('mongodb');

if (process.env.DB_MODE !== 'prod') {
  console.log('ℹ️  Sync desactivado en modo desarrollo.');
  process.exit(0);
}

const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_NAME   = 'pos_prod';
const INTERVALO = 5 * 60 * 1000; // 5 minutos

const COLECCIONES = ['productos', 'config', 'ventas', 'pedidos', 'caja', 'usuarios', 'inventariado', 'inv_reportes'];

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function sincronizar() {
  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 8000 });

  try {
    await local.connect();
    await atlas.connect();

    const dbLocal = local.db(DB_NAME);
    const dbAtlas = atlas.db(DB_NAME);

    let total = 0;
    for (const col of COLECCIONES) {
      const docs = await dbLocal.collection(col).find({}).toArray();
      if (!docs.length) continue;

      const ops = docs.map(doc => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      }));

      await dbAtlas.collection(col).bulkWrite(ops, { ordered: false });
      total += docs.length;
    }

    log(`✅ Sync completado — ${total} documentos enviados a Atlas`);

  } catch (err) {
    log(`⚠️  Sin conexión a Atlas, se reintentará en 5 min (${err.message})`);
  } finally {
    await local.close().catch(() => {});
    await atlas.close().catch(() => {});
  }
}

log('🔄 Sync iniciado — sincronizando cada 5 minutos...');
sincronizar();
setInterval(sincronizar, INTERVALO);
