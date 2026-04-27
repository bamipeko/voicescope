import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import RecordingDetail from './pages/RecordingDetail'
import CrossAsk from './pages/CrossAsk'
import Templates from './pages/Templates'
import Settings from './pages/Settings'
import Archive from './pages/Archive'
import Trash from './pages/Trash'
import RecordButton from './components/RecordButton'
import SetupWizard from './components/SetupWizard'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recordings/:id" element={<RecordingDetail />} />
          <Route path="/ask-all" element={<CrossAsk />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/trash" element={<Trash />} />
        </Routes>
      </Layout>
      <RecordButton />
      <SetupWizard />
    </BrowserRouter>
  )
}
