import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useOutletContext } from 'react-router';
import './index.css';
import Layout, { type Ctx } from './Layout.tsx';
import Login from './pages/Login.tsx';
import { Privacy, Terms } from './pages/Legal.tsx';
import Home from './pages/Home.tsx';
import Result from './pages/Result.tsx';
import AdminLeases from './pages/AdminLeases.tsx';
import AdminLabs from './pages/AdminLabs.tsx';
import AdminAudit from './pages/AdminAudit.tsx';
import AdminStats from './pages/AdminStats.tsx';

// Cosmetic only: every /api/admin route checks the role on the server.
function AdminOnly() {
  const ctx = useOutletContext<Ctx>();
  return ctx.me.role === 'admin' ? <Outlet context={ctx} /> : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/privasi', element: <Privacy /> },
  { path: '/ketentuan', element: <Terms /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'hasil', element: <Result /> },
      {
        path: 'admin',
        element: <AdminOnly />,
        children: [
          { index: true, element: <Navigate to="leases" replace /> },
          { path: 'leases', element: <AdminLeases /> },
          { path: 'labs', element: <AdminLabs /> },
          { path: 'audit', element: <AdminAudit /> },
          { path: 'stats', element: <AdminStats /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
