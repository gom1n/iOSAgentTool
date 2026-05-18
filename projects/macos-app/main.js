const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const { setupTray } = require('./tray')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// 앱 루트 경로 (패키징 여부에 따라 다름)
const ROOT = isDev
  ? path.join(__dirname, '..', '..')
  : path.join(process.resourcesPath)

let mainWindow = null
const childProcesses = []

// 패키징된 앱에서는 번들된 Node 바이너리 사용, 개발 시에는 시스템 node 사용
function getNodeBin() {
  if (isDev) return 'node'
  return path.join(process.resourcesPath, 'node', process.arch, 'node')
}

function spawnLaunchers() {
  const nodeBin     = getNodeBin()
  const launcherDir = path.join(ROOT, 'launcher')

  const serverProc = spawn(nodeBin, [path.join(launcherDir, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'inherit',
  })
  childProcesses.push(serverProc)

  const watcherProc = spawn(nodeBin, [path.join(launcherDir, 'ios-watcher.js')], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'inherit',
  })
  childProcesses.push(watcherProc)

  serverProc.on('error', (e) => console.error('[server]', e.message))
  watcherProc.on('error', (e) => console.error('[watcher]', e.message))
}

function killLaunchers() {
  for (const proc of childProcesses) {
    try { proc.kill('SIGTERM') } catch {}
  }
  childProcesses.length = 0
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(process.resourcesPath, 'web', 'index.html'))
  }

  // 외부 링크는 브라우저에서 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  spawnLaunchers()
  createWindow()
  setupTray(app, mainWindow, () => {
    if (!mainWindow) createWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  // macOS: 창 닫아도 앱(트레이)은 유지
  // 완전 종료는 트레이 메뉴 "Quit"으로
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', () => {
  killLaunchers()
})
