import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LeaguePage } from './pages/LeaguePage';
import { PlayerPage } from './pages/PlayerPage';
import { NotFoundPage } from './pages/NotFoundPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/league/:leagueId" element={<LeaguePage />} />
        <Route path="/player/:playerId" element={<PlayerPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

export default App;