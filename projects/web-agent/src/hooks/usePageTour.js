import { useState, useEffect } from 'react'

export default function usePageTour(key) {
  const storageKey = `acc_tour_${key}`
  const [showTour, setShowTour] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      const t = setTimeout(() => setShowTour(true), 400)
      return () => clearTimeout(t)
    }
  }, [storageKey])

  return {
    showTour,
    startTour: () => setShowTour(true),
    closeTour: () => { localStorage.setItem(storageKey, '1'); setShowTour(false) },
  }
}
