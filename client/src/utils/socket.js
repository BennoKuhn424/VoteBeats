import { io } from 'socket.io-client';

// Connect to the same origin as the API (strips /api suffix if present)
const SERVER_URL = (import.meta.env.VITE_API_URL || '')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '') || '';

const socket = io(SERVER_URL, {
  autoConnect: false,      // we connect manually per venue
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export default socket;
