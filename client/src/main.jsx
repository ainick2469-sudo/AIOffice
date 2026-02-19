import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { BeginnerModeProvider } from './components/beginner/BeginnerModeContext'

createRoot(document.getElementById('root')).render(
  <BeginnerModeProvider>
    <App />
  </BeginnerModeProvider>
)
