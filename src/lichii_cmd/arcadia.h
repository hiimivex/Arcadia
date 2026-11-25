// SPDX-License-Identifier: GPL-3.0-or-later
// Arcadia : moteur Switch intégré. Les manettes et le clavier sont lus ici (correspondances d'Arcadia)
// et fusionnés en une seule manette virtuelle pour le joueur 1 ; les vibrations repartent vers la vraie manette.
#pragma once

#include <string>
#include <SDL3/SDL.h>

namespace InputCommon {
class InputSubsystem;
}

namespace Arcadia {

/// Rapport de plantage (Windows) : code, module, adresses → <dossier de données>/log/arcadia-crash.txt
void InstallCrashHandler();

/// Arcadia pilote ce moteur (variable ARCADIA=1 posée par le lanceur)
bool Enabled();

/// Titre de la fenêtre voulu par Arcadia (vide sinon)
std::string WindowTitle();

/// Après la création de la fenêtre et du système d'entrées
void Init(InputCommon::InputSubsystem* input, SDL_Window* window);

/// Événements SDL (branchement / débranchement des manettes)
void OnEvent(const SDL_Event& event);

/// Appelé à chaque tour de boucle : lit manette + clavier et alimente la manette virtuelle
void Poll();

/// Message au lanceur Arcadia (une ligne JSON sur la sortie standard)
void Emit(const std::string& json);
// Images/s, vitesse (%), temps par image (ms) : écrits dans ARCADIA_STATS pour le compteur d'Arcadia
void ReportStats(double fps, double speed, double frametime_ms);

void Shutdown();

} // namespace Arcadia
