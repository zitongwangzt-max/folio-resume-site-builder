import { usePageSeo } from '@/lib/page-seo';
import { useEffect } from 'react';
import { client } from '../lib/api';

export default function AuthCallback() {
  usePageSeo('Signing in | My Project', 'Complete your sign-in and return to the app.', true);
  useEffect(() => {
    client.auth.login();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Processing authentication...</p>
      </div>
    </div>
  );
}
