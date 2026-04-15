"use client";

import { useState } from "react";
import { TagPill } from "./tag-pill";

interface ReportTagsProps {
  checkId: number;
  initialTags: string[];
}

export function ReportTags({ checkId, initialTags }: ReportTagsProps) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const trimmed = value.trim();
    if (!trimmed || tags.includes(trimmed)) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/checks/${checkId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: [trimmed] }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags ?? [...tags, trimmed]);
        setValue("");
      }
    } catch {
      // Silently fail — tag will not be added
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagPill key={tag} name={tag} />
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-muted-foreground">No tags</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Add a tag..."
          className="flex h-8 w-40 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !value.trim()}
          className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}
