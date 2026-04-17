"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";
import { FooterBar } from "@/components/footer-bar";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  MessageSquare,
  Scale,
  ClipboardList,
  Palette,
  FileText,
  Trash2,
  Pencil,
  Upload,
  Eye,
  X,
  Check,
  Type,
} from "lucide-react";

interface ContextItem {
  id: number;
  type: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const CONTEXT_TYPES = [
  {
    type: "tone-guide",
    name: "Tone Guide",
    description: "Brand voice rules for the Tone of Voice skill",
    icon: MessageSquare,
  },
  {
    type: "legal-policy",
    name: "Legal Policy",
    description: "Company legal requirements for the Legal Risk skill",
    icon: Scale,
  },
  {
    type: "brief",
    name: "Content Brief",
    description: "Content brief with requirements for the Brief Matching skill",
    icon: ClipboardList,
  },
  {
    type: "style-guide",
    name: "Style Guide",
    description: "Writing style rules for SEO and Tone skills",
    icon: Palette,
  },
  {
    type: "custom",
    name: "Custom Context",
    description: "Any additional context for custom skills",
    icon: FileText,
  },
] as const;

export default function ContextsPage() {
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pastingType, setPastingType] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sheetType, setSheetType] = useState<string | null>(null);
  const [sheetEditing, setSheetEditing] = useState(false);
  const [sheetEditContent, setSheetEditContent] = useState("");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchContexts();
  }, []);

  function fetchContexts() {
    fetch("/api/contexts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setContexts(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function getContextForType(type: string): ContextItem | undefined {
    return contexts.find((c) => c.type === type);
  }

  async function saveContext(type: string, content: string) {
    const meta = CONTEXT_TYPES.find((t) => t.type === type);
    if (!meta) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf("/api/contexts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: meta.name,
          content,
        }),
      });
      if (res.ok) {
        toast.success("Context saved");
        setPastingType(null);
        setPasteContent("");
        setSheetEditing(false);
        setSheetEditContent("");
        fetchContexts();
      } else {
        toast.error("Failed to save context");
      }
    } catch {
      toast.error("Failed to save context");
    } finally {
      setSaving(false);
    }
  }

  async function deleteContext(type: string) {
    try {
      const res = await fetch(`/api/contexts/${type}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Context removed");
        setDeleteConfirm(null);
        if (sheetType === type) {
          setSheetType(null);
          setSheetEditing(false);
        }
        fetchContexts();
      } else {
        toast.error("Failed to delete context");
      }
    } catch {
      toast.error("Failed to delete context");
    }
  }

  function handleFileUpload(type: string, file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        saveContext(type, text);
      }
    };
    reader.onerror = () => {
      toast.error("Failed to read file");
    };
    reader.readAsText(file);
  }

  function openSheet(type: string) {
    setSheetType(type);
    setSheetEditing(false);
    setSheetEditContent("");
  }

  function startSheetEdit() {
    if (!sheetType) return;
    const ctx = getContextForType(sheetType);
    setSheetEditContent(ctx?.content ?? "");
    setSheetEditing(true);
  }

  function getPreviewLines(content: string): string {
    const lines = content.split("\n").slice(0, 3).join("\n");
    return lines.length > 150 ? lines.slice(0, 150) + "..." : lines;
  }

  const sheetMeta = sheetType
    ? CONTEXT_TYPES.find((t) => t.type === sheetType)
    : null;
  const sheetCtx = sheetType ? getContextForType(sheetType) : null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Contexts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage tone guides, briefs, legal policies, and other context
          documents used by analysis skills.
        </p>

        <div className="mt-6 grid max-w-4xl gap-4 sm:grid-cols-2">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <LoadingSkeleton key={i} variant="card" />
              ))
            : CONTEXT_TYPES.map((meta) => {
                const ctx = getContextForType(meta.type);
                const Icon = meta.icon;
                const isPasting = pastingType === meta.type;
                const isDeleting = deleteConfirm === meta.type;

                return (
                  <Card
                    key={meta.type}
                    className="flex flex-col rounded-xl border bg-card shadow-sm"
                  >
                    <CardContent className="flex flex-1 flex-col gap-3 p-5">
                      {/* Header: icon + name + description */}
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{meta.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {meta.description}
                          </p>
                        </div>
                      </div>

                      {/* State 1: Empty — paste mode */}
                      {isPasting ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={pasteContent}
                            onChange={(e) => setPasteContent(e.target.value)}
                            className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="Paste or type content..."
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                saveContext(meta.type, pasteContent)
                              }
                              disabled={saving || !pasteContent.trim()}
                            >
                              <Check className="mr-1 h-3 w-3" />
                              {saving ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setPastingType(null);
                                setPasteContent("");
                              }}
                            >
                              <X className="mr-1 h-3 w-3" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : ctx ? (
                        /* State 2: Configured (collapsed) */
                        <div className="flex flex-1 flex-col gap-2">
                          {/* Status row */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                            <span>{ctx.content.length.toLocaleString()} chars</span>
                            <span className="text-muted-foreground/50">|</span>
                            <span>
                              Updated{" "}
                              {new Date(ctx.updatedAt).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Content preview */}
                          <pre className="line-clamp-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                            {getPreviewLines(ctx.content)}
                          </pre>

                          {/* Action buttons */}
                          <div className="mt-auto flex items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSheet(meta.type)}
                            >
                              <Eye className="mr-1 h-3 w-3" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSheetType(meta.type);
                                setSheetEditContent(ctx.content);
                                setSheetEditing(true);
                              }}
                            >
                              <Pencil className="mr-1 h-3 w-3" />
                              Edit
                            </Button>
                            {isDeleting ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => deleteContext(meta.type)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteConfirm(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteConfirm(meta.type)}
                              >
                                <Trash2 className="mr-1 h-3 w-3" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* State 1: Empty (not configured) */
                        <div className="flex flex-1 flex-col items-start gap-2">
                          <span className="text-xs italic text-muted-foreground">
                            Not configured
                          </span>
                          <div className="mt-auto flex items-center gap-2">
                            <input
                              ref={(el) => {
                                fileInputRefs.current[meta.type] = el;
                              }}
                              type="file"
                              accept=".md,.txt"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(meta.type, file);
                                e.target.value = "";
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                fileInputRefs.current[meta.type]?.click()
                              }
                            >
                              <Upload className="mr-1 h-3 w-3" />
                              Upload file
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPastingType(meta.type);
                                setPasteContent("");
                              }}
                            >
                              <Type className="mr-1 h-3 w-3" />
                              Paste content
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
        </div>
      </div>
      <FooterBar />

      {/* Sheet slide-out panel (State 3) */}
      <Sheet
        open={sheetType !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSheetType(null);
            setSheetEditing(false);
            setSheetEditContent("");
          }
        }}
      >
        <SheetContent side="right" className="w-[500px] sm:max-w-lg flex flex-col">
          {sheetMeta && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = sheetMeta.icon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                  {sheetMeta.name}
                </SheetTitle>
                <SheetDescription>
                  {sheetCtx ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      {sheetCtx.content.length.toLocaleString()} chars
                      <span className="text-muted-foreground/50">|</span>
                      Updated{" "}
                      {new Date(sheetCtx.updatedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    "No content configured"
                  )}
                </SheetDescription>
              </SheetHeader>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-4">
                {sheetEditing ? (
                  <textarea
                    value={sheetEditContent}
                    onChange={(e) => setSheetEditContent(e.target.value)}
                    className="min-h-[300px] w-full flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                ) : sheetCtx ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
                    {sheetCtx.content}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No content yet. Close this panel and upload or paste content
                    to get started.
                  </p>
                )}
              </div>

              {/* Footer */}
              <SheetFooter>
                {sheetEditing ? (
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() =>
                        sheetType &&
                        saveContext(sheetType, sheetEditContent)
                      }
                      disabled={saving || !sheetEditContent.trim()}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSheetEditing(false);
                        setSheetEditContent("");
                      }}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Cancel
                    </Button>
                  </div>
                ) : sheetCtx ? (
                  <Button variant="outline" onClick={startSheetEdit}>
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                ) : null}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
