/**
 * publicar.js — Sube los cambios de `test` a `PROD` como una nueva versión.
 * Uso: node publicar.js
 */

const { execSync } = require('child_process');
const readline      = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const preguntar = txt => new Promise(r => rl.question(txt, r));

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: __dirname, encoding: 'utf8' }).trim();
}

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`\x1b[32m✔ ${msg}\x1b[0m`); }
function error(msg){ console.error(`\x1b[31m✖ ${msg}\x1b[0m`); }
function info(msg) { console.log(`\x1b[36mℹ ${msg}\x1b[0m`); }

function siguienteVersion(actual, tipo) {
  const match = actual.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Formato de versión no reconocido: ${actual}`);
  let [, M, m, p] = match.map(Number);
  if (tipo === 'major') { M++; m = 0; p = 0; }
  else if (tipo === 'minor') { m++; p = 0; }
  else { p++; }
  return `v${M}.${m}.${p}`;
}

async function main() {
  console.log('\n\x1b[1m─── Publicar nueva versión a PROD ───\x1b[0m\n');

  // 1. Verificar rama actual
  const ramaActual = git('rev-parse --abbrev-ref HEAD');
  if (ramaActual !== 'test') {
    error(`Debes estar en la rama 'test' para publicar. Rama actual: ${ramaActual}`);
    process.exit(1);
  }
  ok(`Rama actual: test`);

  // 2. Verificar que no haya cambios sin confirmar
  const status = git('status --porcelain');
  if (status) {
    error('Hay cambios sin confirmar en test. Haz commit o stash antes de publicar.');
    log(status);
    process.exit(1);
  }
  ok('Sin cambios pendientes');

  // 3. Verificar que test esté sincronizado con origin/test
  git('fetch origin');
  const localTest  = git('rev-parse test');
  const remoteTest = git('rev-parse origin/test');
  if (localTest !== remoteTest) {
    error('La rama test local no está sincronizada con origin/test. Haz push o pull primero.');
    process.exit(1);
  }
  ok('test sincronizado con origin');

  // 4. Versión actual y siguiente
  let versionActual;
  try {
    versionActual = git('describe --tags --abbrev=0');
  } catch {
    versionActual = 'v0.0.0';
  }
  info(`Versión actual: ${versionActual}`);

  log('\n¿Qué tipo de cambio es?');
  log('  1) patch  — corrección de bugs      (v1.2.3 → v1.2.4)');
  log('  2) minor  — funcionalidad nueva      (v1.2.3 → v1.3.0)');
  log('  3) major  — cambio importante/rompe  (v1.2.3 → v2.0.0)');
  log('  4) custom — escribir versión manual\n');

  const opcion = (await preguntar('Elige [1/2/3/4]: ')).trim();

  let nuevaVersion;
  if (opcion === '4') {
    const custom = (await preguntar('Escribe la versión (ej: v1.5.0): ')).trim();
    if (!/^v\d+\.\d+\.\d+$/.test(custom)) {
      error('Formato inválido. Usa vX.Y.Z');
      process.exit(1);
    }
    nuevaVersion = custom;
  } else {
    const tipos = { '1': 'patch', '2': 'minor', '3': 'major' };
    if (!tipos[opcion]) { error('Opción no válida'); process.exit(1); }
    nuevaVersion = siguienteVersion(versionActual, tipos[opcion]);
  }

  // 5. Confirmación final
  const commits = git(`log PROD..test --oneline`);
  log(`\nCommits que se publicarán:\n\x1b[33m${commits || '(ninguno nuevo)'}\x1b[0m\n`);
  const confirmar = (await preguntar(`¿Publicar ${nuevaVersion} a PROD? [s/N]: `)).trim().toLowerCase();
  if (confirmar !== 's') {
    info('Cancelado.');
    rl.close();
    return;
  }

  rl.close();

  // 6. Push test
  log('\nAplicando cambios...');
  git('push origin test');
  ok('Push origin test');

  // 7. Merge test → PROD
  git('checkout PROD');
  git('merge test --no-edit');
  ok('Merge test → PROD');

  // 8. Tag
  git(`tag ${nuevaVersion}`);
  ok(`Tag ${nuevaVersion} creado`);

  // 9. Push
  git('push origin PROD');
  ok('Push origin PROD');
  git(`push origin ${nuevaVersion}`);
  ok(`Push tag ${nuevaVersion}`);

  // 10. Volver a test
  git('checkout test');
  ok('De vuelta en test');

  console.log(`\n\x1b[1m\x1b[32m✔ Publicado ${nuevaVersion} — la máquina de prod actualizará en los próximos 2 minutos.\x1b[0m\n`);
}

main().catch(err => {
  error(err.message);
  rl.close();
  process.exit(1);
});
