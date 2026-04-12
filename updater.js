const { execSync, spawn } = require('child_process');

const INTERVALO = 2 * 60 * 1000; // revisar cada 2 minutos

let servidor = null;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function iniciarServidor() {
  if (servidor) servidor.kill();

  servidor = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, DB_MODE: 'prod' },
  });

  servidor.on('exit', code => {
    if (code !== null) log(`⚠️  Servidor terminó (code ${code}), reiniciando...`);
    setTimeout(iniciarServidor, 2000);
  });

  log('🚀 Servidor iniciado');
}

function hayActualizacion() {
  try {
    execSync('git fetch', { cwd: __dirname, timeout: 10000 });
    const estado = execSync('git status -uno', { cwd: __dirname }).toString();
    return estado.includes('Your branch is behind');
  } catch {
    return false; // sin internet o sin git
  }
}

function actualizar() {
  try {
    log('🔄 Aplicando actualización...');
    execSync('git pull', { cwd: __dirname });

    // reinstalar deps si cambió package.json
    try {
      execSync('git diff HEAD@{1} --name-only', { cwd: __dirname })
        .toString().includes('package.json') &&
        execSync('npm install', { cwd: __dirname });
    } catch { /* ignorar */ }

    log('✅ Actualización aplicada, reiniciando servidor...');
    iniciarServidor();
  } catch (err) {
    log(`❌ Error al actualizar: ${err.message}`);
  }
}

function verificar() {
  if (hayActualizacion()) {
    actualizar();
  }
}

// Arranque inicial
iniciarServidor();
setInterval(verificar, INTERVALO);
log('👀 Vigilando actualizaciones cada 2 minutos...');
