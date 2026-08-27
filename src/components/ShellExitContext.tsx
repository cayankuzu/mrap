"use client";

import { createContext, useContext } from "react";

const ShellExitContext = createContext<(() => void) | null>(null);

export function ShellExitProvider({ children, onRequestExit }: { children: React.ReactNode; onRequestExit: () => void }) {
  return <ShellExitContext.Provider value={onRequestExit}>{children}</ShellExitContext.Provider>;
}

export function useShellExit() {
  const requestExit = useContext(ShellExitContext);
  if (!requestExit) throw new Error("useShellExit, ShellExitProvider içinde kullanılmalı.");
  return requestExit;
}
