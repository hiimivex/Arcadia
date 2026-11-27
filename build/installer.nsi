; Installateur Arcadia (compilé avec makensis, sans Wine)
;   <dossier Arcadia>/app : l'application (seule chose supprimée à la désinstallation)
;   <dossier Arcadia>/Jeux, /Émulateurs, /Sauvegardes : jamais supprimés
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "uninst_files.nsh"

!define APP "Arcadia"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef SRC
  !define SRC "..\dist\win-unpacked"
!endif
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Arcadia"

Name "${APP}"
OutFile "..\dist\Arcadia-Setup-${VERSION}.exe"
InstallDir "$PROFILE\Arcadia"
InstallDirRegKey HKCU "Software\Arcadia" "RootDir"
RequestExecutionLevel user
BrandingText "Arcadia ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Arcadia"
VIAddVersionKey "FileDescription" "Installation d'Arcadia"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "GPL-3.0"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installation d'Arcadia"
!define MUI_WELCOMEPAGE_TEXT "Arcadia est ta bibliothèque de jeux façon Steam : tes ROM avec leurs jaquettes, tes catégories, ton temps de jeu, et le bon émulateur lancé en un clic.$\r$\n$\r$\nAucun droit administrateur n'est nécessaire."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choisis le dossier Arcadia. Il contiendra : app (l'application), Jeux (tes ROM rangées par console), Émulateurs et Sauvegardes.$\r$\n$\r$\nÀ la désinstallation, seule l'application est supprimée : tes jeux, émulateurs et sauvegardes restent (ou sont déplacés où tu veux)."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Dossier Arcadia"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\Arcadia.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer Arcadia"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Function .onInit
  ; dossier proposé : D:\Arcadia si le disque D: existe (sauf réglage précédent)
  ReadRegStr $0 HKCU "Software\Arcadia" "RootDir"
  ${If} $0 == ""
  ${AndIf} ${FileExists} "D:\*.*"
    StrCpy $INSTDIR "D:\Arcadia"
  ${EndIf}
FunctionEnd

Section "Arcadia" SecMain
  nsExec::Exec 'taskkill /IM Arcadia.exe /F'
  Sleep 800
  ; ancienne installation (application posée directement dans un dossier) : on retire SEULEMENT ses fichiers
  ReadRegStr $1 HKCU "Software\Arcadia" "InstallDir"
  ${If} $1 != ""
  ${AndIf} $1 != "$INSTDIR\app"
  ${AndIf} ${FileExists} "$1\Arcadia.exe"
    !insertmacro RemoveAppFiles "$1"
  ${EndIf}
  SetOutPath "$INSTDIR\app"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\app\Désinstaller Arcadia.exe"
  CreateDirectory "$INSTDIR\Jeux"
  CreateDirectory "$INSTDIR\Émulateurs"
  CreateDirectory "$INSTDIR\Sauvegardes"
  CreateDirectory "$SMPROGRAMS\Arcadia"
  CreateShortcut "$SMPROGRAMS\Arcadia\Arcadia.lnk" "$INSTDIR\app\Arcadia.exe"
  CreateShortcut "$SMPROGRAMS\Arcadia\Désinstaller Arcadia.lnk" "$INSTDIR\app\Désinstaller Arcadia.exe"
  CreateShortcut "$DESKTOP\Arcadia.lnk" "$INSTDIR\app\Arcadia.exe"
  WriteRegStr HKCU "Software\Arcadia" "RootDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Arcadia" "InstallDir" "$INSTDIR\app"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Arcadia"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Ivex"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\app\Arcadia.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\app\Désinstaller Arcadia.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 260000
  ; mise à jour silencieuse lancée par Arcadia : on relance l'application
  IfSilent 0 +2
    Exec '"$INSTDIR\app\Arcadia.exe"'
SectionEnd

; ------------------------------------------------------------------ désinstallation
Var ROOTDIR
Var DEST
Var COPIED

!macro KeepFolder NAME
  ${If} ${FileExists} "$ROOTDIR\${NAME}\*.*"
    ClearErrors
    Rename "$ROOTDIR\${NAME}" "$DEST\${NAME}"
    ${If} ${Errors}
      ; autre disque (ou dossier déjà présent) : on COPIE, l'original reste en place
      CreateDirectory "$DEST\${NAME}"
      CopyFiles /SILENT "$ROOTDIR\${NAME}\*.*" "$DEST\${NAME}"
      StrCpy $COPIED "1"
    ${EndIf}
  ${EndIf}
!macroend

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Arcadia.exe /F'
  Sleep 800
  ${GetParent} "$INSTDIR" $ROOTDIR
  StrCpy $COPIED "0"
  IfSilent remove
  MessageBox MB_YESNO|MB_ICONQUESTION "Tes jeux, émulateurs et sauvegardes ne seront JAMAIS supprimés.$\r$\n$\r$\nVeux-tu les déplacer dans un autre dossier avant la désinstallation ?$\r$\n$\r$\n• Oui : tu choisis le dossier, ils y sont déplacés.$\r$\n• Non : ils restent dans $ROOTDIR" IDNO remove
  nsDialogs::SelectFolderDialog "Où déplacer Jeux, Émulateurs et Sauvegardes ?" "$ROOTDIR"
  Pop $DEST
  ${If} $DEST == "error"
  ${OrIf} $DEST == ""
    Goto remove
  ${EndIf}
  !insertmacro KeepFolder "Jeux"
  !insertmacro KeepFolder "Émulateurs"
  !insertmacro KeepFolder "Sauvegardes"
  ${If} $COPIED == "1"
    MessageBox MB_OK|MB_ICONINFORMATION "Le dossier choisi est sur un autre disque : tes jeux, émulateurs et sauvegardes y ont été COPIÉS.$\r$\nLes originaux sont restés dans $ROOTDIR (supprime-les toi-même quand tu as vérifié la copie)."
  ${EndIf}
remove:
  ; Supprime UNIQUEMENT les fichiers de l'application (liste générée au build)
  !insertmacro RemoveAppFiles "$INSTDIR"
  RMDir "$ROOTDIR" ; seulement s'il est vide
  Delete "$DESKTOP\Arcadia.lnk"
  RMDir /r "$SMPROGRAMS\Arcadia"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Arcadia"
SectionEnd
