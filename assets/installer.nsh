!macro customHeader
  !system "echo Building Bytecra POS Installer"
!macroend

!macro customInit
  ; Require Windows 10+ (NT 10.0)
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Bytecra POS requires Windows 10 or later."
    Abort
  ${EndIf}
!macroend

!macro customInstall
  CreateDirectory "$APPDATA\BytecraPOS"
  CreateDirectory "$APPDATA\BytecraPOS\backups"
  CreateDirectory "$APPDATA\BytecraPOS\uploads"
  CreateDirectory "$APPDATA\BytecraPOS\logs"

  FileOpen $0 "$APPDATA\BytecraPOS\version.txt" w
  FileWrite $0 "${VERSION}"
  FileClose $0
!macroend

!macro customUnInstall
  MessageBox MB_YESNO "Remove all store data and backups from this PC?" IDYES removeData IDNO skipData
  removeData:
    RMDir /r "$APPDATA\BytecraPOS"
  skipData:
!macroend
