; ReqMock 自定义 NSIS 安装脚本（electron-builder 自动加载 build/installer.nsh）
; 功能：安装启动时检测本机是否已安装旧版本，若已安装则提示用户并先静默卸载旧版本，再继续安装。

!macro customInit
  Var /GLOBAL oldUninstaller
  Var /GLOBAL oldInstallDir

  ; x64 应用的卸载信息写在 64 位注册表视图下
  SetRegView 64

  ; 先查“仅当前用户”安装记录（HKCU），再查“所有用户”安装记录（HKLM）
  ReadRegStr $oldUninstaller HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $oldInstallDir HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $oldUninstaller "" _checkPerMachine _foundOld

  _checkPerMachine:
    ReadRegStr $oldUninstaller HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $oldInstallDir HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
    StrCmp $oldUninstaller "" _initDone _foundOld

  _foundOld:
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
      "检测到本机已安装 ReqMock，将先卸载已安装的版本，然后继续安装。$\r$\n$\r$\n点击“确定”卸载旧版本并继续，点击“取消”退出安装。" \
      IDOK _doUninstall
    Quit

  _doUninstall:
    StrCmp $oldInstallDir "" _uninstallNoWait
    ; /S 静默卸载；_?= 指定原安装目录并让卸载程序同步执行，确保 ExecWait 等待卸载完成
    ExecWait '"$oldInstallDir\${UNINSTALL_FILENAME}" /S _?=$oldInstallDir'
    ; _?= 模式下卸载程序无法自删，手动清理残留的卸载器及空目录
    Delete "$oldInstallDir\${UNINSTALL_FILENAME}"
    RMDir "$oldInstallDir"
    Goto _initDone

  _uninstallNoWait:
    ; 注册表中无安装目录记录时，直接按卸载命令执行（无法同步等待，稍作延时兜底）
    ExecWait '$oldUninstaller /S'
    Sleep 2000

  _initDone:
!macroend
