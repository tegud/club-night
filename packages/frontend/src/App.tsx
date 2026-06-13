import { Routes, Route } from 'react-router-dom';
import { ClubShell } from './club/ClubShell';
import { ClubHomePage } from './pages/ClubHomePage';
import { NightDetailPage } from './pages/NightDetailPage';
import { ManageSignupPage } from './pages/ManageSignupPage';

export function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ClubShell />}>
        <Route index element={<ClubHomePage />} />
        <Route path="nights/:nightId" element={<NightDetailPage />} />
        <Route path="nights/:nightId/manage" element={<ManageSignupPage />} />
      </Route>
      <Route path="*" element={<div className="container">Page not found</div>} />
    </Routes>
  );
}
