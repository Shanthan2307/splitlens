import { HeaderSkeleton, ListSkeleton } from "@/components/shell/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-8">
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <ListSkeleton rows={3} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
