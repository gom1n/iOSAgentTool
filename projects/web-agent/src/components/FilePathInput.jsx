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

// onChange: 단일 경로 (string)
// onMultiple: 여러 경로 (string[]) — 제공 시 파일 다중 선택 모드
// multipleButton: true이면 버튼만 렌더링 (텍스트 입력 없음)
export default function FilePathInput({ value, onChange, onMultiple, placeholder, label, projectPath, multipleButton }) {
  const [suggestions, setSuggestions] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [indexedRoots, setIndexedRoots] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const cacheRef = useRef(loadCache())

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

  // 캐시에서 파일명으로 경로 찾기
  const resolveFromCache = (rootName, fileName) => {
    const cached = cacheRef.current[rootName] || []
    return cached
      .filter(p => p === fileName || p.endsWith('/' + fileName))
      .map(p => `/${rootName}/${p}`)
  }

  const handlePickFile = async () => {
    if (!('showOpenFilePicker' in window)) {
      alert('Chrome / Edge에서만 지원됩니다.')
      return
    }
    setErrorMsg('')
    setLoading(true)

    const isMultiple = !!onMultiple
    const rootName = expectedRoot
    const isCached = rootName && cacheRef.current[rootName]

    try {
      if (!isCached) {
        // 최초 1회: 루트 폴더 선택 → 인덱싱 → 파일 선택
        if (!('showDirectoryPicker' in window)) {
          alert('Chrome / Edge에서만 지원됩니다.')
          setLoading(false)
          return
        }
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
        const pickedRoot = dirHandle.name

        if (expectedRoot && pickedRoot !== expectedRoot) {
          setErrorMsg(`"${pickedRoot}"이 아닌 "${expectedRoot}" 폴더를 선택해주세요.`)
          setLoading(false)
          return
        }

        const files = await collectPaths(dirHandle, '')
        cacheRef.current = { ...cacheRef.current, [pickedRoot]: files }
        saveCache(cacheRef.current)
        setIndexedRoots(Object.keys(cacheRef.current))

        const handles = await window.showOpenFilePicker({ multiple: isMultiple })
        const results = []
        for (const fh of handles) {
          const parts = await dirHandle.resolve(fh)
          if (parts?.length > 0) results.push(`/${pickedRoot}/${parts.join('/')}`)
        }

        setLoading(false)
        if (results.length === 0) {
          setErrorMsg(`선택한 파일이 "${pickedRoot}" 폴더 안에 없습니다.`)
          return
        }
        if (isMultiple) onMultiple(results)
        else onChange(results[0])
        return
      }

      // 이미 인덱싱됨: 파일만 선택 (폴더 picker 생략)
      const handles = await window.showOpenFilePicker({ multiple: isMultiple })
      const results = []

      for (const fh of handles) {
        const fileName = fh.name
        const matches = resolveFromCache(rootName, fileName)

        if (matches.length === 1) {
          results.push(matches[0])
        } else if (matches.length > 1) {
          // 동일 파일명이 여러 곳에 있으면 드롭다운으로 선택
          setSuggestions(matches)
          setShowDropdown(true)
        } else {
          setErrorMsg(`"${fileName}"을 캐시에서 찾을 수 없습니다. 캐시 초기화 후 다시 시도해주세요.`)
        }
      }

      setLoading(false)
      if (results.length === 0) return
      if (isMultiple) onMultiple(results)
      else onChange(results[0])

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

  const isCached = expectedRoot && indexedRoots.includes(expectedRoot)

  // 버튼 전용 모드 (여러 파일 선택용)
  if (multipleButton) {
    return (
      <button
        type="button"
        className="browse-btn browse-btn-multiple"
        onClick={handlePickFile}
        disabled={loading}
        title={isCached ? '여러 파일 한번에 선택' : `1) ${expectedRoot ?? '프로젝트'} 폴더 선택 → 2) 파일 여러 개 선택`}
      >
        {loading ? <span className="browse-spinner" /> : '+ 여러 파일 선택'}
      </button>
    )
  }

  return (
    <div className="filepath-input-wrap">
      {label && <label>{label}</label>}
      <div className="filepath-field">
        {expectedRoot && !isCached && (
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
            title={isCached ? '파일 선택 (폴더 재선택 불필요)' : `1) ${expectedRoot ?? '프로젝트'} 폴더 선택 → 2) 파일 선택`}
          >
            {loading ? <span className="browse-spinner" /> : (isCached ? '파일 선택' : '폴더 · 파일 선택')}
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
