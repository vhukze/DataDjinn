!include LogicLib.nsh
!include nsProcess.nsh

; electron-builder's default close path can leave child processes behind. End the
; application tree first so a guided reinstall does not require manual cleanup.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint "$(appClosing)"
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    Sleep 800
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      Sleep 1200
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${EndIf}
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY retry
      Quit
      retry:
      nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $R0
      Sleep 1000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 == 0
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
