#!/usr/bin/env bash
# IMMORTAIL™ — Ollama installer + model puller
# Run: bash install-ollama.sh
# Works on Mac (Intel + Apple Silicon) and Linux

set -e
BOLD="\033[1m"; GOLD="\033[38;5;220m"; GREEN="\033[32m"; RED="\033[31m"; RESET="\033[0m"
DEFAULT_MODEL="${1:-llama3}"

echo -e "\n${GOLD}${BOLD}IMMORTAIL™ — Local AI Setup${RESET}\n"

# ── 1. Detect OS ────────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
echo -e "  System: ${OS} / ${ARCH}"

# ── 2. Install Ollama ────────────────────────────────────────────────────────
if command -v ollama &>/dev/null; then
  echo -e "  ${GREEN}✓ Ollama already installed${RESET} ($(ollama --version 2>&1 | head -1))"
else
  echo -e "\n${BOLD}Installing Ollama…${RESET}"
  if [[ "$OS" == "Darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install ollama
    else
      echo -e "  Downloading Ollama for Mac…"
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  elif [[ "$OS" == "Linux" ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  else
    echo -e "  ${RED}Windows: Download from https://ollama.com and run the installer.${RESET}"
    echo -e "  Then re-run this script in Git Bash or WSL."
    exit 1
  fi
  echo -e "  ${GREEN}✓ Ollama installed${RESET}"
fi

# ── 3. Start Ollama server ───────────────────────────────────────────────────
echo -e "\n${BOLD}Starting Ollama server…${RESET}"
if pgrep -x ollama &>/dev/null; then
  echo -e "  ${GREEN}✓ Ollama already running${RESET}"
else
  ollama serve &>/dev/null &
  OLLAMA_PID=$!
  sleep 2
  echo -e "  ${GREEN}✓ Ollama started (PID $OLLAMA_PID)${RESET}"
fi

# ── 4. Pull model ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Pulling model: ${DEFAULT_MODEL}…${RESET}"
if ollama list 2>/dev/null | grep -q "^${DEFAULT_MODEL}"; then
  echo -e "  ${GREEN}✓ ${DEFAULT_MODEL} already downloaded${RESET}"
else
  ollama pull "${DEFAULT_MODEL}"
  echo -e "  ${GREEN}✓ ${DEFAULT_MODEL} downloaded${RESET}"
fi

# ── 5. Test it ───────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Testing ${DEFAULT_MODEL}…${RESET}"
REPLY=$(ollama run "${DEFAULT_MODEL}" "Say 'woof' in 3 words or less." 2>/dev/null | head -1)
echo -e "  Response: ${GREEN}${REPLY}${RESET}"

# ── 6. Done ──────────────────────────────────────────────────────────────────
echo -e "\n${GOLD}${BOLD}✓ All done!${RESET}"
echo -e "  Ollama is running at ${BOLD}http://localhost:11434${RESET}"
echo -e "  Model ready: ${BOLD}${DEFAULT_MODEL}${RESET}"
echo -e "\n  Open IMMORTAIL™ → Settings → the Ollama tab will auto-connect.\n"

# Optional: also pull a couple extras
if [[ "${PULL_EXTRAS:-0}" == "1" ]]; then
  echo -e "\nPulling extra models (this may take a while)…"
  ollama pull mistral
  ollama pull phi3
  echo -e "${GREEN}✓ Extra models ready${RESET}"
fi
