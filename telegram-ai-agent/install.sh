#!/usr/bin/env bash
#
# One-Command Installer: Telegram AI Coding Agent
# Mendukung: macOS (Apple Silicon & Intel) dan Linux VPS (Ubuntu / Debian / dll.)
#
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🤖 Setup Otomatis: Telegram AI Coding Agent           ${NC}"
echo -e "${BLUE}   Mendukung Mac, Linux VPS & Raspberry Pi            ${NC}"
echo -e "${BLUE}======================================================${NC}"

REPO_URL="https://github.com/taufik-hdyt25/AIAgent.git"
INSTALL_DIR="th-agent"

OS="$(uname -s)"
ARCH="$(uname -m)"

IS_PI=false
if [ -f "/proc/device-tree/model" ] && grep -qi "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    IS_PI=true
elif grep -qi "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    IS_PI=true
elif [ -f "/etc/rpi-issue" ]; then
    IS_PI=true
fi

if [ "$IS_PI" = true ]; then
    echo -e "${GREEN}🍓 Sistem Terdeteksi: Raspberry Pi (Linux ${ARCH})${NC}"
else
    echo -e "${CYAN}Sistem Terdeteksi: ${OS} (${ARCH})${NC}"
fi

# ==============================================================================
# Deteksi Lingkungan Instalasi (Mac lokal / VPS / Raspberry Pi / Docker / WSL)
# ==============================================================================
detect_target_env() {
    if [ -n "${TH_AGENT_ENV:-}" ]; then
        TARGET_ENV="$TH_AGENT_ENV"
        return 0
    fi
    if [ "$OS" = "Darwin" ]; then
        TARGET_ENV="mac"
    elif [ "$IS_PI" = true ]; then
        TARGET_ENV="raspberry-pi"
    elif [ -f "/.dockerenv" ] || grep -qaE 'docker|kubepods' /proc/1/cgroup 2>/dev/null; then
        TARGET_ENV="docker"
    elif grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        TARGET_ENV="wsl"
    else
        TARGET_ENV="vps"
    fi
}
detect_target_env

target_env_label() {
    case "$TARGET_ENV" in
        mac) echo "macOS lokal (laptop/desktop)" ;;
        vps) echo "Linux VPS / server" ;;
        raspberry-pi) echo "Raspberry Pi" ;;
        docker) echo "Docker container" ;;
        wsl) echo "Windows WSL" ;;
        *) echo "$TARGET_ENV" ;;
    esac
}

default_web_host() {
    case "$TARGET_ENV" in
        mac|wsl) echo "127.0.0.1" ;;
        *) echo "0.0.0.0" ;;
    esac
}

detect_server_ip() {
    local ip=""
    for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com"; do
        ip="$(curl -fsS -m 4 "$url" 2>/dev/null | tr -d '[:space:]')"
        if [ -n "$ip" ]; then
            echo "$ip"
            return 0
        fi
    done
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo "${ip:-localhost}"
}

env_get() {
    local file="$1" key="$2"
    [ -f "$file" ] || return 0
    grep -E "^${key}=" "$file" 2>/dev/null | head -n 1 | cut -d '=' -f2- | tr -d ' \r'
}

env_set() {
    local file="$1" key="$2" value="$3"
    [ -f "$file" ] || touch "$file"
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

rand_hex() {
    local bytes="${1:-16}"
    if command -v openssl &>/dev/null; then
        openssl rand -hex "$bytes"
    else
        head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

echo -e "${CYAN}🌍 Lingkungan instalasi: ${TARGET_ENV} — $(target_env_label)${NC}"

case "$OS" in
    MINGW*|MSYS*|CYGWIN*)
        echo -e "${YELLOW}🪟 Terdeteksi Lingkungan Windows (Git Bash / MSYS)!${NC}"
        echo -e "${CYAN}Untuk setup native Windows otomatis terbaik, jalankan perintah ini di PowerShell:${NC}"
        echo -e "   ${GREEN}irm https://raw.githubusercontent.com/taufik-hdyt25/AIAgent/main/telegram-ai-agent/install.ps1 | iex${NC}"
        echo ""
        ;;
esac

# ==============================================================================
# Helper Fungsi
# ==============================================================================

# Helper input interaktif yang tetap bekerja meskipun dijalankan via 'curl | bash'
prompt_user() {
    local text="$1"
    local var_name="$2"
    local reply=""
    if [ -t 0 ]; then
        read -rp "$text" reply
    elif [ -e /dev/tty ]; then
        read -rp "$text" reply < /dev/tty || reply=""
    else
        reply=""
    fi
    eval "$var_name=\"\$reply\""
}

# Helper sinkronisasi git aman & bersih
sync_git_repo_cleanly() {
    local target_dir="${1:-$(pwd)}"
    if [ -d "$target_dir/.git" ]; then
        echo -e "${CYAN}Menyinkronkan repositori dari GitHub (origin/main)...${NC}"
        (
            cd "$target_dir"
            # Backup file konfigurasi user jika ada
            [ -f ".env" ] && cp -f .env .env.user.bak 2>/dev/null || true
            [ -f "telegram-ai-agent/.env" ] && cp -f telegram-ai-agent/.env telegram-ai-agent/.env.user.bak 2>/dev/null || true

            git fetch origin main 2>/dev/null || git fetch origin 2>/dev/null || true
            git checkout main 2>/dev/null || git checkout -B main origin/main 2>/dev/null || true
            git pull --ff-only origin main 2>/dev/null || git reset --hard origin/main 2>/dev/null || true

            # Pulihkan file .env user jika sebelumnya ada
            if [ -f ".env.user.bak" ]; then
                mv -f .env.user.bak .env 2>/dev/null || true
            fi
            if [ -f "telegram-ai-agent/.env.user.bak" ]; then
                mv -f telegram-ai-agent/.env.user.bak telegram-ai-agent/.env 2>/dev/null || true
            fi
        )
    fi
}

# Deteksi lokasi folder bot dan workspace secara dinamis
resolve_workspace_and_agent_dirs() {
    local cur="$(pwd)"

    # Kasus 1: Standard layout (cur/telegram-ai-agent/package.json)
    if [ -f "$cur/telegram-ai-agent/package.json" ]; then
        WORKSPACE_DIR="$cur"
        AGENT_DIR="$cur/telegram-ai-agent"
        return 0
    fi

    # Kasus 2: Berada di dalam folder telegram-ai-agent
    if [ -f "$cur/package.json" ] && [ -f "$cur/src/bot.js" ]; then
        if [ -d "$cur/../projects" ] || [ "$(basename "$cur")" = "telegram-ai-agent" ]; then
            WORKSPACE_DIR="$(cd "$cur/.." && pwd)"
            AGENT_DIR="$cur"
            return 0
        else
            WORKSPACE_DIR="$cur"
            AGENT_DIR="$cur"
            return 0
        fi
    fi

    # Kasus 3: Berada di subfolder lain (misal scripts/)
    if [ -f "$cur/../telegram-ai-agent/package.json" ]; then
        WORKSPACE_DIR="$(cd "$cur/.." && pwd)"
        AGENT_DIR="$WORKSPACE_DIR/telegram-ai-agent"
        return 0
    fi

    # Kasus 4: package.json ada di root saat ini
    if [ -f "$cur/package.json" ]; then
        WORKSPACE_DIR="$cur"
        AGENT_DIR="$cur"
        return 0
    fi

    # Kasus 5: Cek di $HOME/th-agent
    if [ -f "$HOME/th-agent/telegram-ai-agent/package.json" ]; then
        WORKSPACE_DIR="$HOME/th-agent"
        AGENT_DIR="$HOME/th-agent/telegram-ai-agent"
        return 0
    elif [ -f "$HOME/th-agent/package.json" ]; then
        WORKSPACE_DIR="$HOME/th-agent"
        AGENT_DIR="$HOME/th-agent"
        return 0
    fi

    # Kasus 6: Pulihkan dari git jika ini repositori git
    if [ -d "$cur/.git" ]; then
        echo -e "${YELLOW}File bot belum lengkap. Memulihkan file dari origin/main...${NC}"
        (cd "$cur" && git fetch origin main 2>/dev/null && git checkout origin/main -- . 2>/dev/null) || true
        if [ -f "$cur/telegram-ai-agent/package.json" ]; then
            WORKSPACE_DIR="$cur"
            AGENT_DIR="$cur/telegram-ai-agent"
            return 0
        elif [ -f "$cur/package.json" ]; then
            WORKSPACE_DIR="$cur"
            AGENT_DIR="$cur"
            return 0
        fi
    fi

    # Fallback
    WORKSPACE_DIR="$cur"
    if [ -d "$cur/telegram-ai-agent" ]; then
        AGENT_DIR="$cur/telegram-ai-agent"
    else
        AGENT_DIR="$cur"
    fi
}

# Auto clone jika installer dipanggil di luar folder repo (misal via curl | bash)
if [ ! -f "telegram-ai-agent/package.json" ] && [ ! -f "package.json" ]; then
    echo -e "\n${CYAN}>>> Menyiapkan repositori Telegram AI Agent dari GitHub...${NC}"
    if ! command -v git &>/dev/null; then
        echo -e "${YELLOW}Git belum terpasang. Memasang git...${NC}"
        if [ "$OS" = "Darwin" ]; then
            xcode-select --install 2>/dev/null || true
        elif [ "$OS" = "Linux" ] && command -v apt-get &>/dev/null; then
            sudo apt-get update -y && sudo apt-get install -y git
        fi
    fi
    if [ -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Direktori ${INSTALL_DIR} sudah ada. Masuk dan menyinkronkan...${NC}"
        cd "$INSTALL_DIR"
        sync_git_repo_cleanly "$(pwd)"
    elif [ -d ".git" ]; then
        sync_git_repo_cleanly "$(pwd)"
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    echo -e "${GREEN}✓ Direktori kerja: $(pwd)${NC}"
fi

ensure_local_bin_in_path() {
    mkdir -p "$HOME/.local/bin"
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        export PATH="$HOME/.local/bin:$PATH"
        if [ -f "$HOME/.zshrc" ] && ! grep -q '\.local/bin' "$HOME/.zshrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ] && ! grep -q '\.local/bin' "$HOME/.bashrc"; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
    fi
}

# ==============================================================================
# 1. CHECKLIST ENGINE AI
# ==============================================================================
SELECTED_PI=true
DEFAULT_ENGINE="pi"

choose_engines() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[1/3] ENGINE / PROVIDER AI                            ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Bot akan menggunakan ${GREEN}Pi Coding Agent CLI (pi)${NC} sebagai satu-satunya engine agent."
    echo -e "Pi CLI terhubung ke endpoint OpenAI-compatible (CLIProxyAPI / LiteLLM / Ollama)"
    echo -e "melalui ${YELLOW}PI_SERVER_URL${NC}. Tentukan URL-nya nanti di Web UI atau .env."
    echo -e "${GREEN}✓ Engine aktif: Pi Coding Agent CLI (pi)${NC}"
}

# ==============================================================================
# 2. CHECKLIST MODEL AI
# ==============================================================================
choose_models() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[2/3] MODEL AI                                        ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Menulis daftar model Pi default ke data/models.json."
    echo -e "Daftar model asli akan diambil otomatis dari ${YELLOW}PI_SERVER_URL${NC} saat /getpi atau Get Model."

    mkdir -p data

    node -e "
    const fs = require('fs');
    const path = require('path');
    const out = {
      piModels: [
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Groq - Ultra Cepat)', badge: 'Rekomendasi' },
        { id: 'pi-deepseek-r1-7b', name: 'DeepSeek R1 7B (Local Pi Server)', badge: 'Lokal' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Groq)', badge: 'Cepat' }
      ]
    };
    fs.writeFileSync(path.join('data', 'models.json'), JSON.stringify(out, null, 2));
    "
    echo -e "${GREEN}✓ Model Pi default telah disimpan.${NC}"
}

# ==============================================================================
# 3. GITHUB CLI & AUTO-READ ISSUES
# ==============================================================================
install_gh_cli() {
    echo -e "${BLUE}Memeriksa GitHub CLI (gh)...${NC}"
    ensure_local_bin_in_path
    if command -v gh &>/dev/null; then
        echo -e "${GREEN}✓ GitHub CLI sudah terpasang: $(command -v gh)${NC}"
        return 0
    fi

    echo -e "${YELLOW}GitHub CLI belum terpasang. Memulai pemasangan GitHub CLI...${NC}"
    if [ "$OS" = "Darwin" ]; then
        if command -v brew &>/dev/null; then
            echo -e "${CYAN}Memasang via Homebrew...${NC}"
            brew install gh || true
        fi
        if ! command -v gh &>/dev/null; then
            echo -e "${CYAN}Mengunduh binary resmi GitHub CLI macOS...${NC}"
            local m_arch="arm64"
            [ "$ARCH" != "arm64" ] && m_arch="amd64"
            local tmp_dir
            tmp_dir="$(mktemp -d)"
            curl -fsSL "https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_macOS_${m_arch}.zip" -o "$tmp_dir/gh.zip"
            unzip -q "$tmp_dir/gh.zip" -d "$tmp_dir"
            mkdir -p "$HOME/.local/bin"
            cp "$tmp_dir"/gh_*/bin/gh "$HOME/.local/bin/gh"
            chmod +x "$HOME/.local/bin/gh"
            rm -rf "$tmp_dir"
            export PATH="$HOME/.local/bin:$PATH"
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v apt-get &>/dev/null; then
            echo -e "${CYAN}Memasang via APT repository resmi GitHub...${NC}"
            (sudo mkdir -p -m 755 /etc/apt/keyrings && \
             curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
             sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
             echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
             sudo apt-get update -y && sudo apt-get install -y gh) || true
        fi
        if ! command -v gh &>/dev/null; then
            echo -e "${CYAN}Mengunduh binary resmi GitHub CLI Linux...${NC}"
            local l_arch="amd64"
            if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
                l_arch="arm64"
            fi
            local tmp_dir
            tmp_dir="$(mktemp -d)"
            curl -fsSL "https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_${l_arch}.tar.gz" -o "$tmp_dir/gh.tar.gz"
            tar -xzf "$tmp_dir/gh.tar.gz" -C "$tmp_dir"
            mkdir -p "$HOME/.local/bin"
            cp "$tmp_dir"/gh_*/bin/gh "$HOME/.local/bin/gh"
            chmod +x "$HOME/.local/bin/gh"
            rm -rf "$tmp_dir"
            export PATH="$HOME/.local/bin:$PATH"
        fi
    fi

    if command -v gh &>/dev/null || [ -f "$HOME/.local/bin/gh" ]; then
        echo -e "${GREEN}✓ GitHub CLI berhasil dipasang: $(command -v gh || echo "$HOME/.local/bin/gh")${NC}"
    else
        echo -e "${YELLOW}⚠️ Pemasangan otomatis gh dilewati. Anda bisa memasangnya secara manual nanti.${NC}"
    fi
}

setup_github_cli() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${MAGENTA}[3/3] INTEGRASI GITHUB CLI & AUTO-READ ISSUES        ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Opsi ini memungkinkan TH Agent membaca issue, komentar, dan kode"
    echo -e "secara otomatis saat Anda mengirimkan link GitHub Issue di Telegram."
    prompt_user "Pasang & aktifkan GitHub CLI sekarang? (y/n, default: y): " enable_gh
    enable_gh="${enable_gh:-y}"

    if [ "$enable_gh" = "y" ] || [ "$enable_gh" = "Y" ]; then
        install_gh_cli

        echo -e "\n${CYAN}Autentikasi GitHub Personal Access Token (PAT):${NC}"
        echo -e "Buat token di: ${BLUE}https://github.com/settings/tokens${NC} (centang scope: ${YELLOW}'repo'${NC})"
        prompt_user "Masukkan GitHub Personal Access Token (PAT) [kosongkan jika belum punya]: " input_pat
        if [ -n "$input_pat" ]; then
            local gh_bin
            gh_bin="$(command -v gh || echo "$HOME/.local/bin/gh")"
            if [ -x "$gh_bin" ]; then
                echo "$input_pat" | "$gh_bin" auth login --with-token 2>/dev/null || true
                echo -e "${GREEN}✓ GitHub CLI berhasil login dengan token!${NC}"
            fi
            # Simpan token ke .env
            if [ ! -f ".env" ]; then touch .env; fi
            if grep -q "^GITHUB_TOKEN=" .env; then
                sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=${input_pat}|" .env && rm -f .env.bak
            else
                echo "GITHUB_TOKEN=${input_pat}" >> .env
            fi
            echo -e "${GREEN}✓ GITHUB_TOKEN tersimpan di konfigurasi .env${NC}"
        else
            echo -e "${YELLOW}Token dilewati. Anda dapat mengisinya nanti via .env atau Web Control Panel.${NC}"
        fi

        # Aktifkan watcher di .env
        if grep -q "^GITHUB_WATCHER_ENABLED=" .env; then
            sed -i.bak "s|^GITHUB_WATCHER_ENABLED=.*|GITHUB_WATCHER_ENABLED=true|" .env && rm -f .env.bak
        else
            echo "GITHUB_WATCHER_ENABLED=true" >> .env
        fi
    else
        echo -e "${CYAN}Integrasi GitHub CLI & Watcher dinonaktifkan.${NC}"
        if [ ! -f ".env" ]; then touch .env; fi
        if grep -q "^GITHUB_WATCHER_ENABLED=" .env; then
            sed -i.bak "s|^GITHUB_WATCHER_ENABLED=.*|GITHUB_WATCHER_ENABLED=false|" .env && rm -f .env.bak
        else
            echo "GITHUB_WATCHER_ENABLED=false" >> .env
        fi
    fi
}

# ==============================================================================
# INSTALLERS SPESIFIK
# ==============================================================================
install_pi_cli() {
    echo -e "\n${BLUE}Memeriksa Pi Coding Agent CLI...${NC}"
    if ! command -v pi &>/dev/null; then
        echo -e "${YELLOW}Pi Coding Agent CLI belum terpasang. Memasang via npm...${NC}"
        npm install -g @earendil-works/pi-coding-agent 2>/dev/null || sudo npm install -g @earendil-works/pi-coding-agent 2>/dev/null || npm install @earendil-works/pi-coding-agent || true
    else
        echo -e "${GREEN}✓ Pi Coding Agent CLI terdeteksi: $(command -v pi)${NC}"
    fi
}

# ==============================================================================
# CLIProxyAPI LOKAL — mengikuti mesin tempat TH Agent dipasang
# Mac lokal → CLIProxyAPI di Mac. VPS → CLIProxyAPI di VPS.
# ==============================================================================
CLIPROXY_PORT="${CLIPROXY_PORT:-8317}"

cliproxy_target_asset() {
    case "$OS:$ARCH" in
        Darwin:arm64) echo "darwin_aarch64" ;;
        Darwin:x86_64) echo "darwin_amd64" ;;
        Linux:x86_64|Linux:amd64) echo "linux_amd64" ;;
        Linux:aarch64|Linux:arm64) echo "linux_aarch64" ;;
        *) echo "" ;;
    esac
}

cliproxy_download_binary() {
    local target_bin="$1"
    local asset
    asset="$(cliproxy_target_asset)"
    if [ -z "$asset" ]; then
        echo -e "${YELLOW}⚠️  Arsitektur ${OS}/${ARCH} belum didukung untuk CLIProxyAPI.${NC}"
        return 1
    fi

    local version="${CLIPROXY_VERSION:-}"
    if [ -z "$version" ]; then
        version="$(curl -fsSL -m 10 "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest" 2>/dev/null \
            | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | cut -d'"' -f4)"
    fi
    [ -z "$version" ] && version="v8.0.59"

    local version_num="${version#v}"
    local url="https://github.com/router-for-me/CLIProxyAPI/releases/download/${version}/CLIProxyAPI_${version_num}_${asset}.tar.gz"

    echo -e "${CYAN}Mengunduh CLIProxyAPI ${version} (${asset})...${NC}"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    if ! curl -fsSL --retry 2 -m 300 "$url" -o "$tmp_dir/cpa.tar.gz"; then
        rm -rf "$tmp_dir"
        echo -e "${YELLOW}⚠️  Gagal mengunduh CLIProxyAPI.${NC}"
        return 1
    fi
    if ! tar -xzf "$tmp_dir/cpa.tar.gz" -C "$tmp_dir" 2>/dev/null; then
        rm -rf "$tmp_dir"
        echo -e "${YELLOW}⚠️  Gagal mengekstrak CLIProxyAPI.${NC}"
        return 1
    fi
    local extracted
    extracted="$(find "$tmp_dir" -type f -name 'cli-proxy-api*' | head -n 1)"
    if [ -z "$extracted" ]; then
        rm -rf "$tmp_dir"
        echo -e "${YELLOW}⚠️  Binary CLIProxyAPI tidak ditemukan di arsip.${NC}"
        return 1
    fi
    mkdir -p "$(dirname "$target_bin")"
    cp "$extracted" "$target_bin"
    chmod +x "$target_bin"
    xattr -dr com.apple.quarantine "$target_bin" 2>/dev/null || true
    rm -rf "$tmp_dir"
    echo -e "${GREEN}✓ CLIProxyAPI terpasang: $target_bin${NC}"
}

cliproxy_install_service() {
    local cpa_home="$1"
    if [ "$OS" = "Darwin" ]; then
        local plist="$HOME/Library/LaunchAgents/com.taufik.cli-proxy-api.plist"
        mkdir -p "$HOME/Library/LaunchAgents" "$cpa_home/logs"
        cat << EOF > "$plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.taufik.cli-proxy-api</string>
    <key>ProgramArguments</key>
    <array>
        <string>$cpa_home/bin/cli-proxy-api</string>
        <string>-config</string>
        <string>$cpa_home/config.yaml</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$cpa_home</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$cpa_home/logs/cliproxy.log</string>
    <key>StandardErrorPath</key>
    <string>$cpa_home/logs/cliproxy.error.log</string>
</dict>
</plist>
EOF
        launchctl unload "$plist" 2>/dev/null || true
        launchctl load "$plist" 2>/dev/null || true
        echo -e "${GREEN}✓ CLIProxyAPI aktif sebagai LaunchAgent (auto-start saat login)${NC}"
    else
        local unit_dir="$HOME/.config/systemd/user"
        mkdir -p "$unit_dir" "$cpa_home/logs"
        cat << EOF > "$unit_dir/cli-proxy-api.service"
[Unit]
Description=CLIProxyAPI (OpenAI-compatible gateway)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$cpa_home
ExecStart=$cpa_home/bin/cli-proxy-api -config $cpa_home/config.yaml
Restart=on-failure
RestartSec=3
StandardOutput=append:$cpa_home/logs/cliproxy.log
StandardError=append:$cpa_home/logs/cliproxy.error.log

[Install]
WantedBy=default.target
EOF
        if systemctl --user daemon-reload 2>/dev/null; then
            systemctl --user enable cli-proxy-api 2>/dev/null || true
            systemctl --user restart cli-proxy-api 2>/dev/null || true
            loginctl enable-linger "$USER" 2>/dev/null || true
            echo -e "${GREEN}✓ CLIProxyAPI aktif sebagai systemd user service${NC}"
        else
            pkill -f "cli-proxy-api -config" 2>/dev/null || true
            nohup "$cpa_home/bin/cli-proxy-api" -config "$cpa_home/config.yaml" > "$cpa_home/logs/cliproxy.log" 2>&1 &
            echo -e "${GREEN}✓ CLIProxyAPI aktif di background (PID $!)${NC}"
        fi
    fi
}

install_cliproxy_api() {
    if [ "${TH_SKIP_CLIPROXY:-}" = "1" ] || [ "$NO_CLIPROXY" = true ]; then
        echo -e "${YELLOW}⏭️  CLIProxyAPI dilewati (TH_SKIP_CLIPROXY=1 / --no-cliproxy).${NC}"
        return 0
    fi
    if [ "$TARGET_ENV" = "docker" ]; then
        echo -e "${YELLOW}ℹ️  Terdeteksi Docker container. CLIProxyAPI tidak dipasang otomatis di dalam container.${NC}"
        echo -e "   Arahkan ${YELLOW}PI_SERVER_URL${NC} ke CLIProxyAPI di host/container lain."
        return 0
    fi

    local cpa_home="$HOME/.cli-proxy-api"
    local cpa_bin="$cpa_home/bin/cli-proxy-api"
    local env_file="$AGENT_DIR/.env"
    [ -d "$AGENT_DIR" ] || env_file=".env"

    local existing_url
    existing_url="$(env_get "$env_file" "PI_SERVER_URL")"
    if [ -n "$existing_url" ] && ! echo "$existing_url" | grep -qE '(^|//)(127\.0\.0\.1|localhost):'; then
        echo -e "${YELLOW}ℹ️  PI_SERVER_URL sudah menunjuk endpoint eksternal: $existing_url${NC}"
        echo -e "${YELLOW}   CLIProxyAPI lokal tidak dipasang agar konfigurasi Anda tidak tertimpa.${NC}"
        return 0
    fi

    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${BLUE}🧩 Menyiapkan CLIProxyAPI di mesin ini                ${NC}"
    echo -e "${BLUE}======================================================${NC}"

    mkdir -p "$cpa_home/bin" "$cpa_home/logs"

    if [ ! -x "$cpa_bin" ]; then
        cliproxy_download_binary "$cpa_bin" || {
            echo -e "${YELLOW}⚠️  CLIProxyAPI otomatis dilewati. Anda tetap bisa memakai endpoint eksternal.${NC}"
            return 0
        }
    else
        echo -e "${GREEN}✓ CLIProxyAPI sudah terpasang: $cpa_bin${NC}"
    fi

    local mgmt_key client_key mgmt_created=false client_created=false
    if [ -s "$cpa_home/management-key.txt" ]; then
        mgmt_key="$(tr -d '[:space:]' < "$cpa_home/management-key.txt")"
    else
        mgmt_key="$(rand_hex 16)"
        printf '%s\n' "$mgmt_key" > "$cpa_home/management-key.txt"
        chmod 600 "$cpa_home/management-key.txt"
        mgmt_created=true
    fi

    if [ -s "$cpa_home/client-key.txt" ]; then
        client_key="$(tr -d '[:space:]' < "$cpa_home/client-key.txt")"
    elif [ -f "$cpa_home/config.yaml" ]; then
        # Config lama adalah sumber kebenaran untuk API key client yang sudah dipakai
        client_key="$(awk '/^access:/{f=1;next} f&&/^[[:space:]]*-[[:space:]]*"/{gsub(/^[[:space:]]*-[[:space:]]*"|".*$/,"");print;exit}' "$cpa_home/config.yaml")"
    fi
    if [ -z "$client_key" ]; then
        client_key="sk-th-$(rand_hex 16)"
        client_created=true
    fi
    printf '%s\n' "$client_key" > "$cpa_home/client-key.txt"
    chmod 600 "$cpa_home/client-key.txt"

    if [ ! -f "$cpa_home/config.yaml" ]; then
        cat << EOF > "$cpa_home/config.yaml"
config-version: 8
server:
  host: "127.0.0.1"
  port: ${CLIPROXY_PORT}
management:
  allow-remote: false
  secret-key: "${mgmt_key}"
access:
  api-keys:
    - "${client_key}"
oauth:
  auth-dir: "${cpa_home}"
EOF
        chmod 600 "$cpa_home/config.yaml"
        echo -e "${GREEN}✓ Konfigurasi CLIProxyAPI dibuat: $cpa_home/config.yaml${NC}"
    else
        echo -e "${GREEN}✓ Konfigurasi CLIProxyAPI sudah ada, dipertahankan.${NC}"
        if [ "$mgmt_created" = true ] && grep -qE '^[[:space:]]*secret-key:' "$cpa_home/config.yaml"; then
            awk -v k="$mgmt_key" '/^[[:space:]]*secret-key:/{print "  secret-key: \"" k "\""; next} {print}' "$cpa_home/config.yaml" > "$cpa_home/config.yaml.tmp" && mv "$cpa_home/config.yaml.tmp" "$cpa_home/config.yaml"
            echo -e "${GREEN}✓ Management key disinkronkan ke config CLIProxyAPI.${NC}"
        fi
        if [ "$client_created" = true ]; then
            if grep -qE '^[[:space:]]*api-keys:' "$cpa_home/config.yaml"; then
                awk -v k="$client_key" '/^[[:space:]]*api-keys:/{print; print "    - \"" k "\""; next} {print}' "$cpa_home/config.yaml" > "$cpa_home/config.yaml.tmp" && mv "$cpa_home/config.yaml.tmp" "$cpa_home/config.yaml"
            elif grep -qE '^access:' "$cpa_home/config.yaml"; then
                awk -v k="$client_key" '/^access:/{print; print "  api-keys:"; print "    - \"" k "\""; next} {print}' "$cpa_home/config.yaml" > "$cpa_home/config.yaml.tmp" && mv "$cpa_home/config.yaml.tmp" "$cpa_home/config.yaml"
            else
                { echo 'access:'; echo '  api-keys:'; echo "    - \"$client_key\""; } >> "$cpa_home/config.yaml"
            fi
            echo -e "${GREEN}✓ API key client disinkronkan ke config CLIProxyAPI.${NC}"
        fi
    fi

    cliproxy_install_service "$cpa_home"

    env_set "$env_file" "CLIPROXY_URL" "http://127.0.0.1:${CLIPROXY_PORT}"
    env_set "$env_file" "CLIPROXY_MGMT_KEY" "$mgmt_key"
    env_set "$env_file" "CLIPROXY_CLIENT_KEY" "$client_key"
    env_set "$env_file" "PI_SERVER_URL" "http://127.0.0.1:${CLIPROXY_PORT}/v1"
    env_set "$env_file" "PI_SERVER_API_KEY" "$client_key"

    if [ -f "$HOME/.th-agent/.env" ] && [ "$env_file" != "$HOME/.th-agent/.env" ]; then
        env_set "$HOME/.th-agent/.env" "CLIPROXY_URL" "http://127.0.0.1:${CLIPROXY_PORT}"
        env_set "$HOME/.th-agent/.env" "CLIPROXY_MGMT_KEY" "$mgmt_key"
        env_set "$HOME/.th-agent/.env" "CLIPROXY_CLIENT_KEY" "$client_key"
        env_set "$HOME/.th-agent/.env" "PI_SERVER_URL" "http://127.0.0.1:${CLIPROXY_PORT}/v1"
        env_set "$HOME/.th-agent/.env" "PI_SERVER_API_KEY" "$client_key"
    fi

    sleep 2
    if curl -fsS -m 5 -H "Authorization: Bearer ${client_key}" "http://127.0.0.1:${CLIPROXY_PORT}/v1/models" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ CLIProxyAPI online di http://127.0.0.1:${CLIPROXY_PORT}${NC}"
    else
        echo -e "${YELLOW}ℹ️  CLIProxyAPI belum merespons. Cek log: $cpa_home/logs/${NC}"
        echo -e "   Login provider: buka Web UI → Login via Browser, atau jalankan:"
        echo -e "   ${CYAN}$cpa_bin -config $cpa_home/config.yaml -antigravity-login${NC}"
    fi
}

setup_directories() {
    echo -e "\n${BLUE}Menyiapkan direktori kerja...${NC}"
    mkdir -p projects
    if [ -d "telegram-ai-agent" ]; then
        mkdir -p telegram-ai-agent/data telegram-ai-agent/logs telegram-ai-agent/uploads telegram-ai-agent/public
    else
        mkdir -p data logs uploads
    fi
    chmod 755 projects 2>/dev/null || true
    local target_user="${SUDO_USER:-$USER}"
    if [ -n "$target_user" ]; then
        chown -R "$target_user" projects 2>/dev/null || true
        if [ -d "telegram-ai-agent" ]; then
            chown -R "$target_user" telegram-ai-agent/data telegram-ai-agent/logs telegram-ai-agent/uploads 2>/dev/null || true
        fi
    fi

    # Bersihkan jika ada folder data/logs/uploads usang di root level
    if [ -d "telegram-ai-agent" ]; then
        for d in data logs uploads; do
            if [ -d "$d" ] && [ ! -L "$d" ]; then
                cp -rn "$d"/* "telegram-ai-agent/$d/" 2>/dev/null || true
                rm -rf "$d" 2>/dev/null || true
            fi
        done
    fi
    echo -e "${GREEN}✓ Direktori siap.${NC}"
}

setup_env_file() {
    echo -e "\n${BLUE}Menyiapkan file konfigurasi .env...${NC}"
    resolve_workspace_and_agent_dirs
    local env_file="$AGENT_DIR/.env"
    if [ ! -d "$AGENT_DIR" ]; then
        env_file=".env"
    fi

    if [ ! -f "$env_file" ]; then
        if [ -f "telegram-ai-agent/.env.example" ]; then
            cp telegram-ai-agent/.env.example "$env_file"
        elif [ -f ".env.example" ]; then
            cp .env.example "$env_file"
        else
            touch "$env_file"
        fi
    fi

    # Deteksi path binary aktual di sistem ini
    ACTUAL_PI_BIN="$(command -v pi || echo "$HOME/.local/bin/pi")"

    # Perbarui path binary Pi di .env jika belum diset
    if grep -q "^PI_BIN=" "$env_file"; then
        if [ -n "$ACTUAL_PI_BIN" ] && [ -x "$ACTUAL_PI_BIN" ]; then
            sed -i.bak "s|^PI_BIN=.*|PI_BIN=${ACTUAL_PI_BIN}|" "$env_file" && rm -f "$env_file.bak"
        fi
    else
        echo "PI_BIN=${ACTUAL_PI_BIN}" >> "$env_file"
    fi

    # Default endpoint Pi (CLIProxyAPI default port 8317)
    if ! grep -q "^PI_SERVER_URL=" "$env_file"; then
        echo "PI_SERVER_URL=http://127.0.0.1:8317/v1" >> "$env_file"
    fi

    # Host bind Web UI: Mac/WSL lokal hanya localhost, VPS/server bisa diakses dari luar
    if [ -z "$(env_get "$env_file" "WEB_HOST")" ]; then
        env_set "$env_file" "WEB_HOST" "$(default_web_host)"
    fi

    if ! grep -q "^PI_MODEL=" "$env_file"; then
        echo "PI_MODEL=openai/gpt-oss-120b" >> "$env_file"
    fi

    # Cek apakah BOT_TOKEN dan ALLOWED_TELEGRAM_IDS sudah terisi
    CURRENT_TOKEN="$(grep -E "^BOT_TOKEN=" "$env_file" | cut -d '=' -f2- | tr -d ' ' || true)"
    CURRENT_IDS="$(grep -E "^ALLOWED_TELEGRAM_IDS=" "$env_file" | cut -d '=' -f2- | tr -d ' ' || true)"

    if [ -z "$CURRENT_TOKEN" ]; then
        echo -e "${YELLOW}BOT_TOKEN masih kosong.${NC}"
        prompt_user "Masukkan BOT_TOKEN dari @BotFather (atau tekan Enter untuk isi nanti di Web UI): " input_token
        if [ -n "$input_token" ]; then
            sed -i.bak "s|^BOT_TOKEN=.*|BOT_TOKEN=${input_token}|" "$env_file" && rm -f "$env_file.bak"
        fi
    fi

    if [ -z "$CURRENT_IDS" ]; then
        echo -e "${YELLOW}ALLOWED_TELEGRAM_IDS belum diset.${NC}"
        prompt_user "Masukkan User ID Telegram Anda (atau tekan Enter untuk isi nanti di Web UI): " input_id
        if [ -n "$input_id" ]; then
            sed -i.bak "s|^ALLOWED_TELEGRAM_IDS=.*|ALLOWED_TELEGRAM_IDS=${input_id}|" "$env_file" && rm -f "$env_file.bak"
        fi
    fi

    chmod 600 "$env_file" 2>/dev/null || true

    # Bersihkan file .env di root jika ada agar tidak mengotori workspace
    if [ "$env_file" != ".env" ] && [ -f ".env" ]; then
        rm -f .env .env.bak 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ Konfigurasi .env siap.${NC}"
}

# ==============================================================================
# STANDALONE BINARY BUNDLE & 24/7 BACKGROUND SERVICE
# ==============================================================================
setup_binary_bundle_and_service() {
    resolve_workspace_and_agent_dirs
    local workspace_dir="$WORKSPACE_DIR"
    local agent_dir="$AGENT_DIR"
    local global_dir="$HOME/.th-agent"
    local bin_link="$HOME/.local/bin/th-agent"
    local node_bin="$(command -v node || which node)"

    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${BLUE}📦 Mem-bundle TH Agent Menjadi Standalone Binary...   ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${CYAN}✓ Workspace Root:${NC} $workspace_dir"
    echo -e "${CYAN}✓ Bot Directory :${NC} $agent_dir"

    mkdir -p "$global_dir/logs" "$global_dir/data" "$global_dir/uploads" "$global_dir/public" "$HOME/.local/bin"

    # Verifikasi package.json ada
    if [ ! -f "$agent_dir/package.json" ]; then
        echo -e "${YELLOW}File package.json tidak ditemukan di $agent_dir. Mencari di workspace root...${NC}"
        if [ -f "$workspace_dir/package.json" ]; then
            agent_dir="$workspace_dir"
        elif [ -d "$workspace_dir/.git" ]; then
            echo -e "${YELLOW}Mengambil file bot dari origin/main...${NC}"
            (cd "$workspace_dir" && git fetch origin main 2>/dev/null && git checkout origin/main -- . 2>/dev/null) || true
            if [ -f "$workspace_dir/telegram-ai-agent/package.json" ]; then
                agent_dir="$workspace_dir/telegram-ai-agent"
            elif [ -f "$workspace_dir/package.json" ]; then
                agent_dir="$workspace_dir"
            fi
        fi
    fi

    # 1. Pastikan esbuild tersedia & build single-file executable bundle
    echo -e "${CYAN}Mengompilasi single-file executable bundle dengan esbuild...${NC}"
    cd "$agent_dir"
    if [ ! -d "node_modules" ]; then
        npm install --silent 2>/dev/null || npm install
    fi

    local entry_file="src/bot.js"
    if [ ! -f "$entry_file" ] && [ -f "$workspace_dir/telegram-ai-agent/src/bot.js" ]; then
        entry_file="$workspace_dir/telegram-ai-agent/src/bot.js"
    elif [ ! -f "$entry_file" ] && [ -f "$workspace_dir/src/bot.js" ]; then
        entry_file="$workspace_dir/src/bot.js"
    fi

    npx -y esbuild "$entry_file" --bundle --platform=node --format=esm \
        --banner:js="#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
        --target=node20 --outfile="$global_dir/th-agent-bin"
    chmod +x "$global_dir/th-agent-bin"

    # Salin juga ke local dist agar terlihat jika dibuka
    mkdir -p "$agent_dir/dist"
    cp "$global_dir/th-agent-bin" "$agent_dir/dist/bot.bundle.js" 2>/dev/null || true

    # Bersihkan node_modules sementara di folder kerja agar workspace 100% bersih
    rm -rf node_modules package-lock.json 2>/dev/null || true
    cd "$workspace_dir"

    # 2. Salin asset Web UI & file .env ke isolated directory
    if [ -d "$agent_dir/public" ]; then
        cp -r "$agent_dir/public"/* "$global_dir/public/" 2>/dev/null || true
    elif [ -d "$workspace_dir/public" ]; then
        cp -r "$workspace_dir/public"/* "$global_dir/public/" 2>/dev/null || true
    fi

    if [ -f "$agent_dir/.env" ]; then
        cp "$agent_dir/.env" "$global_dir/.env"
    elif [ -f "$workspace_dir/.env" ]; then
        cp "$workspace_dir/.env" "$global_dir/.env"
    fi

    # 3. Buat CLI Command Wrapper di ~/.local/bin/th-agent
    cat << 'EOF' > "$bin_link"
#!/usr/bin/env bash
GLOBAL_DIR="$HOME/.th-agent"
LOG_FILE="$GLOBAL_DIR/logs/bot.log"
ERR_FILE="$GLOBAL_DIR/logs/error.log"

case "$1" in
  logs)
    if [ -f "$LOG_FILE" ] || [ -f "$ERR_FILE" ]; then
      tail -f "$LOG_FILE" "$ERR_FILE" 2>/dev/null
    else
      tail -f "$GLOBAL_DIR/logs/"*.log 2>/dev/null || echo "Belum ada file log di $GLOBAL_DIR/logs/"
    fi
    ;;
  status)
    if [ "$(uname -s)" = "Darwin" ]; then
      if launchctl list 2>/dev/null | grep -q "com.taufik.th-agent"; then
        echo "🟢 Status: Aktif di macOS LaunchAgent (24/7 Background)"
      else
        echo "🔴 Status: Tidak aktif di LaunchAgent"
      fi
    else
      if systemctl --user is-active th-agent &>/dev/null; then
        echo "🟢 Status: Aktif di systemd user service (24/7)"
      elif pgrep -f "th-agent-bin" &>/dev/null; then
        echo "🟢 Status: Aktif (Process PID $(pgrep -f "th-agent-bin" | head -n 1))"
      else
        echo "🔴 Status: Tidak aktif"
      fi
    fi
    ;;
  restart)
    if [ "$(uname -s)" = "Darwin" ]; then
      launchctl unload "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist" 2>/dev/null || true
      launchctl load "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist"
      echo "✓ Service berhasil di-restart di macOS LaunchAgent"
    else
      if systemctl --user restart th-agent 2>/dev/null; then
        echo "✓ Service berhasil di-restart via systemd"
      else
        pkill -f "th-agent-bin" 2>/dev/null || true
        nohup "$GLOBAL_DIR/th-agent-bin" > "$LOG_FILE" 2> "$ERR_FILE" &
        echo "✓ Service berhasil di-restart di background"
      fi
    fi
    ;;
  stop)
    if [ "$(uname -s)" = "Darwin" ]; then
      launchctl unload "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist" 2>/dev/null || true
      echo "✓ Service berhasil dihentikan"
    else
      systemctl --user stop th-agent 2>/dev/null || pkill -f "th-agent-bin" 2>/dev/null || true
      echo "✓ Service berhasil dihentikan"
    fi
    ;;
  start)
    if [ "$(uname -s)" = "Darwin" ]; then
      launchctl load "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist" 2>/dev/null || true
      echo "✓ Service berhasil dijalankan"
    else
      if systemctl --user start th-agent 2>/dev/null; then
        echo "✓ Service berhasil dijalankan via systemd"
      else
        nohup "$GLOBAL_DIR/th-agent-bin" > "$LOG_FILE" 2> "$ERR_FILE" &
        echo "✓ Service berhasil dijalankan di background"
      fi
    fi
    ;;
  run)
    exec "$GLOBAL_DIR/th-agent-bin"
    ;;
  uninstall)
    echo "🛑 Menghentikan service TH Agent..."
    if [ "$(uname -s)" = "Darwin" ]; then
      launchctl unload "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist" 2>/dev/null || true
      rm -f "$HOME/Library/LaunchAgents/com.taufik.th-agent.plist" 2>/dev/null || true
      echo "✓ Service LaunchAgent berhasil dihentikan & dihapus."
      echo "🔄 Mereset pengaturan daya macOS ke default awal pabrik (sudo pmset restoredefaults)..."
      if sudo pmset restoredefaults 2>/dev/null; then
        echo "✓ Pengaturan power/sleep macOS berhasil dikembalikan ke default."
      else
        echo "ℹ️  Jalankan 'sudo pmset restoredefaults' jika ingin mereset pengaturan daya Mac secara manual."
      fi
    else
      systemctl --user stop th-agent 2>/dev/null || pkill -f "th-agent-bin" 2>/dev/null || true
      systemctl --user disable th-agent 2>/dev/null || true
      rm -f "$HOME/.config/systemd/user/th-agent.service" 2>/dev/null || true
      systemctl --user daemon-reload 2>/dev/null || true
      echo "✓ Service systemd berhasil dihentikan & dihapus."
    fi
    rm -f "$HOME/.local/bin/th-agent" 2>/dev/null || true
    echo "✓ TH Agent berhasil di-uninstall."
    ;;
  help|--help|-h)
    echo "⚡ TH Agent CLI Binary Runner"
    echo "Penggunaan: th-agent [perintah]"
    echo ""
    echo "Perintah:"
    echo "  th-agent            Jalankan bot (default)"
    echo "  th-agent logs       Pantau log aktivitas bot secara real-time"
    echo "  th-agent status     Cek status service background 24/7"
    echo "  th-agent restart    Mulai ulang bot"
    echo "  th-agent stop       Hentikan service bot"
    echo "  th-agent start      Jalankan service bot di background"
    echo "  th-agent uninstall  Hentikan service & reset daya Mac ke default pabrik"
    ;;
  *)
    exec "$GLOBAL_DIR/th-agent-bin" "$@"
    ;;
esac
EOF
    chmod +x "$bin_link"
    ensure_local_bin_in_path

    # Hentikan sisa container Docker lama jika ada agar tidak bentrok
    if command -v docker &>/dev/null; then
        docker stop telegram-coding-agent 2>/dev/null || true
        docker rm telegram-coding-agent 2>/dev/null || true
    fi

    # 4. Daftarkan Background Service 24/7
    echo -e "\n${BLUE}⚙️  Mengonfigurasi 24/7 Background Service...${NC}"
    local web_port="$(grep -E "^WEB_PORT=" "$global_dir/.env" | cut -d '=' -f2- | tr -d ' ' || echo "3030")"
    web_port="${web_port:-3030}"

    if [ "$OS" = "Darwin" ]; then
        # macOS: LaunchAgent dengan anti-sleep caffeinate
        local plist_path="$HOME/Library/LaunchAgents/com.taufik.th-agent.plist"
        mkdir -p "$HOME/Library/LaunchAgents"

        local safe_path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"
        cat << EOF > "$plist_path"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.taufik.th-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-ims</string>
        <string>$node_bin</string>
        <string>$global_dir/th-agent-bin</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$global_dir</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>$global_dir/logs/bot.log</string>
    <key>StandardErrorPath</key>
    <string>$global_dir/logs/error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PUBLIC_DIR</key>
        <string>$global_dir/public</string>
        <key>ENV_FILE</key>
        <string>$global_dir/.env</string>
        <key>PROJECTS_DIR</key>
        <string>$workspace_dir/projects</string>
        <key>WORKSPACE_DIR</key>
        <string>$workspace_dir</string>
        <key>WEB_PORT</key>
        <string>$web_port</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>$safe_path</string>
    </dict>
</dict>
</plist>
EOF
        launchctl unload "$plist_path" 2>/dev/null || true
        launchctl load "$plist_path"
        echo -e "${GREEN}✓ macOS LaunchAgent aktif 24/7 (Anti-Sleep Caffeinate)${NC}"

        # Pemberitahuan & Konfigurasi Anti-Sleep macOS (Layar Terbuka / Mode Baterai)
        echo -e "\n${BLUE}======================================================${NC}"
        echo -e "${YELLOW}🔋 PENTING: Mode Hemat Baterai macOS (Layar Padam 5 Menit, Bot Tetap Hidup)${NC}"
        echo -e "${BLUE}======================================================${NC}"
        echo -e "Secara default, macOS akan otomatis sleep/standby jika laptop didiamkan"
        echo -e "tanpa charger, yang menyebabkan koneksi bot Telegram terputus."
        echo ""
        echo -e "Pengaturan hemat baterai optimal:"
        echo -e "• ${GREEN}Layar otomatis padam setelah 5 menit${NC} (sangat irit baterai)"
        echo -e "• ${GREEN}Sistem, Wi-Fi & Bot tetap aktif 100%${NC} selama laptop terbuka"
        echo -e "Perintah: ${CYAN}sudo pmset -b sleep 0 displaysleep 5${NC}"
        echo -e "${CYAN}Catatan:${NC} Pengaturan ini aman dan akan otomatis dikembalikan ke default saat uninstall."
        echo ""
        prompt_user "Aktifkan mode hemat baterai (layar mati 5 menit, bot tetap hidup)? (y/n, default: y): " do_anti_sleep
        do_anti_sleep="${do_anti_sleep:-y}"
        if [ "$do_anti_sleep" = "y" ] || [ "$do_anti_sleep" = "Y" ]; then
            if sudo pmset -b sleep 0 displaysleep 5 2>/dev/null; then
                echo -e "${GREEN}✓ Mode hemat baterai aktif! Layar padam setelah 5 menit tapi bot tetap hidup 24/7.${NC}"
            else
                echo -e "${YELLOW}ℹ️  Membutuhkan akses sudo. Silakan jalankan manual di Terminal:${NC}"
                echo -e "   ${CYAN}sudo pmset -b sleep 0 displaysleep 5${NC}"
            fi
        else
            echo -e "ℹ️  Dilewati. TH Agent tetap diproteksi Caffeinate (-ims) saat ada aktivitas."
        fi

    elif [ "$OS" = "Linux" ]; then
        # Linux: systemd user service
        local systemd_user_dir="$HOME/.config/systemd/user"
        mkdir -p "$systemd_user_dir"
        local service_file="$systemd_user_dir/th-agent.service"

        local safe_path="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
        local projects_target="$workspace_dir/projects"
        if [ -L "$global_dir/projects" ]; then
            projects_target="$(readlink -f "$global_dir/projects")"
        fi
        cat << EOF > "$service_file"
[Unit]
Description=TH Agent - Telegram AI Coding Agent (Standalone Binary)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node $global_dir/th-agent-bin
WorkingDirectory=$global_dir
Restart=always
RestartSec=5
StandardOutput=append:$global_dir/logs/bot.log
StandardError=append:$global_dir/logs/error.log
Environment=NODE_ENV=production
Environment=PUBLIC_DIR=$global_dir/public
Environment=ENV_FILE=$global_dir/.env
Environment=PROJECTS_DIR=$projects_target
Environment=WORKSPACE_DIR=$workspace_dir
Environment=WEB_PORT=$web_port
Environment=PATH=$safe_path

[Install]
WantedBy=default.target
EOF
        if systemctl --user daemon-reload 2>/dev/null; then
            systemctl --user enable th-agent 2>/dev/null || true
            systemctl --user restart th-agent 2>/dev/null || true
            loginctl enable-linger "$USER" 2>/dev/null || true
            echo -e "${GREEN}✓ systemd service 'th-agent' aktif 24/7 on boot${NC}"
        else
            # Fallback daemon jika systemd user tidak aktif di container/WSL
            pkill -f "th-agent-bin" 2>/dev/null || true
            nohup "$global_dir/th-agent-bin" > "$global_dir/logs/bot.log" 2> "$global_dir/logs/error.log" &
            echo -e "${GREEN}✓ Process aktif di background (PID $!)${NC}"
        fi
    fi

    local web_host display_url
    web_host="$(env_get "$global_dir/.env" "WEB_HOST")"
    web_host="${web_host:-$(default_web_host)}"
    if [ "$web_host" = "127.0.0.1" ] || [ "$web_host" = "localhost" ]; then
        display_url="http://localhost:${web_port}"
    else
        display_url="http://$(detect_server_ip):${web_port}"
    fi

    echo -e "\n${GREEN}======================================================${NC}"
    echo -e "${GREEN}🎉 SUKSES! TH Agent Terpasang & Langsung Aktif 24/7!  ${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo -e "• ${CYAN}Lingkungan:${NC}     ${YELLOW}$(target_env_label)${NC}"
    echo -e "• ${CYAN}Binary Command:${NC} ${YELLOW}th-agent${NC} (tersedia langsung di terminal)"
    echo -e "• ${CYAN}Folder Proyek:${NC}  ${YELLOW}$workspace_dir/projects${NC} (Zero node_modules!)"
    echo -e "• ${CYAN}Web Dashboard:${NC}  ${BLUE}${display_url}${NC}"
    if [ -x "$HOME/.cli-proxy-api/bin/cli-proxy-api" ]; then
        echo -e "• ${CYAN}CLIProxyAPI:${NC}    ${BLUE}http://127.0.0.1:${CLIPROXY_PORT}${NC} (lokal, kelola via Web UI)"
    fi
    echo ""
    echo -e "Perintah Cepat CLI:"
    echo -e "  • Pantau Log Live : ${BLUE}th-agent logs${NC}"
    echo -e "  • Cek Status 24/7 : ${BLUE}th-agent status${NC}"
    echo -e "  • Restart Bot     : ${BLUE}th-agent restart${NC}"
    echo -e "  • Hentikan Bot    : ${BLUE}th-agent stop${NC}"
    echo ""
    echo -e "Kirim ${GREEN}/start${NC} atau sapa ${GREEN}hallo${NC} di Telegram untuk mulai koding! 🚀"
    echo -e "${GREEN}======================================================${NC}"
}

# ==============================================================================
# DETEKSI INSTALASI EKSISTING / FAST UPDATE
# ==============================================================================
perform_fast_update() {
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${GREEN}⚡ Mode Update Cepat: Telegram AI Coding Agent         ${NC}"
    echo -e "${BLUE}======================================================${NC}"

    resolve_workspace_and_agent_dirs
    cd "$WORKSPACE_DIR"

    sync_git_repo_cleanly "$WORKSPACE_DIR"

    setup_directories
    setup_env_file
    install_cliproxy_api
    setup_binary_bundle_and_service
    exit 0
}

# ==============================================================================
# UNINSTALL TH AGENT & RESET DAYA MACOS KE DEFAULT
# ==============================================================================
perform_uninstall() {
    echo -e "\n${RED}======================================================${NC}"
    echo -e "${RED}🗑️  Uninstall TH Agent                                ${NC}"
    echo -e "${RED}======================================================${NC}"
    echo -e "Tindakan ini akan menghentikan service, menghapus runner binary, dan"
    echo -e "mengembalikan seluruh pengaturan daya/sleep ke konfigurasi awal pabrik."
    echo ""
    prompt_user "Lanjutkan uninstall TH Agent? (y/n, default: n): " confirm_uninstall
    if [ "$confirm_uninstall" != "y" ] && [ "$confirm_uninstall" != "Y" ]; then
        echo -e "Batal uninstall."
        exit 0
    fi

    echo -e "\n${CYAN}1. Menghentikan service TH Agent...${NC}"
    if [ "$OS" = "Darwin" ]; then
        local plist_path="$HOME/Library/LaunchAgents/com.taufik.th-agent.plist"
        launchctl unload "$plist_path" 2>/dev/null || true
        rm -f "$plist_path" 2>/dev/null || true
        echo -e "${GREEN}✓ LaunchAgent service berhasil dihentikan & dihapus.${NC}"

        echo -e "\n${CYAN}2. Mereset pengaturan daya/sleep macOS ke default pabrik...${NC}"
        echo -e "   Menjalankan: ${CYAN}sudo pmset restoredefaults${NC}"
        if sudo pmset restoredefaults 2>/dev/null; then
            echo -e "${GREEN}✓ Pengaturan sleep/daya macOS berhasil di-reset ke default awal pabrik!${NC}"
        else
            echo -e "${YELLOW}ℹ️  Membutuhkan password sudo untuk reset pmset. Silakan jalankan:${NC}"
            echo -e "   ${CYAN}sudo pmset restoredefaults${NC}"
        fi
    else
        systemctl --user stop th-agent 2>/dev/null || true
        systemctl --user disable th-agent 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/th-agent.service" 2>/dev/null || true
        systemctl --user daemon-reload 2>/dev/null || true
        pkill -f "th-agent-bin" 2>/dev/null || true
        echo -e "${GREEN}✓ systemd service berhasil dihentikan & dihapus.${NC}"
    fi

    echo -e "\n${CYAN}3. Menghapus CLI wrapper (th-agent)...${NC}"
    rm -f "$HOME/.local/bin/th-agent" 2>/dev/null || true
    rm -f "/usr/local/bin/th-agent" 2>/dev/null || true
    echo -e "${GREEN}✓ CLI binary 'th-agent' berhasil dibersihkan.${NC}"

    echo -e "\n${GREEN}======================================================${NC}"
    echo -e "${GREEN}✓ TH Agent berhasil di-uninstall secara bersih!       ${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo -e "Catatan: Folder proyek koding ('projects/') dan file .env tetap aman tersimpan."
    exit 0
}

# Cek apakah ini instalasi yang sudah ada sebelumnya
IS_EXISTING_INSTALL=false
if [ -d ".git" ]; then
    if [ -f "telegram-ai-agent/.env" ] || [ -f "$HOME/.th-agent/.env" ] || [ -f ".env" ]; then
        IS_EXISTING_INSTALL=true
    fi
fi

# Opsi untuk melewati pemasangan CLIProxyAPI lokal
NO_CLIPROXY=false
for arg in "$@"; do
    case "$arg" in
        --no-cliproxy|--skip-cliproxy) NO_CLIPROXY=true ;;
    esac
done

# Cek argumen CLI (misal: curl ... | bash -s -- --update / --uninstall)
if [ "$1" = "--update" ] || [ "$1" = "-u" ] || [ "$1" = "update" ]; then
    perform_fast_update
elif [ "$1" = "--uninstall" ] || [ "$1" = "uninstall" ]; then
    perform_uninstall
fi

if [ "$IS_EXISTING_INSTALL" = true ]; then
    echo -e "\n${BLUE}======================================================${NC}"
    echo -e "${GREEN}🔄 Instalasi TH Agent Terdeteksi!                     ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e "Sistem mendeteksi instalasi TH Agent yang sudah ada di direktori ini."
    echo -e "Pilih tindakan yang diinginkan:"
    echo -e "  ${CYAN}[1] ⚡ Update Cepat ke Versi Terbaru${NC} (Rekomendasi - Pertahankan semua setting & data)"
    echo -e "  ${YELLOW}[2] 🛠️  Re-konfigurasi Penuh${NC} (Setup ulang Engine, Model, dan Token dari awal)"
    echo ""
    prompt_user "Pilihan Anda [1/2, default: 1 (Update Cepat)]: " run_mode
    run_mode="${run_mode:-1}"

    if [ "$run_mode" != "2" ]; then
        perform_fast_update
    fi
fi

# ==============================================================================
# ALUR INSTALASI LENGKAP (STANDALONE BINARY RUNNER 24/7)
# ==============================================================================
echo -e "\n${CYAN}>>> Menyiapkan TH Agent (Standalone Binary Runner)...${NC}"

# 1. Pastikan Node.js terpasang (v20+)
if ! command -v node &>/dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
    echo -e "${YELLOW}Node.js v20+ belum terpasang. Memulai pemasangan Node.js...${NC}"
    if [ "$OS" = "Darwin" ]; then
        if command -v brew &>/dev/null; then
            brew install node
        else
            echo -e "${RED}Harap pasang Node.js dari https://nodejs.org terlebih dahulu.${NC}"
            exit 1
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get update -y && sudo apt-get install -y curl build-essential procps
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
    fi
fi
echo -e "${GREEN}✓ Node.js terdeteksi: $(node -v)${NC}"

# 2. Interaktif: Checklist Engine, Model, dan GitHub CLI
choose_engines
choose_models
setup_github_cli

# 3. Pasang Pi CLI
install_pi_cli

# 4. Direktori & .env
setup_directories
setup_env_file

# 5. CLIProxyAPI lokal di mesin ini (Mac lokal atau VPS)
install_cliproxy_api

# 6. Catatan konfigurasi endpoint Pi
echo -e "\n${BLUE}Pi CLI siap. Endpoint PI_SERVER_URL mengarah ke CLIProxyAPI di mesin ini (default: http://127.0.0.1:8317/v1).${NC}"

# 7. Kompilasi Standalone Binary Bundle & Jalankan Service 24/7
setup_binary_bundle_and_service
