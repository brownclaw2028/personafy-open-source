import { useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { GettingStartedChecklist, DISMISS_KEY } from '../components/GettingStartedChecklist';
import {
  Shield,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  Clock,
  ArrowRight,
  Lock,
  Zap,
  Monitor,
  Database,
  Play,
  FlaskConical,
} from 'lucide-react';
import { useVault } from '../lib/VaultProvider';
import { useNow } from '../lib/useNow';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { VaultErrorState } from '../components/VaultErrorState';
import { Sparkline } from '../components/Sparkline';
import { timeAgo, eventType, deriveHighlights, normalizeCompletionScore, formatPurposeDisplay } from '../lib/utils';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const iconToEmoji: Record<string, string> = {
  ShoppingBag: '🛍️',
  Plane: '✈️',
  UtensilsCrossed: '🍽️',
  Activity: '🏃',
  Gift: '🎁',
  Briefcase: '💼',
};

interface HomeProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
  justCompletedSetup?: boolean;
}

export function Home({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
  justCompletedSetup = false,
}: HomeProps) {
  useDocumentTitle('Home');
  const [checklistDismissed, setChecklistDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true',
  );
  const { vault, loading, error, locked, refresh, unlock } = useVault();

  // Tick for time-ago labels. In dev, keep it fast for easy verification.
  const now = useNow(import.meta.env.DEV ? 1000 : 60000);
  const dayKey = Math.floor(now / 86400000);

  // Compute 14-day activity histogram for sparkline (must be before early return)
  // Only recompute when the day changes (or audit log changes), not every tick.
  const activityData = useMemo(() => {
    const days = 14;
    const msPerDay = 86400000;
    const todayStart = dayKey * msPerDay; // Floor to day boundary (UTC)
    const bins = new Array(days).fill(0) as number[];
    const events = (vault?.auditLog ?? []).filter(e => e.purpose && !e.purpose.startsWith('rule_created'));

    for (const e of events) {
      const ts = new Date(e.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      const dayIndex = Math.floor((ts - (todayStart - (days - 1) * msPerDay)) / msPerDay);
      if (dayIndex >= 0 && dayIndex < days) {
        bins[dayIndex]++;
      }
    }
    return bins;
  }, [vault?.auditLog, dayKey]);

  const totalActivity14d = activityData.reduce((a, b) => a + b, 0);

  // Derive persona highlights for the dashboard summary (must be before early returns)
  const highlights = useMemo(
    () => deriveHighlights(vault?.personas ?? [], 4),
    [vault?.personas],
  );

  // Build recent activity from real vault audit log (memoized).
  // Split into two memos: base event data (stable) and time labels (tick-dependent).
  const recentEvents = useMemo(() => (vault?.auditLog || [])
    .filter(e => e.purpose && !e.purpose.startsWith('rule_created'))
    .slice(-5)
    .reverse()
    .map((e) => ({
      id: e.id,
      type: eventType(e),
      domain: e.recipientDomain,
      purpose: formatPurposeDisplay(e.purpose),
      fields: e.fieldsReleased.length,
      timestamp: e.timestamp,
    })), [vault?.auditLog]);

  const recentActivity = useMemo(() => recentEvents.map(e => ({
    ...e,
    time: timeAgo(e.timestamp, now),
  })), [recentEvents, now]);

  // Show skeleton while loading, or if vault hasn't arrived yet (avoids flash of empty content)
  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="home" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={2} />
      </Layout>
    );
  }

  // Show lock screen or error state when vault is inaccessible
  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="home" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const personas = vault?.personas ?? [];
  const totalFacts = personas.reduce((sum, p) => sum + p.facts.length, 0);
  const isNewUser = justCompletedSetup && personas.length === 0 && totalFacts === 0;

  const postureLabels: Record<string, string> = {
    simple_lock: 'Relaxed',
    alarm_system: 'Balanced',
    safe_room: 'Strict',
  };
  const posture = loading
    ? 'Loading...'
    : (vault?.privacyPosture ? (postureLabels[vault.privacyPosture] ?? vault.privacyPosture) : 'Not Set');
  const postureIsSet = !!vault?.privacyPosture;

  const ruleCount = vault?.rules?.filter(r => r.enabled).length || 0;
  const devices = vault?.devices ?? [];
  const connectedDevices = devices.filter(d => d.status === 'connected').length;

  return (
    <Layout
      activeNav="home"
      userName={userName}
      userInitials={userInitials}
      onNavClick={onNavClick}
    >
      <div className="p-8 max-w-6xl animate-fade-in">
        {/* Welcome Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">
            {justCompletedSetup ? 'Welcome to Personafy' : 'Welcome back'}
          </h1>
          <p className="text-text-secondary">
            {justCompletedSetup
              ? "You're all set. Here's what to do next."
              : 'Your vault is active and protecting your personal context.'}
          </p>
        </div>

        {/* Stats Grid — shown first for value-first layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 mb-10 stagger-children">
          <StatCard
            icon={<Shield className="w-5 h-5" />}
            label="Privacy Posture"
            value={posture}
            accent={postureIsSet ? 'text-accent' : 'text-yellow-400'}
            iconBg={postureIsSet ? 'bg-accent/15' : 'bg-yellow-400/15'}
          />
          <StatCard
            icon={<Activity className="w-5 h-5" />}
            label="Active Personas"
            value={isNewUser ? '--' : String(personas.length)}
            accent="text-primary"
            iconBg="bg-primary/15"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Facts Stored"
            value={isNewUser ? '--' : String(totalFacts)}
            accent="text-accent"
            iconBg="bg-accent/15"
          />
          <StatCard
            icon={<Lock className="w-5 h-5" />}
            label="Active Rules"
            value={isNewUser ? '--' : String(ruleCount)}
            accent="text-primary"
            iconBg="bg-primary/15"
          />
          <StatCard
            icon={<Monitor className="w-5 h-5" />}
            label="Paired Devices"
            value={`${connectedDevices}/${devices.length}`}
            accent={connectedDevices > 0 ? 'text-accent' : 'text-yellow-400'}
            iconBg={connectedDevices > 0 ? 'bg-accent/15' : 'bg-yellow-400/15'}
          />
        </div>

        {/* Getting Started Checklist — below stats for value-first layout */}
        {!checklistDismissed && (
          <GettingStartedChecklist
            onNavClick={onNavClick}
            onDismiss={() => setChecklistDismissed(true)}
          />
        )}

        {/* Vault Highlights — derived smart summaries (shown first for value) */}
        {highlights.length > 0 && (
          <div className="glass-card p-6 mb-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Vault Highlights</h2>
                <p className="text-text-tertiary text-sm">Key facts Personafy knows about you</p>
              </div>
              <button
                onClick={() => onNavClick?.('personas')}
                className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors"
              >
                All personas <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {highlights.map((h) => {
                const emoji = iconToEmoji[h.icon] ?? '📦';
                return (
                  <button
                    key={h.personaId}
                    onClick={() => onNavClick?.(`personas/${h.personaId}`)}
                    className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.08] border border-card-border/35 hover:border-accent/30 transition-all text-left group"
                  >
                    <span role="img" aria-hidden="true" className="text-xl mt-0.5">{emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium mb-1 group-hover:text-accent transition-colors">{h.personaName}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {h.snippets.map((s, i) => (
                          <span
                            key={i}
                            className="text-[11px] px-2 py-0.5 bg-white/[0.05] border border-card-border/15 rounded-full text-text-secondary truncate max-w-[160px]"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Activity Sparkline */}
        <div className="glass-card p-6 mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Activity — Last 14 Days</h2>
              <p className="text-text-tertiary text-sm">
                {totalActivity14d} context {totalActivity14d === 1 ? 'request' : 'requests'}
              </p>
            </div>
            <button
              onClick={() => onNavClick?.('audit')}
              className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors"
            >
              Audit log <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <Sparkline
            data={activityData}
            width={760}
            height={64}
            strokeColor="#0172ED"
            fillColorStart="rgba(1, 114, 237, 0.25)"
            fillColorEnd="rgba(1, 114, 237, 0)"
            strokeWidth={2}
            showDots={totalActivity14d <= 30}
            label={`${totalActivity14d} vault requests over 14 days`}
          />
          {/* Day labels */}
          <div className="flex justify-between mt-2 text-text-tertiary text-[10px] select-none">
            <span>14d ago</span>
            <span>7d ago</span>
            <span>Today</span>
          </div>
          {totalActivity14d === 0 && justCompletedSetup && (
            <p className="text-text-tertiary text-xs mt-1">
              Activity shows up here as AI apps interact with your data.
            </p>
          )}
        </div>

        {/* Persona Completion Overview */}
        {personas.length > 0 && (
          <div className="glass-card p-6 mb-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Persona Coverage</h2>
              <button
                onClick={() => onNavClick?.('personas')}
                className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 stagger-children">
              {personas.map((p) => {
                const score = normalizeCompletionScore(p.completionScore ?? 0);
                const pct = Math.min(100, Math.max(0, Math.round(score * 100)));
                const color = pct >= 80 ? 'text-accent' : pct >= 60 ? 'text-yellow-400' : 'text-primary';
                const bg = pct >= 80 ? 'bg-accent' : pct >= 60 ? 'bg-yellow-400' : 'bg-primary';
                const emoji = iconToEmoji[p.icon] ?? '📦';
                return (
                  <button
                    key={p.id}
                    onClick={() => onNavClick?.(`personas/${p.id}`)}
                    className="p-3 rounded-xl bg-white/[0.08] border border-card-border/35 hover:border-accent/30 transition-all text-center group"
                  >
                    <span role="img" aria-hidden="true" className="text-2xl mb-1.5 block">{emoji}</span>
                    <div className="text-white text-xs font-medium mb-1 truncate">{p.name}</div>
                    <div className="text-text-tertiary text-[10px] mb-2">{p.facts.length} facts</div>
                    <div
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${p.name} completion`}
                      className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden"
                    >
                      <div className={`h-full ${bg} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className={`text-[10px] mt-1 ${color} font-medium`}>{pct}%</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          <div className="lg:col-span-2">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">
                  Recent Activity
                </h2>
                <button
                  onClick={() => onNavClick?.('audit')}
                  className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors"
                >
                  View all <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              {recentActivity.length > 0 ? (
                <div className="space-y-4">
                  {recentActivity.map((event) => (
                    <ActivityRow key={event.id} event={event} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Activity className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-text-secondary text-sm mb-1">Nothing here yet</p>
                  <p className="text-text-secondary text-xs">
                    When an AI app asks for your info, you'll see it here.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-6">
            {/* Vault Health */}
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Vault Health
              </h2>
              <div className="space-y-3">
                <HealthItem label="Encryption" status="active" />
                <HealthItem label="Auto-expire" status="active" />
                <HealthItem label="Audit logging" status="active" />
                <HealthItem label="Device pairing" status={connectedDevices > 0 ? 'active' : 'pending'} />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                {isNewUser ? 'Get Started' : 'Quick Actions'}
              </h2>
              <div className="space-y-2">
                {isNewUser ? (
                  <>
                    <QuickAction
                      icon={<Activity className="w-4 h-4" />}
                      label="View Personas"
                      onClick={() => onNavClick?.('personas')}
                    />
                    <QuickAction
                      icon={<Play className="w-4 h-4" />}
                      label="Try the Demo"
                      onClick={() => onNavClick?.('demo')}
                    />
                    <QuickAction
                      icon={<Zap className="w-4 h-4" />}
                      label="Set Up Rules"
                      onClick={() => onNavClick?.('rules')}
                    />
                  </>
                ) : (
                  <>
                    <QuickAction
                      icon={<Zap className="w-4 h-4" />}
                      label="Manage Rules"
                      onClick={() => onNavClick?.('rules')}
                    />
                    <QuickAction
                      icon={<Activity className="w-4 h-4" />}
                      label="View Personas"
                      onClick={() => onNavClick?.('personas')}
                    />
                    <QuickAction
                      icon={<Shield className="w-4 h-4" />}
                      label="Review Approvals"
                      onClick={() => onNavClick?.('approvals')}
                    />
                    <QuickAction
                      icon={<Monitor className="w-4 h-4" />}
                      label="Manage Devices"
                      onClick={() => onNavClick?.('devices')}
                    />
                    <QuickAction
                      icon={<Database className="w-4 h-4" />}
                      label="Browse Sample Data"
                      onClick={() => onNavClick?.('data-browser')}
                    />
                    <QuickAction
                      icon={<Play className="w-4 h-4" />}
                      label="Interactive Demo"
                      onClick={() => onNavClick?.('demo')}
                    />
                    {import.meta.env.DEV && localStorage.getItem('dev_mode') === 'true' && (
                      <QuickAction
                        icon={<FlaskConical className="w-4 h-4" />}
                        label="Extraction Lab"
                        onClick={() => onNavClick?.('extraction-lab')}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ---- Sub-components ---- */

function StatCard({
  icon,
  label,
  value,
  accent,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  iconBg: string;
}) {
  return (
    <div className="glass-card p-5 group hover:border-accent/30 transition-all duration-300">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </div>
      </div>
      <div className={`text-2xl font-bold ${accent} mb-1`}>{value}</div>
      <div className="text-text-tertiary text-sm">{label}</div>
    </div>
  );
}

function ActivityRow({
  event,
}: {
  event: {
    type: 'approved' | 'denied' | 'auto_allowed';
    domain: string;
    purpose: string;
    fields: number;
    time: string;
  };
}) {
  const config = {
    approved: {
      icon: <CheckCircle className="w-5 h-5 text-accent" />,
      bg: 'bg-accent/10',
      label: 'Approved',
      labelColor: 'text-accent',
    },
    auto_allowed: {
      icon: <Zap className="w-5 h-5 text-primary" />,
      bg: 'bg-primary/10',
      label: 'Auto-allowed',
      labelColor: 'text-primary',
    },
    denied: {
      icon: <XCircle className="w-5 h-5 text-red-400" />,
      bg: 'bg-red-400/10',
      label: 'Denied',
      labelColor: 'text-red-400',
    },
  }[event.type];

  return (
    <div className="flex items-center gap-4 py-3 border-b border-card-border/35 last:border-0">
      <div className={`w-10 h-10 ${config.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate">{event.domain}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.labelColor}`}>
            {config.label}
          </span>
        </div>
        <div className="text-text-tertiary text-sm truncate">
          {event.purpose} · {event.fields} fields
        </div>
      </div>
      <div className="text-text-tertiary text-xs flex items-center gap-1 flex-shrink-0">
        <Clock className="w-3 h-3" />
        {event.time}
      </div>
    </div>
  );
}

function HealthItem({
  label,
  status,
}: {
  label: string;
  status: 'active' | 'pending' | 'error';
}) {
  const colors = {
    active: 'bg-accent text-accent',
    pending: 'bg-yellow-400 text-yellow-400',
    error: 'bg-red-400 text-red-400',
  }[status];
  const [dotColor, textColor] = colors.split(' ');

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-text-secondary text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className={`text-xs capitalize ${textColor}`}>{status}</span>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.08] border border-card-border/35 hover:border-accent/40 hover:bg-white/[0.12] transition-all duration-200 text-left group"
    >
      <span className="text-text-tertiary group-hover:text-accent transition-colors">
        {icon}
      </span>
      <span className="text-text-secondary group-hover:text-white text-sm font-medium transition-colors">
        {label}
      </span>
      <ArrowRight className="w-4 h-4 text-text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
