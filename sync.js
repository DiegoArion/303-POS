const { MongoClient } = require('mongodb');

const LOCAL_URI  = 'mongodb://localhost:27017';
const ATLAS_URI  = 'mongodb+srv://Pos_db_user:DiIXdP9KWJzBARDS@lena.grmlcs0.mongodb.net/?appName=Lena';
const DB_NAME    = 'pos';
const COLECCIONES = ['productos', 'ventas', 'pedidos', 'usuarios'];
const INTERVALO  = 5 * 60 * 1000; // 5 minutos

async function sincronizar() {
  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI);

  try {
    await local.connect();
    await atlas.connect();

    const dbLocal = local.db(DB_NAME);
    const dbAtlas = atlas.db(DB_NAME);

    for (const col of COLECCIONES) {
      const docs = await dbLocal.collection(col).find({}).toArray();
      if (docs.length === 0) continue;

      const ops = docs.map(doc => ({
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      }));

      await dbAtlas.collection(col).bulkWrite(ops, { ordered: false });
      console.log(`[${new Date().toLocaleTimeString()}] ✅ ${col}: ${docs.length} docs sincronizados`);
    }

  } catch (err) {
    console.log(`[${new Date().toLocaleTimeString()}] ⚠️  Sin internet o error de sync: ${err.message}`);
  } finally {
    await local.close().catch(() => {});
    await atlas.close().catch(() => {});
  }
}

console.log('🔄 Sync iniciado — sincronizando cada 5 minutos...');
sincronizar();
setInterval(sincronizar, INTERVALO);
