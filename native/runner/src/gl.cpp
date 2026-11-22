#include "gl.h"
#define GLDEF(ret, name, args) PFN_xgl##name xgl##name = nullptr;
GLFUNCS(GLDEF)
#undef GLDEF
bool glLoad() {
  bool ok = true;
#define GLLOAD(ret, name, args) xgl##name = (PFN_xgl##name)SDL_GL_GetProcAddress("gl" #name); if (!xgl##name) { SDL_Log("GL manquant: gl%s", #name); ok = false; }
  GLFUNCS(GLLOAD)
#undef GLLOAD
  return ok;
}
