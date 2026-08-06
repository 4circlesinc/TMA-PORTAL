; Windows installer customisations.
;
; electron-builder picks this file up automatically because it sits at
; <buildResources>/installer.nsh, and buildResources defaults to "build". There
; is no reference to it in package.json, which is why this note is here. It is
; inserted into the customFinishPage slot of assistedInstaller.nsh; the way to
; check that is still true after an electron-builder upgrade is to put an
; !error in the macro and confirm the build stops.
;
; The only change is the finish page: it asks to be pinned to the taskbar.
; Windows will not let an application pin itself - the shell verb has been
; blocked since Windows 10, and the API that replaced it is for packaged apps
; only - so asking is the whole of what can be done. taskbar-pin.js explains
; that in full, and repeats the ask inside the app, where the taskbar button
; being described is on screen.
;
; The macro is only inserted for the assisted installer, which is what
; oneClick: false selects. A silent install (/S) draws no pages at all, so the
; update path - which runs the installer with /S --force-run - never sees this.
;
; Deliberately ASCII, all of it. NSIS reads a file with no byte-order mark as
; ANSI, so a curly quote or a dash typed here reaches the installer as mojibake
; on the one page every new user is guaranteed to read.

!macro customFinishPage

  ; MUI's own copy is a single line about the install having finished. The page
  ; is already on screen and already says that, so the space goes to the one
  ; thing the user has to do by hand.
  !ifdef MUI_FINISHPAGE_TEXT
    !undef MUI_FINISHPAGE_TEXT
  !endif
  !define MUI_FINISHPAGE_TEXT "TM ANTOINE Portal is installed.$\r$\n$\r$\nTo keep it one click away, right-click its icon on the taskbar and choose $\"Pin to taskbar$\". Windows only allows this from the taskbar itself, so the installer cannot do it for you.$\r$\n$\r$\nThe app will remind you once when it opens."

  ; Lifted from the default page this replaces (assistedInstaller.nsh), so the
  ; "Run the app now" checkbox keeps working exactly as it did - including the
  ; --updated flag, which is what tells the app an update relaunched it rather
  ; than a person installing it for the first time.
  Function StartAppAfterFinish
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartAppAfterFinish"

  !insertmacro MUI_PAGE_FINISH

!macroend
