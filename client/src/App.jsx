import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import RecordingDetail from './pages/RecordingDetail'
import Templates from './pages/Templates'
import Settings from './pages/Settings'
import RecordButton from './components/RecordButton'
import SetupWizard from './components/SetupWizard'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recordings/:id" element={<RecordingDetail />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
      <RecordButton />
      <SetupWizard />
    </BrowserRouter>
  )
}
