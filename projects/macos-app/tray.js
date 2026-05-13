const { Tray, Menu, nativeImage } = require('electron')
const path = require('path')

let tray = null

function setupTray(app, getWindow, showWindow) {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  // 트레이 아이콘 크기 (macOS 메뉴바 기준 16x16 or 22x22)
  const resized = icon.isEmpty()
    ? nativeImage.createEmpty()
    : icon.resize({ width: 18, height: 18 })

  tray = new Tray(resized)
  tray.setToolTip('Agent System')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Agent System 열기',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => showWindow())
}

module.exports = { setupTray }
