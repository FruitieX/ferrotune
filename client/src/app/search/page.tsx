import { Suspense } from "react";
import { SearchPageContent } from "./search-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}

function SearchPageSkeleton() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="px-4 lg:px-6 py-4">
          <Skeleton className="h-12 max-w-xl rounded-full" />
        </div>
      </header>
      <div className="p-4 lg:p-6">
        <div className="py-20 text-center">
          <Skeleton className="w-24 h-24 mx-auto mb-6 rounded-full" />
          <Skeleton className="h-7 w-48 mx-auto mb-2" />
          <Skeleton className="h-5 w-36 mx-auto" />
        </div>
      </div>
    </div>
  );
}
