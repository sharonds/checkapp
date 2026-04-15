import { Bug, Lightbulb, Coffee } from "lucide-react";

const footerLinks = [
  {
    href: "https://github.com/sharonds/article-checker/issues/new",
    label: "Report Bug",
    icon: Bug,
  },
  {
    href: "https://github.com/sharonds/article-checker/discussions/new",
    label: "Feature Request",
    icon: Lightbulb,
  },
  {
    href: "https://buy.stripe.com/00wbJ1ah0eLYgAfadc9sk04",
    label: "Buy me a coffee",
    icon: Coffee,
  },
];

export function FooterBar() {
  return (
    <footer className="mt-auto flex items-center justify-end gap-5 border-t border-border px-6 py-3">
      {footerLinks.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className="h-3 w-3" />
          {label}
        </a>
      ))}
    </footer>
  );
}
