import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider } from 'convex/react'
import './index.css'
import App from './App.tsx'
import { convexClient } from './lib/convex.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convexClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
)
