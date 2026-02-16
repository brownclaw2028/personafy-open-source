interface ProgressBarProps {
  progress: number; // 0-100
  className?: string;
  label?: string;
}

export function ProgressBar({ progress, className = '', label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className={`relative w-full ${className}`}>
      {/* Background */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="w-full h-3 bg-white/10 rounded-full overflow-hidden"
      >
        {/* Progress Fill */}
        <div
          className="h-full bg-gradient-primary transition-all duration-500 ease-out rounded-full relative overflow-hidden"
          style={{ width: `${clamped}%` }}
        >
          {/* Shine Effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shine" />
        </div>
      </div>

      {/* Progress Text */}
      <div className="flex justify-between items-center mt-2 text-sm">
        <span className="text-white/60">Processing...</span>
        <span className="text-white font-medium">{Math.round(clamped)}%</span>
      </div>

      {/* Glow Effect */}
      <div
        className="absolute top-0 left-0 h-3 bg-gradient-primary rounded-full opacity-30 blur-sm transition-all duration-500 pointer-events-none"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
