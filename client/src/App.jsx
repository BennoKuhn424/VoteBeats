import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import CustomerVoting from './pages/CustomerVoting';
import RequestSuccess from './pages/RequestSuccess';
import VenueLogin from './pages/VenueLogin';
import VenueLayout from './layouts/VenueLayout';
import VenueDashboard from './pages/VenueDashboard';
import VenuePlayer from './pages/VenuePlayer';
import VenueBrowsePlaylists from './pages/VenueBrowsePlaylists';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/v/:venueCode" element={<CustomerVoting />} />
      <Route path="/v/:venueCode/request-success" element={<RequestSuccess />} />
      <Route path="/venue/login" element={<VenueLogin />} />
      <Route path="/venue" element={<VenueLayout />}>
        <Route index element={<Navigate to="/venue/dashboard" replace />} />
        <Route path="dashboard" element={<VenueDashboard />} />
        <Route path="playlists" element={<VenueBrowsePlaylists />} />
        <Route path="player/:venueCode" element={<VenuePlayer />} />
      </Route>
    </Routes>
  );
}
