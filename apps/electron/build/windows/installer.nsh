!include nsDialogs.nsh
!include FileFunc.nsh
!include MUI2.nsh

!ifndef BUILD_UNINSTALLER
Var RoxDependencyMode
Var RoxLinuxSupport
Var RoxModeControl
Var RoxWslControl
Var RoxGitBash
Var RoxGitBashControl
Var RoxBootstrapExit

; NSIS runs before the app/i18next exists. Use installer language resources here.
; The include is evaluated before electron-builder's addLangs macro, so use LCIDs.
LangString RoxDependencies 1033 "Command-line dependencies"
LangString RoxDependencies 1049 "Зависимости командной строки"
LangString RoxDependencyHelp 1033 "Native Windows: GitHub CLI, Git, Node.js, jq and yq. Dependencies are private to Rox; no global PATH changes."
LangString RoxDependencyHelp 1049 "Windows: GitHub CLI, Git, Node.js, jq и yq. Зависимости устанавливаются только для Rox; системный PATH не меняется."
LangString RoxAuto 1033 "auto - use working system tools, bundle missing tools"
LangString RoxAuto 1049 "auto - системные утилиты, встроенные при отсутствии"
LangString RoxBundled 1033 "bundled - use pinned Rox dependencies"
LangString RoxBundled 1049 "bundled - использовать закреплённые версии Rox"
LangString RoxSystem 1033 "system - use system tools only"
LangString RoxSystem 1049 "system - только системные утилиты"
LangString RoxGitBashLabel 1033 "Install private native Git Bash (full PortableGit; optional)"
LangString RoxGitBashLabel 1049 "Установить нативный Git Bash для Rox (PortableGit; необязательно)"
LangString RoxWsl 1033 "Install optional WSL 2 + Ubuntu for Linux-only helpers"
LangString RoxWsl 1049 "Установить WSL 2 + Ubuntu для Linux-утилит (необязательно)"
LangString RoxWslHelp 1033 "Not required for native runtime. Windows may request administrator permission and a restart. Setup never restarts your PC. After restarting, rerun bootstrap.ps1 -InstallLinuxSupport, then open Ubuntu to finish user setup. Git Bash is separate from WSL."
LangString RoxWslHelp 1049 "Не требуется для нативного рантайма. Windows может запросить права администратора и перезагрузку. Установщик не перезагружает ПК. Затем повторите bootstrap.ps1 -InstallLinuxSupport и откройте Ubuntu для создания пользователя. Git Bash устанавливается отдельно."
LangString RoxReboot 1033 "Rox native dependencies are installed. WSL needs a restart. Restart when convenient, then rerun the Linux bootstrap."
LangString RoxReboot 1049 "Нативные зависимости Rox установлены. Для WSL требуется перезагрузка. Перезагрузите ПК позже и повторите установку Linux-поддержки."
LangString RoxBootstrapFailure 1033 "Dependency bootstrap needs attention (exit $RoxBootstrapExit). See %LOCALAPPDATA%\Rox\bootstrap\status.json and rerun resources\windows-bootstrap\bootstrap.ps1. Rox is installed; Linux helpers may remain unavailable."
LangString RoxBootstrapFailure 1049 "Проверьте зависимости (код $RoxBootstrapExit): %LOCALAPPDATA%\Rox\bootstrap\status.json. Повторите resources\windows-bootstrap\bootstrap.ps1. Rox установлен; Linux-утилиты могут быть недоступны."

!macro customInit
  ; Native app/payload installation always belongs to the invoking user.
  StrCpy $hasPerMachineInstallation "0"
  !insertmacro setInstallModePerUser
  ${If} ${isForAllUsers}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadRegStr $RoxDependencyMode HKCU "Software\Rox\Installer" "DependencyMode"
  ${If} $RoxDependencyMode != "auto"
  ${AndIf} $RoxDependencyMode != "bundled"
  ${AndIf} $RoxDependencyMode != "system"
    StrCpy $RoxDependencyMode "auto"
  ${EndIf}
  ; Never replay elevation on an update. WSL requires a fresh selection or /WSL.
  StrCpy $RoxLinuxSupport ${BST_UNCHECKED}
  StrCpy $RoxGitBash ${BST_UNCHECKED}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/DEPENDENCIES=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == "auto"
    ${OrIf} $R1 == "bundled"
    ${OrIf} $R1 == "system"
      StrCpy $RoxDependencyMode $R1
    ${Else}
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/WSL" $R1
  ${IfNot} ${Errors}
    StrCpy $RoxLinuxSupport ${BST_CHECKED}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/GITBASH" $R1
  ${IfNot} ${Errors}
    StrCpy $RoxGitBash ${BST_CHECKED}
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  ; Function bodies must be emitted after builder's plugin-directory header.
  ; Defining them at include time resolves StdUtils before !addplugindir runs.
  Page custom RoxDependencyPage RoxDependencyPageLeave

Function RoxDependencyPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(RoxDependencies)" "Rox"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 32u "$(RoxDependencyHelp)"
  Pop $0
  ${NSD_CreateDropList} 0 38u 100% 70u ""
  Pop $RoxModeControl
  ${NSD_CB_AddString} $RoxModeControl "$(RoxAuto)"
  ${NSD_CB_AddString} $RoxModeControl "$(RoxBundled)"
  ${NSD_CB_AddString} $RoxModeControl "$(RoxSystem)"
  ${If} $RoxDependencyMode == "bundled"
    ${NSD_CB_SelectString} $RoxModeControl "$(RoxBundled)"
  ${ElseIf} $RoxDependencyMode == "system"
    ${NSD_CB_SelectString} $RoxModeControl "$(RoxSystem)"
  ${Else}
    ${NSD_CB_SelectString} $RoxModeControl "$(RoxAuto)"
  ${EndIf}
  ${NSD_CreateCheckbox} 0 65u 100% 20u "$(RoxGitBashLabel)"
  Pop $RoxGitBashControl
  ${NSD_SetState} $RoxGitBashControl $RoxGitBash
  ${NSD_CreateCheckbox} 0 88u 100% 20u "$(RoxWsl)"
  Pop $RoxWslControl
  ${NSD_SetState} $RoxWslControl $RoxLinuxSupport
  ${NSD_CreateLabel} 0 112u 100% 53u "$(RoxWslHelp)"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function RoxDependencyPageLeave
  ${NSD_GetText} $RoxModeControl $0
  ${If} $0 == "$(RoxBundled)"
    StrCpy $RoxDependencyMode "bundled"
  ${ElseIf} $0 == "$(RoxSystem)"
    StrCpy $RoxDependencyMode "system"
  ${Else}
    StrCpy $RoxDependencyMode "auto"
  ${EndIf}
  ${NSD_GetState} $RoxWslControl $RoxLinuxSupport
  ${NSD_GetState} $RoxGitBashControl $RoxGitBash
FunctionEnd
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Rox\Installer" "DependencyMode" $RoxDependencyMode
  StrCpy $R0 ""
  ${If} $RoxLinuxSupport == ${BST_CHECKED}
    StrCpy $R0 "-InstallLinuxSupport"
  ${EndIf}
  ${If} $RoxGitBash == ${BST_CHECKED}
    StrCpy $R0 "$R0 -InstallGitBash"
  ${EndIf}
  ; NSIS is 32-bit; Sysnative avoids filesystem redirection to 32-bit PowerShell.
  StrCpy $R1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  nsExec::ExecToLog '"$R1" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-bootstrap\bootstrap.ps1" -ResourcesRoot "$INSTDIR\resources" -Mode $RoxDependencyMode $R0'
  Pop $RoxBootstrapExit
  ${If} $RoxBootstrapExit == 3010
    SetErrorLevel 3010
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONINFORMATION "$(RoxReboot)"
    ${EndIf}
  ${ElseIf} $RoxBootstrapExit != 0
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(RoxBootstrapFailure)"
    ${EndIf}
  ${EndIf}
!macroend
!endif
