import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './app-context.jsx';
import { Layout } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Patients from './pages/Patients.jsx';
import PatientFile from './pages/PatientFile.jsx';
import Appointments from './pages/Appointments.jsx';
import Plans from './pages/Plans.jsx';
import Payments from './pages/Payments.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

// بوابة المريض تُحمَّل عند الطلب فقط (لا تثقل تطبيق العيادة ولا العكس)
const Portal = React.lazy(() => import('./pages/Portal.jsx'));

function Protected({ children }) {
  const { user, ready } = useApp();
  const loc = useLocation();
  if (!ready) return <div className="grid min-h-screen place-items-center"><Spinner label="جارٍ فتح النظام…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/*" element={<React.Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner /></div>}><Portal /></React.Suspense>} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/patients" element={<Protected><Patients /></Protected>} />
      <Route path="/patients/:id" element={<Protected><PatientFile /></Protected>} />
      <Route path="/appointments" element={<Protected><Appointments /></Protected>} />
      <Route path="/plans" element={<Protected><Plans /></Protected>} />
      <Route path="/plans/:id" element={<Protected><Plans /></Protected>} />
      <Route path="/payments" element={<Protected><Payments /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
