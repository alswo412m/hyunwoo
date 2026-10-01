import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Reset saved form data before React initializes state on a browser refresh.
const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
if (navigation?.type === 'reload') {
  try {
    for (const key of ['timetable:selected-courses', 'timetable:academic:2025', 'timetable:curriculum:2025', 'timetable:curriculum-confirmed:2025']) {
      localStorage.removeItem(key)
    }
  } catch { /* Form state still starts fresh when storage is unavailable. */ }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
