#!/usr/bin/env node
// Node.js 바이너리를 assets/node/{arch}/node 에 다운로드
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const NODE_VERSION = '20.18.0'
const ASSETS_DIR = path.join(__dirname, '../assets/node')

const targets = [
  { arch: 'arm64', platform: 'darwin-arm64' },
  { arch: 'x64',   platform: 'darwin-x64'   },
]

for (const { arch, platform } of targets) {
  const outDir  = path.join(ASSETS_DIR, arch)
  const nodeBin = path.join(outDir, 'node')

  if (fs.existsSync(nodeBin)) {
    console.log(`✓ node ${arch} 이미 존재, 스킵`)
    continue
  }

  fs.mkdirSync(outDir, { recursive: true })

  const tarName = `node-v${NODE_VERSION}-${platform}.tar.gz`
  const url     = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}`
  const tarPath = path.join(os.tmpdir(), tarName)

  console.log(`⬇  node ${arch} 다운로드 중... (${url})`)
  execSync(`curl -L --progress-bar -o "${tarPath}" "${url}"`, { stdio: 'inherit' })

  console.log(`📦 압축 해제 중...`)
  const extractDir = path.join(os.tmpdir(), `node-extract-${arch}`)
  fs.mkdirSync(extractDir, { recursive: true })
  execSync(`tar -xzf "${tarPath}" -C "${extractDir}" --strip-components=2 "node-v${NODE_VERSION}-${platform}/bin/node"`)
  execSync(`mv "${path.join(extractDir, 'node')}" "${nodeBin}"`)
  execSync(`chmod +x "${nodeBin}"`)

  console.log(`✓ node ${arch} 완료 → ${nodeBin}`)
}

console.log('\n✅ Node.js 바이너리 준비 완료')
