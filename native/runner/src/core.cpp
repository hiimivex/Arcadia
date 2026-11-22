#include "core.h"

Core g_core;

template <typename T> static bool sym(SDL_SharedObject* lib, T& fn, const char* name) {
  fn = (T)SDL_LoadFunction(lib, name);
  return fn != nullptr;
}

bool Core::open(const std::string& path, std::string& err) {
  lib = SDL_LoadObject(path.c_str());
  if (!lib) { err = std::string("Impossible de charger le cœur : ") + SDL_GetError(); return false; }
  bool ok = sym(lib, init, "retro_init") && sym(lib, deinit, "retro_deinit") && sym(lib, api_version, "retro_api_version")
    && sym(lib, get_system_info, "retro_get_system_info") && sym(lib, get_system_av_info, "retro_get_system_av_info")
    && sym(lib, set_environment, "retro_set_environment") && sym(lib, set_video_refresh, "retro_set_video_refresh")
    && sym(lib, set_audio_sample, "retro_set_audio_sample") && sym(lib, set_audio_sample_batch, "retro_set_audio_sample_batch")
    && sym(lib, set_input_poll, "retro_set_input_poll") && sym(lib, set_input_state, "retro_set_input_state")
    && sym(lib, set_controller_port_device, "retro_set_controller_port_device")
    && sym(lib, reset, "retro_reset") && sym(lib, run, "retro_run")
    && sym(lib, serialize_size, "retro_serialize_size") && sym(lib, serialize, "retro_serialize") && sym(lib, unserialize, "retro_unserialize")
    && sym(lib, load_game, "retro_load_game") && sym(lib, unload_game, "retro_unload_game");
  if (!ok) { err = "Ce fichier n'est pas un cœur libretro valide."; return false; }
  if (api_version() != RETRO_API_VERSION) { err = "Version d'API libretro incompatible."; return false; }
  get_system_info(&info);
  return true;
}

CoreOption* Core::findOption(const std::string& key) {
  for (auto& o : options) if (o.key == key) return &o;
  return nullptr;
}

void Core::setOption(const std::string& key, const std::string& value) {
  if (auto* o = findOption(key)) {
    for (auto& v : o->values) if (v.first == value) { if (o->value != value) { o->value = value; optionsDirty = true; } return; }
  }
}

bool Core::saveState(std::vector<uint8_t>& out) {
  size_t n = serialize_size();
  if (!n) return false;
  out.resize(n);
  return serialize(out.data(), n);
}

bool Core::loadState(const std::vector<uint8_t>& in) {
  return !in.empty() && unserialize(in.data(), in.size());
}

void Core::close() {
  if (!lib) return;
  if (gameLoaded) { unload_game(); gameLoaded = false; }
  deinit();
  SDL_UnloadObject(lib); lib = nullptr;
}
