#!/usr/bin/env bash
#
# instalar-linux.sh — Instalador del POS en una máquina Ubuntu (prod).
#
# Deja lista una máquina nueva como PROD: Node, MongoDB local, dependencias,
# datos bajados de Atlas y autoarranque (servidor + sync + navegador kiosko).
#
# Detecta si el CPU tiene AVX:
#   - con AVX    -> MongoDB 8.0
#   - sin AVX    -> MongoDB 4.4 (última versión que corre sin AVX)
#
# USO (NO uses sudo para lanzarlo; el script pide sudo cuando lo necesita):
#   cd ~/POS
#   git checkout PROD && git pull
#   bash instalar-linux.sh
#
set -euo pipefail

# ── No debe correr como root (necesita el usuario real para systemd --user) ──
if [ "$(id -u)" = "0" ]; then
  echo "❌ No ejecutes esto con sudo. Córrelo como tu usuario normal:  bash instalar-linux.sh"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
USUARIO="$(id -un)"

echo "════════════════════════════════════════════════════"
echo "  Instalador POS (prod) — Linux"
echo "  Carpeta del repo: $REPO_DIR"
echo "  Usuario:          $USUARIO"
echo "════════════════════════════════════════════════════"

# Codename de Ubuntu (noble, jammy, focal…)
. /etc/os-release
CODENAME="${VERSION_CODENAME:-jammy}"
echo "→ Ubuntu detectado: $CODENAME"

# ── 1. Paquetes base: Node, git, chromium ──────────────────────────
echo ""
echo "── [1/6] Instalando Node.js, git y chromium…"
sudo apt update
sudo apt install -y curl git ca-certificates gnupg

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "   node ya instalado: $(node -v)"
fi

# Chromium: en 24.04 el paquete apt es 'chromium-browser' (snap). Instalamos y
# luego detectamos el binario real para el acceso directo del kiosko.
sudo apt install -y chromium-browser || sudo apt install -y chromium || true

# ── 2. MongoDB (elige versión según AVX) ───────────────────────────
echo ""
echo "── [2/6] Instalando MongoDB local…"

if command -v mongod >/dev/null 2>&1 && systemctl is-active --quiet mongod; then
  echo "   MongoDB ya está corriendo, se omite la instalación."
else
  if grep -qo avx /proc/cpuinfo; then
    MONGO_VER="8.0"
    MONGO_CODENAME="$CODENAME"
    echo "   CPU con AVX → MongoDB 8.0"
  else
    MONGO_VER="4.4"
    MONGO_CODENAME="focal"   # 4.4 solo tiene repos hasta focal
    echo "   CPU sin AVX → MongoDB 4.4"

    # 4.4 necesita libssl1.1, que 24.04/22.04 ya no traen: se instala a mano.
    if ! dpkg -s libssl1.1 >/dev/null 2>&1; then
      echo "   Instalando libssl1.1 (requisito de MongoDB 4.4)…"
      POOL="http://security.ubuntu.com/ubuntu/pool/main/o/openssl/"
      DEB="$(curl -s "$POOL" | grep -o 'libssl1.1_[^"]*_amd64.deb' | sort -V | tail -1)"
      if [ -z "$DEB" ]; then
        echo "   ❌ No pude encontrar libssl1.1 en $POOL — instálalo a mano y reintenta."
        exit 1
      fi
      curl -fsSL -o "/tmp/$DEB" "$POOL$DEB"
      sudo dpkg -i "/tmp/$DEB"
    fi
  fi

  # Limpieza de intentos previos y datos incompatibles.
  # El purge es clave: si ya había un MongoDB de otra versión instalado
  # (p.ej. 8.0), apt NO lo degradaría solo y quedaría el binario incorrecto.
  sudo systemctl stop mongod 2>/dev/null || true
  sudo apt purge -y 'mongodb-org*' 2>/dev/null || true
  sudo rm -rf /var/lib/mongodb/* /var/log/mongodb/* 2>/dev/null || true
  sudo rm -f /etc/apt/sources.list.d/mongodb-org-*.list
  sudo rm -f /usr/share/keyrings/mongodb-server-*.gpg

  curl -fsSL "https://pgp.mongodb.com/server-${MONGO_VER}.asc" \
    | sudo gpg -o "/usr/share/keyrings/mongodb-server-${MONGO_VER}.gpg" --dearmor

  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-${MONGO_VER}.gpg ] https://repo.mongodb.org/apt/ubuntu ${MONGO_CODENAME}/mongodb-org/${MONGO_VER} multiverse" \
    | sudo tee "/etc/apt/sources.list.d/mongodb-org-${MONGO_VER}.list" >/dev/null

  sudo apt update
  sudo apt install -y mongodb-org
  sudo systemctl enable --now mongod
fi

# Espera a que Mongo escuche en 27017
echo "   Esperando a que MongoDB responda…"
for i in $(seq 1 30); do
  if curl -s localhost:27017 >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! systemctl is-active --quiet mongod; then
  echo "   ❌ MongoDB no arrancó. Revisa:  sudo tail -n 30 /var/log/mongodb/mongod.log"
  exit 1
fi
echo "   ✅ MongoDB activo."

# ── 3. Rama PROD + dependencias del proyecto ───────────────────────
echo ""
echo "── [3/6] Preparando el proyecto (rama PROD + npm install)…"
cd "$REPO_DIR"
git checkout PROD 2>/dev/null || echo "   (aviso: no pude cambiar a PROD, sigo con la rama actual)"
git pull 2>/dev/null || true
npm install

# ── 4. Bajar datos de Atlas ────────────────────────────────────────
echo ""
echo "── [4/6] Bajando datos de producción desde Atlas…"
if node bajar_prod.js; then
  echo "   ✅ Datos bajados."
else
  echo "   ⚠️  No se pudieron bajar los datos (¿IP no autorizada en Atlas o sin internet?)."
  echo "      Autoriza la IP en cloud.mongodb.com → Network Access y luego corre:"
  echo "         cd $REPO_DIR && node bajar_prod.js"
fi

# ── 5. Servicios systemd (servidor + sync) ─────────────────────────
echo ""
echo "── [5/6] Configurando autoarranque (systemd)…"
NODE_BIN="$(command -v node)"
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/pos.service <<EOF
[Unit]
Description=POS server + updater
After=network-online.target

[Service]
WorkingDirectory=${REPO_DIR}
ExecStart=${NODE_BIN} updater.js
Restart=always

[Install]
WantedBy=default.target
EOF

cat > ~/.config/systemd/user/pos-sync.service <<EOF
[Unit]
Description=POS sync con Atlas
After=network-online.target

[Service]
WorkingDirectory=${REPO_DIR}
Environment=DB_MODE=prod
ExecStart=${NODE_BIN} sync.js
Restart=always

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now pos pos-sync
sudo loginctl enable-linger "$USUARIO"

# ── 6. Navegador en modo kiosko al iniciar sesión ──────────────────
echo ""
echo "── [6/6] Configurando navegador kiosko…"
CHROME_BIN="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"
mkdir -p ~/.config/autostart

cat > ~/.config/autostart/pos-kiosk.desktop <<EOF
[Desktop Entry]
Type=Application
Name=POS Kiosk
Exec=${CHROME_BIN} --kiosk http://localhost:3000
X-GNOME-Autostart-enabled=true
EOF

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Instalación terminada."
echo ""
echo "  Comprueba el servidor:   curl -s localhost:3000 | head -c 80"
echo "  Estado del servicio:     systemctl --user status pos"
echo ""
echo "  IMPORTANTE:"
echo "   • Activa el inicio de sesión automático en Ajustes → Usuarios,"
echo "     para que al prender la máquina abra solo el POS en kiosko."
echo "   • Apaga la máquina de prod ANTERIOR para no sincronizar dos a la vez."
echo "   • Si los datos no bajaron, autoriza la IP en Atlas y corre bajar_prod.js."
echo "════════════════════════════════════════════════════"
