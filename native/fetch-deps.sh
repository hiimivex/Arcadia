#!/usr/bin/env bash
# Dépendances du moteur Arcadia et du compagnon (versions utilisées pour les builds officiels)
set -e
cd "$(dirname "$0")"
mkdir -p deps && cd deps
[ -d SDL3 ]  || git clone --depth 1 --branch release-3.2.26 https://github.com/libsdl-org/SDL.git SDL3
[ -d imgui ] || git clone --depth 1 --branch v1.92.5 https://github.com/ocornut/imgui.git imgui
[ -d stb ]   || { git clone https://github.com/nothings/stb.git stb && git -C stb checkout 6b5799b; }
echo "Dépendances prêtes dans native/deps"
