import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "vtc_token";

export type Role = "passenger" | "driver" | "company";

export type User = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  phone?: string;
  vehicle_model?: string;
  license_plate?: string;
  rating: number;
  total_rides: number;
  manager_id?: string | null;
  manager_name?: string | null;
  is_active?: boolean;
  is_moderator?: boolean;
  docs_blocked?: boolean;
  has_photo?: boolean;
  selfie_requested?: boolean;
  company_name?: string | null;
  invite_code?: string | null;
  company_id?: string | null;
  budget_amount?: number | null;
  budget_period?: "day" | "week" | "month" | null;
  company_active?: boolean | null;
};

export const homeFor = (role: Role) => (role === "passenger" ? "/(passenger)" : role === "company" ? "/(company)" : "/(driver)");

type AuthCtx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

type RegisterPayload = {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  phone?: string;
  vehicle_model?: string;
  license_plate?: string;
  company_name?: string;
};

const Ctx = createContext<AuthCtx>({} as AuthCtx);

async function saveToken(t: string) {
  if (Platform.OS === "web") localStorage.setItem(TOKEN_KEY, t);
  else await SecureStore.setItemAsync(TOKEN_KEY, t);
}
async function readToken() {
  if (Platform.OS === "web") return localStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}
async function removeToken() {
  if (Platform.OS === "web") localStorage.removeItem(TOKEN_KEY);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, { ...opts, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.detail || `Erreur ${res.status}`);
  return json as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = await readToken();
    if (!t) {
      setUser(null); setToken(null); setLoading(false); return;
    }
    try {
      const me = await apiFetch<User>("/auth/me", {}, t);
      setUser(me); setToken(t);
    } catch {
      await removeToken();
      setUser(null); setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await saveToken(data.access_token);
    setToken(data.access_token); setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await apiFetch<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await saveToken(data.access_token);
    setToken(data.access_token); setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await removeToken();
    setToken(null); setUser(null);
  }, []);

  const value = useMemo(() => ({ user, token, loading, login, register, logout, refresh }), [user, token, loading, login, register, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
