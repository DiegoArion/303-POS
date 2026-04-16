/**
 * sync.js — Sincronización bidireccional local pos_prod ↔ Atlas pos_prod
 *
 * Estrategia:
 *   productos / config / usuarios → Last-Write-Wins (gana el más reciente)
 *   ventas / pedidos / caja / inv_reportes → Push-only (se crean en el POS, nunca se editan)
 *
 * Orden en cada ciclo:
 *   1. Push LWW  — subir cambios locales más recientes
 *   2. Pull LWW  — bajar cambios de Atlas más recientes
 *   3. Push append-only — subir documentos nuevos desde el último sync
 *   4. Eliminar — propagar eliminaciones pendientes a Atlas
 *   5. Guardar lastSync
 */

const { MongoClient } = require('mongodb');

if (process.env.DB_MODE !== 'prod') {
  console.log('ℹ️  Sync desactivado en modo desarrollo.');
  process.exit(0);
}

const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = 'mongodb://Pos_db_user:DiIXdP9KWJzBARDS@ac-eecvjbh-shard-00-00.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-01.grmlcs0.mongodb.net:27017,ac-eecvjbh-shard-00-02.grmlcs0.mongodb.net:27017/?ssl=true&replicaSet=atlas-hf2nd7-shard-0&authSource=admin&appName=Lena';
const DB_NAME   = 'pos_prod';
const INTERVALO = 5 * 60 * 1000;

// Bidireccional — gana el documento con timestamp más reciente
const COL_LWW = [
  { nombre: 'productos', ts: 'actualizadoEn' },
  { nombre: 'config',    ts: 'updatedAt'     },
  { nombre: 'usuarios',  ts: 'actualizadoEn' },
];

// Solo push — se crean en el POS, nunca se editan remotamente
const COL_APPEND = [
  { nombre: 'ventas',       ts: 'fecha'     },
  { nombre: 'pedidos',      ts: 'creadoEn'  },
  { nombre: 'caja',         ts: 'creadoEn'  },
  { nombre: 'inv_reportes', ts: 'creadoEn'  },
];

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function tsOf(doc, campo) {
  const v = doc[campo] ?? doc.creadoEn ?? doc.fecha ?? null;
  return v ? new Date(v).getTime() : 0;
}

async function sincronizar(localDb, atlasDb) {
  const stats = { pushed: 0, pulled: 0, eliminados: 0 };

  // ── 1 & 2. LWW — bidireccional ───────────────────────────────────
  for (const { nombre, ts } of COL_LWW) {
    const [localDocs, atlasDocs] = await Promise.all([
      localDb.collection(nombre).find({}).toArray(),
      atlasDb.collection(nombre).find({}).toArray(),
    ]);

    const atlasMap = new Map(atlasDocs.map(d => [d._id.toString(), d]));
    const localMap = new Map(localDocs.map(d => [d._id.toString(), d]));

    // Push: docs locales más nuevos que en Atlas
    const pushOps = [];
    for (const doc of localDocs) {
      const atlasDoc  = atlasMap.get(doc._id.toString());
      if (!atlasDoc || tsOf(doc, ts) > tsOf(atlasDoc, ts)) {
        pushOps.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      }
    }
    if (pushOps.length) {
      await atlasDb.collection(nombre).bulkWrite(pushOps, { ordered: false });
      stats.pushed += pushOps.length;
    }

    // Pull: docs de Atlas más nuevos que en local
    const pullOps = [];
    for (const doc of atlasDocs) {
      const localDoc = localMap.get(doc._id.toString());
      if (!localDoc || tsOf(doc, ts) > tsOf(localDoc, ts)) {
        pullOps.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      }
    }
    if (pullOps.length) {
      await localDb.collection(nombre).bulkWrite(pullOps, { ordered: false });
      stats.pulled += pullOps.length;
    }
  }

  // ── 3. Append-only — solo push de docs nuevos ────────────────────
  const estado    = await localDb.collection('_sync_estado').findOne({}) ?? {};
  const lastSync  = estado.lastSync ? new Date(estado.lastSync) : new Date(0);

  for (const { nombre, ts } of COL_APPEND) {
    const nuevos = await localDb.collection(nombre)
      .find({ [ts]: { $gt: lastSync } })
      .toArray();

    if (!nuevos.length) continue;

    const ops = nuevos.map(doc => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    await atlasDb.collection(nombre).bulkWrite(ops, { ordered: false });
    stats.pushed += nuevos.length;
  }

  // ── 4. Eliminaciones pendientes ──��───────────────────────────────
  const eliminaciones = await localDb.collection('_eliminaciones').find({}).toArray();
  for (const e of eliminaciones) {
    try {
      await atlasDb.collection(e.coleccion).deleteOne({ _id: e.docId });
      stats.eliminados++;
    } catch { /* ignorar errores individuales */ }
  }
  if (eliminaciones.length) {
    await localDb.collection('_eliminaciones').deleteMany({});
  }

  // ── 5. Guardar timestamp del sync ─────��──────────────────────────
  await localDb.collection('_sync_estado').updateOne(
    {},
    { $set: { lastSync: new Date() } },
    { upsert: true }
  );

  return stats;
}

async function run() {
  const local = new MongoClient(LOCAL_URI);
  const atlas = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 8000 });

  try {
    await local.connect();
    await atlas.connect();

    const localDb = local.db(DB_NAME);
    const atlasDb = atlas.db(DB_NAME);

    log('🔄 Iniciando sync…');
    const stats = await sincronizar(localDb, atlasDb);
    log(`✅ Sync completo — ↑${stats.pushed} ↓${stats.pulled}${stats.eliminados ? ` 🗑${stats.eliminados}` : ''}`);

  } catch (err) {
    log(`⚠️  Sin conexión a Atlas, se reintentará en 5 min (${err.message})`);
  } finally {
    await local.close().catch(() => {});
    await atlas.close().catch(() => {});
  }
}

log('👀 Sync bidireccional activo — cada 5 minutos…');
run();
setInterval(run, INTERVALO);
