import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
    />
  );
}

interface LoadingSkeletonProps {
  variant: "card" | "table-row" | "stat-card";
}

export function LoadingSkeleton({ variant }: LoadingSkeletonProps) {
  switch (variant) {
    case "card":
      return (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-4">
            <Bone className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-1/3" />
              <Bone className="h-3 w-2/3" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
          <Bone className="h-3 w-full" />
          <Bone className="h-3 w-4/5" />
        </div>
      );

    case "table-row":
      return (
        <div className="flex items-center gap-4 py-3 px-4">
          <Bone className="h-3 w-1/4" />
          <Bone className="h-3 w-12" />
          <Bone className="h-5 w-14 rounded-full" />
          <Bone className="h-3 w-12" />
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-20" />
        </div>
      );

    case "stat-card":
      return (
        <div className="rounded-xl border p-4 space-y-2">
          <Bone className="h-3 w-20" />
          <Bone className="h-8 w-16" />
        </div>
      );
  }
}
