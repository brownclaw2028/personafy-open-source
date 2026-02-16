import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react';
import { Layout } from '../components/Layout';
import { useVault, type VaultPersona } from '../lib/VaultProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { normalizeCompletionScore } from '../lib/utils';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';
import {
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Briefcase,
  Activity,
  Gift,
  Shield,
  Plus,
  X,
  Upload,
  type LucideIcon,
} from 'lucide-react';

interface PersonasProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
  onPersonaClick?: (persona: VaultPersona) => void;
}

const iconMap: Record<string, LucideIcon> = {
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Briefcase,
  Activity,
  Gift,
};

const categoryOptions = [
  { value: 'Shopping', icon: 'ShoppingBag', label: 'Shopping' },
  { value: 'Travel', icon: 'Plane', label: 'Travel' },
  { value: 'Food & Dining', icon: 'UtensilsCrossed', label: 'Food & Dining' },
  { value: 'Work', icon: 'Briefcase', label: 'Work' },
  { value: 'Fitness', icon: 'Activity', label: 'Fitness' },
  { value: 'Gift Giving', icon: 'Gift', label: 'Gift Giving' },
] as const;

const filterCategories = ['All', 'Shopping', 'Travel', 'Food & Dining', 'Work', 'Fitness', 'Gift Giving'] as const;

export function Personas({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
  onPersonaClick,
}: PersonasProps) {
  useDocumentTitle('Personas');
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showCreate, setShowCreate] = useState(false);

  const personas = useMemo(() => vault?.personas ?? [], [vault?.personas]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: personas.length };
    for (const p of personas) {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    return counts;
  }, [personas]);

  const filtered = activeFilter === 'All'
    ? personas
    : personas.filter(p => p.category === activeFilter);

  useEffect(() => {
    const handleKeyboardNew = (event: Event) => {
      event.preventDefault();
      setShowCreate(true);
    };
    const handleKeyboardEdit = (event: Event) => {
      event.preventDefault();
      if (filtered.length > 0) {
        onPersonaClick?.(filtered[0]);
      }
    };
    window.addEventListener('keyboard:new', handleKeyboardNew as EventListener);
    window.addEventListener('keyboard:edit', handleKeyboardEdit as EventListener);
    return () => {
      window.removeEventListener('keyboard:new', handleKeyboardNew as EventListener);
      window.removeEventListener('keyboard:edit', handleKeyboardEdit as EventListener);
    };
  }, [filtered, onPersonaClick]);

  // Show skeleton while loading, or if vault hasn't arrived yet (avoids flash of empty content)
  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={6} />
      </Layout>
    );
  }

  // Show lock screen or error state when vault is inaccessible
  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const statsScope = filtered;
  const totalFacts = statsScope.reduce((s, p) => s + p.facts.length, 0);
  const avgCompletion = statsScope.length
    ? Math.round((statsScope.reduce((s, p) => s + normalizeCompletionScore(p.completionScore ?? 0), 0) / statsScope.length) * 100)
    : 0;

  const getCompletionColor = (score: number) => {
    if (score >= 0.8) return 'from-green-500 to-green-400';
    if (score >= 0.6) return 'from-yellow-500 to-yellow-400';
    return 'from-blue-500 to-blue-400';
  };

  const getCompletionText = (score: number) => {
    const pct = Math.round(score * 100);
    if (pct >= 80) return `Strong`;
    if (pct >= 60) return `Growing`;
    return `Getting Started`;
  };

  const handleCreate = async (name: string, category: string, description: string) => {
    if (!vault) return;
    const icon = categoryOptions.find(c => c.value === category)?.icon ?? 'ShoppingBag';
    const newPersona: VaultPersona = {
      id: `persona_${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      category,
      icon,
      description: description.trim(),
      completionScore: 0,
      facts: [],
    };
    const ok = await save({ ...vault, personas: [...vault.personas, newPersona] });
    if (ok) {
      setShowCreate(false);
      toast(`${newPersona.name} persona created`);
    } else {
      toast('Failed to create persona', 'error');
    }
  };

  return (
    <Layout
      activeNav="personas"
      userName={userName}
      userInitials={userInitials}
      onNavClick={onNavClick}
    >
      <div className="p-8 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Personas</h1>
            <p className="text-text-secondary">
              Your digital personalities based on conversation patterns
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-primary text-white rounded-xl text-sm font-medium shadow-glow hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Create Persona
          </button>
        </div>

        {/* Filter Chips */}
        <div className="flex gap-3 mb-8 overflow-x-auto pb-2 scrollbar-hide md:flex-wrap md:overflow-visible md:pb-0">
          {filterCategories.map((cat) => {
            const isActive = activeFilter === cat;
            const count = categoryCounts[cat] ?? 0;
            return (
              <button
                key={cat}
                onClick={() => setActiveFilter(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex-shrink-0 whitespace-nowrap ${
                  isActive
                    ? 'bg-primary text-white shadow-glow'
                    : 'bg-card border border-card-border/50 text-text-secondary hover:text-white hover:border-accent/50'
                }`}
              >
                {cat}
                {count > 0 && (
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    isActive ? 'bg-white/20 text-white' : 'bg-accent/20 text-accent'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 stagger-children">
            {filtered.map((persona, index) => {
              const Icon = iconMap[persona.icon] ?? ShoppingBag;
              const score = normalizeCompletionScore(persona.completionScore ?? 0);
              return (
                <div
                  key={persona.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPersonaClick?.(persona)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPersonaClick?.(persona); } }}
                  className="glass-card gradient-border p-6 transition-all duration-300 cursor-pointer group hover:scale-105 animate-fade-in relative outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Icon */}
                  <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center group-hover:shadow-glow-accent transition-all duration-300">
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                  </div>

                  {/* Name */}
                  <div className="text-center mb-3">
                    <h3 className="text-xl font-bold mb-1 text-white">{persona.name}</h3>
                    <p className="text-text-secondary text-sm">{persona.description}</p>
                  </div>

                  {/* Fact Count */}
                  <div className="flex justify-center mb-4">
                    <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-xs font-medium">
                      {persona.facts.length} fact{persona.facts.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Completion Bar */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-text-tertiary">Profile Strength</span>
                      <span className="text-xs font-medium text-text-secondary">
                        {getCompletionText(score)}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${getCompletionColor(score)} transition-all duration-1000 ease-out`}
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(score * 100)))}%` }}
                      />
                    </div>
                  </div>

                  {/* Card itself is interactive; this is visual affordance only */}
                  <div
                    aria-hidden="true"
                    className="w-full btn-secondary py-2 text-sm font-medium text-center group-hover:border-accent group-hover:bg-accent/10"
                  >
                    View Details
                  </div>

                  {/* Hover Glow */}
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/20 to-accent/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="glass-card p-8 max-w-md mx-auto">
              <Shield className="w-16 h-16 text-text-tertiary mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No personas found</h3>
              <p className="text-text-secondary text-sm mb-4">
                {activeFilter === 'All'
                  ? 'Create your first persona or import conversation data to get started.'
                  : `No personas found in the ${activeFilter} category.`}
              </p>
              {activeFilter === 'All' && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-primary text-white rounded-xl text-sm font-medium shadow-glow hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Create Persona
                  </button>
                  <button
                    onClick={() => onNavClick?.('sources')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 border border-card-border/50 text-text-secondary rounded-xl text-sm font-medium hover:text-white hover:border-accent/40 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Import Data
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        {statsScope.length > 0 && (
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card p-6 text-center">
              <div className="text-2xl font-bold text-white mb-1">{statsScope.length}</div>
              <div className="text-text-secondary text-sm">
                {activeFilter === 'All' ? 'Active Personas' : `${activeFilter} Personas`}
              </div>
            </div>
            <div className="glass-card p-6 text-center">
              <div className="text-2xl font-bold text-accent mb-1">{totalFacts}</div>
              <div className="text-text-secondary text-sm">
                {activeFilter === 'All' ? 'Total Facts' : `${activeFilter} Facts`}
              </div>
            </div>
            <div className="glass-card p-6 text-center">
              <div className="text-2xl font-bold text-primary mb-1">{avgCompletion}%</div>
              <div className="text-text-secondary text-sm">Avg Completion</div>
            </div>
          </div>
        )}
      </div>

      {/* Create Persona Modal */}
      {showCreate && (
        <CreatePersonaModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </Layout>
  );
}

/* ── Create Persona Modal ─────────────────────────────────────── */

function CreatePersonaModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, category: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<(typeof categoryOptions)[number]['value']>(categoryOptions[0].value);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus name input + Escape to close
  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const canSubmit = name.trim().length > 0 && !saving;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    await onCreate(name, category, description);
    setSaving(false);
  };

  const selectedIcon = categoryOptions.find(c => c.value === category)?.icon ?? 'ShoppingBag';
  const Icon = iconMap[selectedIcon] ?? ShoppingBag;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create Persona"
        className="relative bg-card border border-card-border/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-card-border/35">
          <h2 className="text-xl font-bold text-white">Create Persona</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-text-tertiary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex justify-center pt-6 pb-2">
          <div className="w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center shadow-glow">
            <Icon className="w-8 h-8 text-white" />
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="persona-name" className="block text-sm font-medium text-text-secondary mb-1.5">
              Name
            </label>
            <input
              ref={nameRef}
              id="persona-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Running Gear, Budget Travel"
              maxLength={50}
              className="w-full px-4 py-2.5 bg-background border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm"
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="persona-category" className="block text-sm font-medium text-text-secondary mb-1.5">
              Category
            </label>
            <div className="grid grid-cols-3 gap-2">
              {categoryOptions.map((opt) => {
                const OptIcon = iconMap[opt.icon] ?? ShoppingBag;
                const isSelected = category === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCategory(opt.value)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all duration-200 ${
                      isSelected
                        ? 'bg-primary/20 border border-primary text-white'
                        : 'bg-background border border-card-border/50 text-text-tertiary hover:text-white hover:border-accent/40'
                    }`}
                  >
                    <OptIcon className={`w-5 h-5 ${isSelected ? 'text-primary' : ''}`} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="persona-desc" className="block text-sm font-medium text-text-secondary mb-1.5">
              Description <span className="text-text-tertiary">(optional)</span>
            </label>
            <textarea
              id="persona-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this persona about?"
              rows={2}
              maxLength={200}
              className="w-full px-4 py-2.5 bg-background border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-card-border/50 rounded-xl text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                canSubmit
                  ? 'bg-gradient-primary text-white shadow-glow hover:opacity-90'
                  : 'bg-card text-text-tertiary cursor-not-allowed'
              }`}
            >
              {saving ? 'Creating…' : 'Create Persona'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
