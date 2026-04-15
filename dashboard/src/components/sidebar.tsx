"use client";

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
  const { theme, setTheme } = useTheme();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-border/10 bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-border/10 px-5">
        <span className="text-sm font-semibold tracking-tight">
          Article Checker
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border/10 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">v1.0.0</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-accent-foreground hover:bg-accent"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
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
