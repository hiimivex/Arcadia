// Hôte libretro : chargement d'un cœur (DLL/.so) et implémentation des callbacks.
#pragma once
#include "libretro.h"
#include "util.h"
#include <string>
#include <vector>
#include <map>
#include <functional>

struct CoreOption {
  std::string key, desc, info, def, value;
  std::vector<std::pair<std::string, std::string>> values; // valeur, libellé
  bool visible = true;
};

struct Core {
  SDL_SharedObject* lib = nullptr;
  // Fonctions du cœur
  void (*init)() = nullptr; void (*deinit)() = nullptr;
  unsigned (*api_version)() = nullptr;
  void (*get_system_info)(retro_system_info*) = nullptr;
  void (*get_system_av_info)(retro_system_av_info*) = nullptr;
  void (*set_environment)(retro_environment_t) = nullptr;
  void (*set_video_refresh)(retro_video_refresh_t) = nullptr;
  void (*set_audio_sample)(retro_audio_sample_t) = nullptr;
  void (*set_audio_sample_batch)(retro_audio_sample_batch_t) = nullptr;
  void (*set_input_poll)(retro_input_poll_t) = nullptr;
  void (*set_input_state)(retro_input_state_t) = nullptr;
  void (*set_controller_port_device)(unsigned, unsigned) = nullptr;
  void (*reset)() = nullptr; void (*run)() = nullptr;
  size_t (*serialize_size)() = nullptr;
  bool (*serialize)(void*, size_t) = nullptr;
  bool (*unserialize)(const void*, size_t) = nullptr;
  bool (*load_game)(const retro_game_info*) = nullptr;
  void (*unload_game)() = nullptr;
  void (*cheat_reset)() = nullptr;
  void (*cheat_set)(unsigned, bool, const char*) = nullptr;

  retro_system_info info{};
  retro_system_av_info av{};
  retro_hw_render_callback hw{};
  bool hwRender = false;
  retro_pixel_format pixfmt = RETRO_PIXEL_FORMAT_0RGB1555;
  std::vector<CoreOption> options;
  bool optionsDirty = false;
  std::string systemDir, saveDir;
  bool gameLoaded = false;
  std::vector<uint8_t> romData;

  bool open(const std::string& path, std::string& err);
  CoreOption* findOption(const std::string& key);
  void setOption(const std::string& key, const std::string& value);
  bool saveState(std::vector<uint8_t>& out);
  bool loadState(const std::vector<uint8_t>& in);
  void close();
};

extern Core g_core;
