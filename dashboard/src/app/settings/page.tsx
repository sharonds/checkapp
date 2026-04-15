import { FooterBar } from "@/components/footer-bar";

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-4 text-muted-foreground">
          Configure API keys, engines, and preferences.
        </p>
      </div>
      <FooterBar />
    </div>
  );
}
