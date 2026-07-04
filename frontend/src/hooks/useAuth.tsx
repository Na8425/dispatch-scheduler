import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import * as apiClient from '../api/client';

interface AuthState {
  token: string | null;
  organizationId: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, orgName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [organizationId, setOrganizationId] = useState<string | null>(
    localStorage.getItem('organizationId')
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.login(email, password);
    localStorage.setItem('token', res.token);
    setToken(res.token);
    const orgs = await apiClient.getMyOrganizations();
    if (orgs[0]) {
      localStorage.setItem('organizationId', orgs[0].id);
      setOrganizationId(orgs[0].id);
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string, orgName: string) => {
      const res = await apiClient.register(email, password, name, orgName);
      localStorage.setItem('token', res.token);
      localStorage.setItem('organizationId', res.organization.id);
      setToken(res.token);
      setOrganizationId(res.organization.id);
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('organizationId');
    setToken(null);
    setOrganizationId(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, organizationId, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
