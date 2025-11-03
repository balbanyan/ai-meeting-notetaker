import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MeetingDetailsPage from './pages/MeetingDetailsPage'
import EmbeddedApp from './pages/EmbeddedApp'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/meeting/:uuid" element={<MeetingDetailsPage />} />
      <Route path="/embed" element={<EmbeddedApp />} />
    </Routes>
  )
}

export default App
