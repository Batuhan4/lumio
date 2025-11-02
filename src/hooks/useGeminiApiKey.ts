import { useCallback, useMemo, useState } from "react";
import storage from "../util/storage";

const STORAGE_KEY = "geminiApiKey";

const readStoredKey = () => {
  if (typeof window === "undefined") {
    return "";
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
};

export const useGeminiApiKey = () => {
  const [storedKey, setStoredKey] = useState<string>(() => readStoredKey());

  const setApiKey = useCallback((value: string) => {
    const trimmed = value.trim();
    setStoredKey(trimmed);
    if (trimmed) {
      storage.setItem(STORAGE_KEY, trimmed);
    } else {
      storage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearApiKey = useCallback(() => {
    setStoredKey("");
    storage.removeItem(STORAGE_KEY);
  }, []);

  const envKey =
    typeof import.meta.env.VITE_GEMINI_API_KEY === "string"
      ? import.meta.env.VITE_GEMINI_API_KEY
      : "";

  const effectiveKey = useMemo(() => {
    if (storedKey) {
      return storedKey;
    }
    return envKey;
  }, [storedKey, envKey]);

  return {
    apiKey: effectiveKey,
    persistedKey: storedKey,
    envKey,
    setApiKey,
    clearApiKey,
  };
};
