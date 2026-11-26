import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';
// MODULE_IMPORTS_START
import { AuthProvider } from './contexts/AuthContext';
import LogoutCallbackPage from './pages/LogoutCallbackPage';
// MODULE_IMPORTS_END
import ExamplePage from './pages/ExamplePage';
import ResumesPage from './pages/ResumesPage';
import Workspace from './pages/Workspace';
import PublicPage from './pages/PublicPage';
import { AccountWatcher } from './components/folio/AuthBits';

const queryClient = new QueryClient();

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Index />} />
    <Route path="/example" element={<ExamplePage />} />
    <Route path="/resumes" element={<ResumesPage />} />
    <Route path="/app/:id" element={<Workspace />} />
    <Route path="/page/:slug" element={<PublicPage />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/auth/error" element={<AuthError />} />
    {/* MODULE_ROUTES_START */}
    <Route path='/profile' element={<ResumesPage />} />
    <Route path='/logout-callback' element={<LogoutCallbackPage />} />
    {/* MODULE_ROUTES_END */}
    <Route path="*" element={<Index />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/* MODULE_PROVIDERS_START */}
    <AuthProvider>
    {/* MODULE_PROVIDERS_END */}
    <TooltipProvider>
      <Toaster position="top-center" richColors />
      <AccountWatcher />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
    </AuthProvider>
    {/* MODULE_PROVIDERS_CLOSE */}
  </QueryClientProvider>
);

export default App;
export { AppRoutes };
