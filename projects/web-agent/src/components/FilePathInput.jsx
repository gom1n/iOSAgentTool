import { useState, useRef, useEffect, useCallback } from 'react'
import { MdInsertDriveFile } from 'react-icons/md'
import './FilePathInput.css'

async function collectPaths(dirHandle, basePath = '', depth = 0, maxDepth = 8) {
  const paths = []
  if (depth > maxDepth) return paths
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue
      const fullPath = basePath ? `${basePath}/${name}` : name
      if (handle.kind === 'directory') {
        const sub = await collectPaths(handle, fullPath, depth + 1, maxDepth)
        paths.push(...sub)
      } else {
        paths.push(fullPath)
      }
    }
  } catch (e) { /* permission denied 무시 */ }
  return paths
}

const CACHE_KEY = 'acc_fspath_cache'

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}
function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch {}
}

function fuzzyMatch(str, query) {
  if (!query) return false
  const s = str.toLowerCase()
  const q = query.toLowerCase()
  if (s.includes(q)) return true
  return s.split('/').pop()?.includes(q.split('/').pop()) ?? false
}

function scoreMatch(str, query) {
  const s = str.toLowerCase()
  const q = query.toLowerCase()
  if (s === q) return 100
  if (s.endsWith('/' + q)) return 80
  if (s.includes('/' + q)) return 70
  if (s.includes(q)) return 50
  return 0
}

export default function FilePathInput({ value, onChange, placeholder, label, projectPath }) {
  const [suggestions, setSuggestions] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [indexedRoots, setIndexedRoots] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const cacheRef = useRef(loadCache())

  // 프로젝트 경로에서 기대하는 루트 폴더명 추출 (예: my-ios-project)
  const expectedRoot = projectPath ? projectPath.split('/').filter(Boolean).pop() : null

  useEffect(() => {
    const roots = Object.keys(cacheRef.current)
    if (roots.length) setIndexedRoots(roots)
  }, [])

  const allPaths = useCallback(() => {
    return Object.entries(cacheRef.current).flatMap(([root, files]) =>
      files.map(f => `/${root}/${f}`)
    )
  }, [])

  const handleClearCache = () => {
    cacheRef.current = {}
    saveCache({})
    setIndexedRoots([])
  }

  const handlePickFile = async () => {
    if (!('showDirectoryPicker' in window) || !('showOpenFilePicker' in window)) {
      alert('Chrome / Edge에서만 지원됩니다.')
      return
    }
    setErrorMsg('')
    try {
      setLoading(true)

      // 1단계: 프로젝트 루트 폴더 선택 & 인덱싱
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      const rootName = dirHandle.name

      // 선택한 폴더가 프로젝트 루트와 다르면 경고
      if (expectedRoot && rootName !== expectedRoot) {
        setLoading(false)
        setErrorMsg(`"${rootName}"이 아닌 "${expectedRoot}" 폴더를 선택해주세요.`)
        return
      }

      const files = await collectPaths(dirHandle, '')
      const cache = cacheRef.current
      cache[rootName] = files
      cacheRef.current = cache
      saveCache(cache)
      setIndexedRoots(Object.keys(cache))
      setLoading(false)

      // 2단계: 파일 선택
      const [fileHandle] = await window.showOpenFilePicker({ multiple: false })

      // dirHandle.resolve()로 dirHandle 기준 정확한 상대 경로 획득
      const parts = await dirHandle.resolve(fileHandle)
      if (parts && parts.length > 0) {
        onChange(`/${rootName}/${parts.join('/')}`)
        setErrorMsg('')
      } else {
        setErrorMsg(`선택한 파일이 "${rootName}" 폴더 안에 없습니다. 같은 폴더 내 파일을 선택해주세요.`)
      }

    } catch (e) {
      if (e.name !== 'AbortError') console.error(e)
      setLoading(false)
    }
  }

  const updateSuggestions = useCallback((query) => {
    if (!query || query.length < 1) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }
    const matched = allPaths()
      .filter(p => fuzzyMatch(p, query))
      .map(p => ({ path: p, score: scoreMatch(p, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(x => x.path)

    setSuggestions(matched)
    setShowDropdown(matched.length > 0)
    setHighlightIdx(0)
  }, [allPaths])

  const handleChange = (e) => {
    const v = e.target.value
    onChange(v)
    updateSuggestions(v)
  }

  const handleSelect = (path) => {
    onChange(path)
    setSuggestions([])
    setShowDropdown(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (suggestions[highlightIdx]) { e.preventDefault(); handleSelect(suggestions[highlightIdx]) } }
    else if (e.key === 'Escape') { setShowDropdown(false) }
  }

  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) return
      setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    dropdownRef.current?.querySelector('.suggestion-item.highlighted')?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  return (
    <div className="filepath-input-wrap">
      {label && <label>{label}</label>}
      <div className="filepath-field">
        {expectedRoot && (
          <div className="filepath-root-hint">
            폴더 선택 시 <strong>{expectedRoot}</strong> 루트 폴더를 선택하세요
          </div>
        )}
        <div className="filepath-input-row">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => value && updateSuggestions(value)}
            placeholder={placeholder || '직접 입력 또는 파일 선택'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="browse-btn"
            onClick={handlePickFile}
            disabled={loading}
            title={expectedRoot ? `1) ${expectedRoot} 루트 폴더 선택 → 2) 파일 선택` : '프로젝트 폴더 선택 후 파일 지정'}
          >
            {loading ? <span className="browse-spinner" /> : '파일 선택'}
          </button>
        </div>

        {errorMsg && (
          <div className="filepath-error">{errorMsg}</div>
        )}

        {indexedRoots.length > 0 && (
          <div className="indexed-hint">
            <span className="indexed-dot" />
            <span>인덱싱됨: <strong>{indexedRoots.join(', ')}</strong></span>
            <button type="button" className="cache-clear-btn" onClick={handleClearCache}>초기화</button>
          </div>
        )}

        {showDropdown && (
          <div className="suggestions-dropdown" ref={dropdownRef}>
            {suggestions.map((path, i) => (
              <div
                key={path}
                className={`suggestion-item ${i === highlightIdx ? 'highlighted' : ''}`}
                onMouseDown={() => handleSelect(path)}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                <MdInsertDriveFile className="suggestion-icon" />
                <span className="suggestion-path">{path}</span>
              </div>
            ))}
            <div className="suggestions-footer">↑↓ 탐색 · Enter 선택 · Esc 닫기</div>
          </div>
        )}
      </div>
    </div>
  )
}
