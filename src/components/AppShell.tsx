"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bell, Compass, Home, LogOut, Map, RefreshCw, Settings, Trophy, UserRound } from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { Logo } from "@/components/Logo";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ShellExitProvider } from "@/components/ShellExitContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { AppUser } from "@/lib/models";
import { clearPrivateClientState } from "@/lib/private-client-state";
import { dispatchMrapRefresh, type MrapRefreshScope } from "@/lib/refresh-events";

const primaryRoutes = new Set(["/home", "/explore", "/play", "/leaderboard", "/profile"]);

function AppNavigation({ mobile = false, demo = false }: { mobile?: boolean; demo?: boolean }) {
  const { dictionary: copy } = useI18n();
  const pathname = usePathname();
  const prefix = demo ? "/demo" : "";
  const navItems = [
    { href: "/home", label: copy.navigation.home, icon: Home },
    { href: "/explore", label: copy.navigation.explore, icon: Compass },
    { href: "/play", label: copy.navigation.map, icon: Map, primary: true },
    { href: "/leaderboard", label: copy.navigation.leaderboard, icon: Trophy },
    { href: "/profile", label: copy.navigation.profile, icon: UserRound },
  ];
  return (
    <nav className={mobile ? "bottom-nav" : "side-nav"} aria-label={copy.navigation.ariaLabel}>
      {navItems.map((item) => {
        const href = `${prefix}${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = item.icon;
        return (
          <Link key={href} href={href} className={`nav-item${active ? " is-active" : ""}${item.primary ? " nav-item--primary" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="nav-icon-wrap"><Icon size={mobile ? 22 : 20} strokeWidth={active ? 2.5 : 2} /></span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, user, demo = false }: { children: React.ReactNode; user: AppUser; demo?: boolean }) {
  const { dictionary: copy } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const prefix = demo ? "/demo" : "";
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const routeWithoutPrefix = demo && normalizedPath.startsWith("/demo") ? normalizedPath.slice(5) || "/" : normalizedPath;
  const showBackButton = !primaryRoutes.has(routeWithoutPrefix);
  const previousPathRef = useRef(pathname);
  const hasInternalHistoryRef = useRef(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitPending, setExitPending] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousPathRef.current !== pathname) {
      hasInternalHistoryRef.current = true;
      previousPathRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  function goBack() {
    if (hasInternalHistoryRef.current) {
      router.back();
      return;
    }
    const fallback = routeWithoutPrefix === "/settings"
      ? "/profile"
      : routeWithoutPrefix.startsWith("/users/")
        ? "/explore"
        : "/home";
    router.replace(`${prefix}${fallback}`);
  }

  const requestExit = useCallback(() => {
    setExitError(null);
    setExitDialogOpen(true);
  }, []);

  const cancelExit = useCallback(() => {
    setExitDialogOpen(false);
    setExitError(null);
  }, []);

  const refreshContent = useCallback((source: "button" | "pull", scope: MrapRefreshScope = "screen") => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    dispatchMrapRefresh(window, { source, scope });
    router.refresh();
    refreshTimerRef.current = window.setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      refreshTimerRef.current = null;
    }, 650);
  }, [router]);

  const refreshFromPull = useCallback((scope: MrapRefreshScope) => {
    refreshContent("pull", scope);
  }, [refreshContent]);

  async function confirmExit() {
    if (exitPending) return;
    setExitPending(true);
    setExitError(null);
    if (demo) {
      router.push("/");
      return;
    }
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(copy.shell.logoutFailed);
      clearPrivateClientState({ sessionStorage: window.sessionStorage, localStorage: window.localStorage }, user.id);
      router.push("/login");
      router.refresh();
    } catch {
      setExitPending(false);
      setExitError(copy.shell.logoutConnectionError);
    }
  }

  return (
    <ShellExitProvider onRequestExit={requestExit}><div className="app-shell" style={{ "--player-color": user.color } as React.CSSProperties}>
      <aside className="app-sidebar">
        <Logo href={`${prefix}/home`} />
        {demo ? <span className="demo-badge">{copy.shell.demoBadge}</span> : null}
        <AppNavigation demo={demo} />
        {demo ? <div className="sidebar-season-card"><span className="eyebrow">{copy.shell.demoSeason}</span><strong>{copy.shell.demoSeasonTitle}</strong><div className="season-progress"><span /></div><small>{copy.shell.demoSeasonHint}</small></div> : <div className="sidebar-season-card real-onboarding-card"><span className="eyebrow">{copy.shell.realAccount}</span><strong>{copy.shell.realAccountHint}</strong><Link href="/play">{copy.common.openMap}</Link></div>}
        <div className="sidebar-footer">
          <Link href={demo ? "/register" : "/settings"}><Settings size={18} /> {demo ? copy.common.createAccount : copy.common.settings}</Link>
          <button type="button" onClick={requestExit} aria-haspopup="dialog" aria-expanded={exitDialogOpen}><LogOut size={18} /> {demo ? copy.common.leaveDemo : copy.common.logout}</button>
        </div>
      </aside>

      <div className="app-stage">
        <header className={`app-topbar${showBackButton ? " has-back" : ""}`}>
          <div className="app-topbar-leading">
            {showBackButton ? <button type="button" className="app-back-button app-back-button--topbar" onClick={goBack} aria-label={copy.shell.backAria}><ArrowLeft size={20} /><span>{copy.common.back}</span></button> : null}
            <Logo href={`${prefix}/home`} />
          </div>
          <div className="app-topbar-actions">
            {demo ? <span className="demo-badge demo-badge--mobile">{copy.shell.demoBadgeShort}</span> : null}
            <button type="button" className="icon-button app-refresh-button" onClick={() => refreshContent("button")} disabled={refreshing} aria-label={copy.shell.refreshAria} title={copy.shell.refreshAria} aria-busy={refreshing}><RefreshCw size={19} aria-hidden="true" /></button>
            <Link href={`${prefix}/notifications`} className="icon-button" aria-label={copy.common.notifications}><Bell size={20} />{demo ? <span className="notification-dot" /> : null}</Link>
          </div>
        </header>
        <PullToRefresh refreshing={refreshing} onRefresh={refreshFromPull} />
        <main className="app-main">{children}</main>
      </div>
      <AppNavigation mobile demo={demo} />
      <ConfirmationDialog
        open={exitDialogOpen}
        title={demo ? copy.shell.demoExitTitle : copy.shell.accountExitTitle}
        description={demo ? copy.shell.demoExitDescription : copy.shell.accountExitDescription}
        confirmLabel={demo ? copy.common.leaveDemo : copy.shell.accountExit}
        pendingLabel={demo ? copy.shell.demoExiting : copy.shell.accountExiting}
        pending={exitPending}
        error={exitError}
        onCancel={cancelExit}
        onConfirm={confirmExit}
      />
    </div></ShellExitProvider>
  );
}
