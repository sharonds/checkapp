import { FooterBar } from "@/components/footer-bar";

export default function DocsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          Documentation
        </h1>
        <p className="mt-4 text-muted-foreground">
          Learn how to use the Article Checker CLI and dashboard.
        </p>
      </div>
      <FooterBar />
    </div>
  );
}
