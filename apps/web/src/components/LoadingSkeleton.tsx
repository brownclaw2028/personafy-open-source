/**
 * Shimmer loading skeletons for vault data loading states.
 */

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`glass-card p-5 animate-pulse ${className}`}>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-white/10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-white/10 rounded w-1/3" />
          <div className="h-3 bg-white/10 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="glass-card p-4 animate-pulse">
      <div className="h-7 bg-white/10 rounded w-12 mb-2" />
      <div className="h-3 bg-white/10 rounded w-20" />
    </div>
  );
}

export function SkeletonPage({ cards = 3, stats = 3 }: { cards?: number; stats?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading content" className="p-8 max-w-5xl animate-fade-in">
      {/* Header skeleton */}
      <div className="mb-8 animate-pulse">
        <div className="h-8 bg-white/10 rounded w-48 mb-3" />
        <div className="h-4 bg-white/10 rounded w-96" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {Array.from({ length: stats }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
