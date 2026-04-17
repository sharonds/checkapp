"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wand2, Copy } from "lucide-react";
import { toast } from "sonner";

interface RegeneratePanelProps {
  source: string;
  hasIssues: boolean;
}

export function isRerunnableSource(source: string): boolean {
  if (source === "mcp-check") return false;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return /docs\.google\.com\/document/.test(source);
  }
  return source.startsWith("/") || /\.(md|txt|markdown)$/i.test(source);
}

export function RegeneratePanel({ source, hasIssues }: RegeneratePanelProps) {
  if (!hasIssues) return null;
  if (!isRerunnableSource(source)) return null;

  const safeSource = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const command = `checkapp --fix "${safeSource}"`;

  const copyCommand = () => {
    navigator.clipboard.writeText(command);
    toast.success("Command copied to clipboard");
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="w-4 h-4 text-amber-500" />
          Fix Issues with AI
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Run this command to get AI-suggested rewrites for all flagged sentences:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm font-mono">
            {command}
          </code>
          <Button variant="outline" size="sm" onClick={copyCommand}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
