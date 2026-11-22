#!/usr/bin/env bash
# Compile arcadia-runner.exe et arcadia-helper.exe pour Windows depuis Linux (MinGW-w64, threads POSIX)
set -e
cd "$(dirname "$0")"
./fetch-deps.sh
cmake -S runner -B runner/build-win -G Ninja -DCMAKE_TOOLCHAIN_FILE="$PWD/runner/mingw.cmake" -DCMAKE_BUILD_TYPE=Release
ninja -C runner/build-win arcadia-runner
x86_64-w64-mingw32-strip -o ../runner/arcadia-runner.exe runner/build-win/arcadia-runner.exe
SDLB=runner/build-win/sdl
x86_64-w64-mingw32-g++-posix -O2 -s -static -std=c++17 -Ideps/SDL3/include -I$SDLB/include -I$SDLB/include-revision \
  helper/helper.cpp -o ../runner/arcadia-helper.exe $SDLB/libSDL3.a \
  -lole32 -loleaut32 -lshell32 -lpropsys -luser32 -lgdi32 -lwinmm -limm32 -lversion -lsetupapi -lcfgmgr32 -luuid -lws2_32 -ladvapi32
echo "OK : runner/arcadia-runner.exe et runner/arcadia-helper.exe"
