import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Shield, User } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

const Header: React.FC = () => {
  const { user, loading, login, logout, isAdmin } = useAuth();

  if (loading) {
    return (
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">App</h1>
            </div>
            <div className="flex items-center">
              <div className="animate-pulse h-8 w-16 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            {user && (
              <div className="mr-8 flex items-center space-x-2">
                {/* Privacy: don't show email/name by default in header */}
                <User className="h-4 w-4 text-gray-600" aria-hidden="true" />
                <Badge
                  variant={isAdmin ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {isAdmin ? (
                    <>
                      <Shield className="h-3 w-3 mr-1" />
                      Admin
                    </>
                  ) : (
                    'Regular User'
                  )}
                </Badge>
              </div>
            )}
            <h1
              className="text-xl font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
              onClick={() => (window.location.href = '/')}
            >
              App
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => (window.location.href = '/admin')}
                    className="flex items-center space-x-2"
                  >
                    <Settings className="h-4 w-4" />
                    <span>Admin Panel</span>
                  </Button>
                )}
                <Button variant="destructive" size="sm" onClick={logout}>
                  Logout
                </Button>
              </>
            ) : (
              <Button onClick={login} size="sm">
                Login
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
