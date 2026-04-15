/**
 * migrar.js — Copia datos de una DB local a Atlas (una sola vez).
 * Uso: node migrar.js <db-local>
 * Ejemplo: node migrar.js PROD
 */

const { MongoClient } = require('mongodb');

const DB_LOCAL  = process.argv[2] || 'pos_prod';
const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_ATLAS  = 'pos_prod';

const COLECCIONES = ['productos', 'config', 'ventas', 'pedidos', 'caja', 'usuarios', 'inventariado', 'inv_reportes'];


async function migrar() {
  console.log(`\n📦 Migrando ${DB_LOCAL} (local) → ${DB_ATLAS} (Atlas)\n`);

  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI);

  await local.connect();
  await atlas.connect();
  console.log('✔ Conectado a ambas bases de datos\n');

  const dbLocal = local.db(DB_LOCAL);
  const dbAtlas = atlas.db(DB_ATLAS);

  for (const col of COLECCIONES) {
    const docs = await dbLocal.collection(col).find({}).toArray();
    if (!docs.length) {
      console.log(`  — ${col}: vacía, se omite`);
      continue;
    }

    const ops = docs.map(doc => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));

    await dbAtlas.collection(col).bulkWrite(ops, { ordered: false });
    console.log(`  ✔ ${col}: ${docs.length} documentos migrados`);
  }

  await local.close();
  await atlas.close();
  console.log('\n✅ Migración completada.\n');
}

migrar().catch(err => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
