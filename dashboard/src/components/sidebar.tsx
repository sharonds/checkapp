"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  FileText,
  PlayCircle,
  Puzzle,
  BookMarked,
  Settings,
  BookOpen,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/check", label: "Run Check", icon: PlayCircle },
  { href: "/skills", label: "Skills", icon: Puzzle },
  { href: "/contexts", label: "Contexts", icon: BookMarked },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDarkMode = resolvedTheme === "dark";
  const canToggleTheme = mounted && resolvedTheme != null;
  const toggleTheme = () => {
    if (!canToggleTheme) return;
    setTheme(isDarkMode ? "light" : "dark");
  };
  const toggleHint = canToggleTheme
    ? isDarkMode
      ? "Switch to light theme"
      : "Switch to dark theme"
    : "Theme loading";

  return (
    <aside className="fixed inset-x-0 top-0 z-30 border-b border-border/10 bg-sidebar text-sidebar-foreground md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-b-0">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border/10 px-4 md:px-5">
        <span className="text-sm font-semibold tracking-tight">
          CheckApp
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-accent-foreground hover:bg-accent md:hidden"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={toggleHint}
          disabled={!canToggleTheme}
        >
          <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:flex-1 md:flex-col md:space-y-0.5 md:overflow-visible md:px-3 md:py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm transition-colors md:flex md:items-center md:gap-3 ${
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <span className="flex items-center gap-2 md:gap-3">
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden border-t border-border/10 px-4 py-4 md:block">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">v1.0.0</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-accent-foreground hover:bg-accent"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={toggleHint}
            disabled={!canToggleTheme}
          >
            <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
