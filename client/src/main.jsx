import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn) {
  const tracesSampleRate = Math.min(
    1,
    Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0)),
  );
  const integrations = [];
  if (tracesSampleRate > 0) {
    integrations.push(Sentry.browserTracingIntegration());
  }
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    integrations,
    tracesSampleRate,
    sendDefaultPii: false,
  });
}

function AppTree() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  );
}

const root = (
  <React.StrictMode>
    {sentryDsn ? (
      <Sentry.ErrorBoundary fallback={<div className="min-h-screen flex items-center justify-center p-6 text-zinc-600">Something went wrong. Please refresh the page.</div>}>
        <AppTree />
      </Sentry.ErrorBoundary>
    ) : (
      <AppTree />
    )}
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById('root')).render(root);
