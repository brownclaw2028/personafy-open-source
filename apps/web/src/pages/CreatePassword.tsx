import { useState, type FormEvent } from 'react';
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Info,
} from 'lucide-react';
import { SetupProgress } from '../components/SetupProgress';
import { getPasswordStrength } from '../lib/password-strength';

interface CreatePasswordProps {
  onPasswordSet: (password: string) => void;
  onBack?: () => void;
}

export function CreatePassword({ onPasswordSet, onBack }: CreatePasswordProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const strength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const isValid = password.length >= 8 && passwordsMatch;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setConfirmTouched(true);
    if (!isValid) return;
    onPasswordSet(password);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <SetupProgress currentStep={2} />

      <div className="w-full max-w-lg animate-fade-in">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-glow">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Set Your Password</h1>
          <p className="text-text-secondary text-lg">
            This locks your personal data. Pick something you'll remember.
          </p>
        </div>

        {/* Form Card */}
        <form onSubmit={handleSubmit} className="glass-card p-8 space-y-6">
          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-2">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched(true)}
                className={`w-full px-4 py-3 pr-12 bg-white/[0.12] border rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors ${
                  touched && password.length > 0 && password.length < 8
                    ? 'border-red-400/50 focus:border-red-400 focus:ring-red-400/20'
                    : 'border-card-border/60 focus:border-accent/50'
                }`}
                placeholder="Enter a strong password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            </div>
            {/* Validation error */}
            {touched && password.length > 0 && password.length < 8 && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Password must be at least 8 characters
              </p>
            )}
            {/* Strength indicator */}
            {password.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        level <= strength.level
                          ? strength.color
                          : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-xs ${strength.textColor}`}>
                  {strength.label}
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-text-secondary mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                className={`w-full px-4 py-3 pr-12 bg-white/[0.12] border rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors ${
                  confirmTouched && confirmPassword.length > 0 && !passwordsMatch
                    ? 'border-red-400/50 focus:border-red-400 focus:ring-red-400/20'
                    : 'border-card-border/60 focus:border-accent/50'
                }`}
                placeholder="Confirm your password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-white transition-colors"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            </div>
            <div className="min-h-[24px] mt-1.5">
              {confirmTouched && confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Passwords don&apos;t match
                </p>
              )}
              {passwordsMatch && (
                <p className="text-xs text-accent flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Passwords match
                </p>
              )}
            </div>
          </div>

          {/* Info Notes */}
          <div className="space-y-3">
            <div className="flex gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="text-amber-400 font-medium mb-1">
                  There's no "forgot password"
                </p>
                <p className="text-text-tertiary">
                  Not even we can reset it. That's how we keep your data private.
                  Write it down somewhere safe.
                </p>
              </div>
            </div>
            <div className="flex gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-text-tertiary text-xs leading-relaxed">
                Everything stays on this device. You can export or delete
                your data anytime from Settings.
              </p>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!isValid}
            className={`w-full py-3.5 rounded-lg font-semibold text-white flex items-center justify-center gap-2 transition-all ${
              isValid
                ? 'bg-gradient-primary hover:shadow-glow cursor-pointer'
                : 'bg-white/10 cursor-not-allowed text-text-tertiary'
            }`}
          >
            Set Password & Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Back + Footer */}
        <div className="flex flex-col items-center gap-4 mt-6">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-text-tertiary hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
          <p className="text-text-tertiary text-xs">
            Your data is locked on this device. Not even we can see it.
          </p>
        </div>
      </div>
    </div>
  );
}
