import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CustomerVoting from './pages/CustomerVoting';
import RequestSuccess from './pages/RequestSuccess';
import VenueLogin from './pages/VenueLogin';
import VenueDashboard from './pages/VenueDashboard';
import VenuePlayer from './pages/VenuePlayer';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/v/:venueCode" element={<CustomerVoting />} />
      <Route path="/v/:venueCode/request-success" element={<RequestSuccess />} />
      <Route path="/venue/login" element={<VenueLogin />} />
      <Route path="/venue/dashboard" element={<VenueDashboard />} />
      <Route path="/venue/player/:venueCode" element={<VenuePlayer />} />
    </Routes>
  );
}
