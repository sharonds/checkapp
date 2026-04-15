import Link from "next/link";
import { FooterBar } from "@/components/footer-bar";

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-4 text-muted-foreground">
          No checks yet.{" "}
          <Link
            href="/check"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            Run your first check
          </Link>
        </p>
      </div>
      <FooterBar />
    </div>
  );
}
