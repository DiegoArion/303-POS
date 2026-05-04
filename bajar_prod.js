/**
 * bajar_prod.js — Solo descarga datos de Atlas a local pos_prod.
 * NO escribe nada en Atlas. Solo lectura de la nube → escritura en local.
 *
 * Uso: node bajar_prod.js
 */

const { MongoClient } = require('mongodb');

const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_NAME   = 'pos_prod';

const COLECCIONES = [
  'productos',
  'config',
  'usuarios',
  'ventas',
  'pedidos',
  'caja',
  'inv_reportes',
  'ofertas',
];

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

async function bajar() {
  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    log('Conectando…');
    await Promise.all([local.connect(), atlas.connect()]);
    const localDb = local.db(DB_NAME);
    const atlasDb = atlas.db(DB_NAME);
    log('✅ Conectado a Local y Atlas');

    let total = 0;

    for (const nombre of COLECCIONES) {
      const atlasDocs = await atlasDb.collection(nombre).find({}).toArray();
      if (!atlasDocs.length) { log(`   ${nombre}: vacío en Atlas`); continue; }

      const ops = atlasDocs.map(doc => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      }));
      await localDb.collection(nombre).bulkWrite(ops, { ordered: false });
      log(`   ${nombre}: ${atlasDocs.length} docs bajados`);
      total += atlasDocs.length;
    }

    log(`✅ Listo — ${total} documentos en total`);

  } catch (err) {
    log(`❌ Error: ${err.message}`);
    process.exit(1);
  } finally {
    await local.close().catch(() => {});
    await atlas.close().catch(() => {});
  }
}

bajar();
