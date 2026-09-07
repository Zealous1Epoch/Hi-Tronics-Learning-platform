import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { UserInfo } from "../lib/api";
import { getMe } from "../lib/api";

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  setUser: (user: UserInfo | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      getMe()
        .then((u) => setUser(u))
        .catch(() => {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}