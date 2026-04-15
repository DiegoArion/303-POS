/**
 * renombrar-db.js — Copia una DB local a otra y borra la original.
 * Uso: node renombrar-db.js <origen> <destino>
 * Ejemplo: node renombrar-db.js pos pos_prod
 */

const { MongoClient } = require('mongodb');

const [origen, destino] = process.argv.slice(2);

if (!origen || !destino) {
  console.error('❌ Uso: node renombrar-db.js <origen> <destino>');
  process.exit(1);
}

async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();

  const dbOrigen  = client.db(origen);
  const dbDestino = client.db(destino);

  const colecciones = await dbOrigen.listCollections().toArray();

  if (!colecciones.length) {
    console.error(`❌ La base de datos "${origen}" no existe o está vacía.`);
    await client.close();
    process.exit(1);
  }

  console.log(`\n📦 Copiando "${origen}" → "${destino}"\n`);

  for (const { name } of colecciones) {
    const docs = await dbOrigen.collection(name).find({}).toArray();
    if (!docs.length) { console.log(`  — ${name}: vacía, se omite`); continue; }

    await dbDestino.collection(name).deleteMany({});
    await dbDestino.collection(name).insertMany(docs);
    console.log(`  ✔ ${name}: ${docs.length} documentos copiados`);
  }

  console.log(`\n🗑  Eliminando "${origen}"...`);
  await dbOrigen.dropDatabase();
  console.log(`✅ Listo — "${origen}" renombrada a "${destino}"\n`);

  await client.close();
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
