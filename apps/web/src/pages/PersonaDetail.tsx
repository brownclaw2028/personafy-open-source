import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import {
  ArrowLeft,
  Shield,
  Edit3,
  Trash2,
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Briefcase,
  Activity,
  Gift,
  FileText,
  Share2,
  Settings,
  Sparkles,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import { useVault, type VaultFact, type PersonaSettings } from '../lib/VaultProvider';
import { VaultErrorState } from '../components/VaultErrorState';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useState, useCallback, type KeyboardEvent } from 'react';
import { toast } from '../components/Toast';
import { computeCompletionScore, normalizeCompletionScore } from '../lib/utils';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { normalizeFactKey } from '../lib/factKeys';
import { FactsPanel } from '../components/persona/FactsPanel';
import { SharingPanel } from '../components/persona/SharingPanel';
import { PersonaSettingsPanel } from '../components/persona/PersonaSettingsPanel';

/** Suggested fields per persona category to help users fill out their profile */
const SUGGESTED_FIELDS: Record<string, { key: string; label: string; example: string }[]> = {
  Shopping: [
    { key: 'apparel.fit_preference', label: 'Fit preference', example: 'slim fit, regular, relaxed' },
    { key: 'apparel.pants.waist', label: 'Pants waist size', example: '32' },
    { key: 'apparel.pants.inseam', label: 'Pants inseam', example: '30' },
    { key: 'apparel.shirt.size', label: 'Shirt size', example: 'Medium, L, XL' },
    { key: 'apparel.shoe.size', label: 'Shoe size', example: '10.5' },
    { key: 'apparel.preferred_brands', label: 'Preferred brands', example: 'J.Crew, Nike, Patagonia' },
    { key: 'budget.monthly_clothing', label: 'Monthly clothing budget', example: '$100-200' },
    { key: 'apparel.style_preference', label: 'Style preference', example: 'casual, business casual' },
  ],
  Travel: [
    { key: 'flight.seat_preference', label: 'Seat preference', example: 'window, aisle' },
    { key: 'hotel.room_preference', label: 'Hotel preference', example: 'boutique, chain, Airbnb' },
    { key: 'travel.loyalty_programs', label: 'Loyalty programs', example: 'United MileagePlus, Marriott' },
    { key: 'travel.favorite_destinations', label: 'Favorite destinations', example: 'Tokyo, Paris' },
    { key: 'travel.frequency', label: 'Travel frequency', example: 'monthly, quarterly' },
    { key: 'travel.budget_per_trip', label: 'Typical trip budget', example: '$1000-2000' },
  ],
  'Food & Dining': [
    { key: 'dietary.restrictions', label: 'Dietary restrictions', example: 'vegetarian, gluten-free' },
    { key: 'dietary.allergies', label: 'Food allergies', example: 'peanuts, shellfish' },
    { key: 'food.favorite_cuisines', label: 'Favorite cuisines', example: 'Italian, Japanese, Mexican' },
    { key: 'food.coffee_preferences', label: 'Coffee preferences', example: 'oat milk latte, black coffee' },
  ],
  Work: [
    { key: 'work.tools', label: 'Tools you use', example: 'Notion, Slack, Figma' },
    { key: 'work.communication_style', label: 'Communication style', example: 'async-first, brief' },
    { key: 'work.productivity_preference', label: 'Work style', example: 'deep work mornings' },
  ],
  Fitness: [
    { key: 'fitness.frequency', label: 'Workout frequency', example: '3-4x per week' },
    { key: 'fitness.goal', label: 'Fitness goals', example: 'build strength, run 5K' },
    { key: 'fitness.activities', label: 'Preferred activities', example: 'running, yoga, weightlifting' },
    { key: 'fitness.running_shoes', label: 'Running shoe preference', example: 'Nike Pegasus, Brooks' },
  ],
  'Gift Giving': [
    { key: 'gifts.partner_interests', label: 'Partner interests', example: 'books, cooking, hiking' },
    { key: 'gifts.mom_interests', label: 'Mom interests', example: 'gardening, puzzles' },
    { key: 'budget.gift_range', label: 'Typical gift budget', example: '$50-100' },
  ],
};

/** Get suggested fields that haven't been filled yet */
function getMissingSuggestions(
  category: string,
  existingFacts: VaultFact[],
  maxSuggestions = 3
): { key: string; label: string; example: string }[] {
  const suggestions = SUGGESTED_FIELDS[category] ?? [];
  const existingKeys = new Set(existingFacts.map((f) => normalizeFactKey(f.key)));
  
  return suggestions
    .filter((s) => !existingKeys.has(normalizeFactKey(s.key)))
    .slice(0, maxSuggestions);
}

interface PersonaDetailProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

const iconMap: Record<string, LucideIcon> = {
  ShoppingBag, Plane, UtensilsCrossed, Briefcase, Activity, Gift,
};

type TabId = 'facts' | 'sharing' | 'settings';

const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'facts', label: 'Facts', icon: FileText },
  { id: 'sharing', label: 'Sharing History', icon: Share2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function PersonaDetail({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: PersonaDetailProps) {
  const { personaId } = useParams();
  const navigate = useNavigate();
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  // Visibility overrides for high-sensitivity facts.
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TabId>('facts');
  const [editingFact, setEditingFact] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingPersona, setEditingPersona] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const persona = vault?.personas.find((p) => p.id === personaId);
  useDocumentTitle(persona?.name ?? 'Persona');

  const updatePersonaFacts = async (newFacts: VaultFact[]): Promise<boolean> => {
    if (!vault || !persona) return false;
    const newScore = computeCompletionScore(persona.category, newFacts);
    const updatedPersonas = vault.personas.map((p) =>
      p.id === persona.id ? { ...p, facts: newFacts, completionScore: newScore } : p
    );
    const ok = await save({ ...vault, personas: updatedPersonas });
    return ok ?? false;
  };

  const handleDeleteFact = async (index: number) => {
    if (!persona) return;
    if (index < 0 || index >= persona.facts.length) return;
    const newFacts = persona.facts.filter((_, i) => i !== index);
    const ok = await updatePersonaFacts(newFacts);
    if (ok) toast('Fact deleted');
    else toast('Failed to delete fact', 'error');
  };

  const handleEditFact = async (index: number, newValue: string) => {
    if (!persona) return;
    if (index < 0 || index >= persona.facts.length) return;
    if (!newValue.trim()) return;
    const newFacts = persona.facts.map((f, i) =>
      i === index ? { ...f, value: newValue.trim() } : f
    );
    const ok = await updatePersonaFacts(newFacts);
    if (ok) {
      setEditingFact(null);
      toast('Fact updated');
    } else {
      toast('Failed to update fact', 'error');
    }
  };

  const handleAddFact = async (fact: VaultFact) => {
    if (!persona) return;
    const ok = await updatePersonaFacts([...persona.facts, fact]);
    if (ok) toast('Fact added');
    else toast('Failed to add fact', 'error');
  };

  const handleDeletePersona = async () => {
    if (!vault || !persona) return;
    const updatedPersonas = vault.personas.filter((p) => p.id !== persona.id);
    const ok = await save({ ...vault, personas: updatedPersonas });
    if (ok) {
      toast(`${persona.name} persona deleted`);
      navigate('/personas');
    } else {
      toast('Failed to delete persona', 'error');
    }
  };

  const startEditPersona = () => {
    if (!persona) return;
    setEditName(persona.name);
    setEditDescription(persona.description);
    setEditingPersona(true);
  };

  const saveEditPersona = async () => {
    if (!vault || !persona || !editName.trim()) return;
    const updatedPersonas = vault.personas.map((p) =>
      p.id === persona.id
        ? { ...p, name: editName.trim(), description: editDescription.trim() }
        : p
    );
    const ok = await save({ ...vault, personas: updatedPersonas });
    if (ok) {
      setEditingPersona(false);
      toast('Persona updated');
    } else {
      toast('Failed to update persona', 'error');
    }
  };

  const handleSavePersonaSettings = useCallback(async (newSettings: PersonaSettings) => {
    if (!vault || !persona) return;
    const updatedPersonas = vault.personas.map((p) =>
      p.id === persona.id ? { ...p, personaSettings: newSettings } : p
    );
    const ok = await save({ ...vault, personas: updatedPersonas });
    if (ok) toast('Settings saved');
    else toast('Failed to save settings', 'error');
  }, [vault, persona, save]);

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={3} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  if (!persona) {
    return (
      <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <div className="p-8 flex flex-col items-center justify-center h-full">
          <Shield className="w-16 h-16 text-text-tertiary mb-4" />
          <h2 className="text-xl text-white font-bold mb-2">Persona not found</h2>
          <button onClick={() => navigate('/personas')} className="text-accent hover:text-accent/80 text-sm">
            ← Back to Personas
          </button>
        </div>
      </Layout>
    );
  }

  const Icon = iconMap[persona.icon] ?? ShoppingBag;
  // Build a stable flat index map for each fact (persona-level index avoids key:value collisions).
  const factIndexMap = new Map<VaultFact, number>();
  persona.facts.forEach((f, i) => factIndexMap.set(f, i));

  const hideHighSensitivity = vault?.settings?.hideHighSensitivity ?? true;
  const defaultHighVisible = !hideHighSensitivity;
  const toggleValue = (id: string) =>
    setShowValues((prev) => {
      const current = prev[id];
      const next = current === undefined ? !defaultHighVisible : !current;
      return { ...prev, [id]: next };
    });

  const sensitivityCounts = {
    low: persona.facts.filter((f) => f.sensitivity === 'low').length,
    medium: persona.facts.filter((f) => f.sensitivity === 'medium').length,
    high: persona.facts.filter((f) => f.sensitivity === 'high').length,
  };

  const completionScore = normalizeCompletionScore(persona.completionScore ?? 0);
  const completionPct = Math.min(100, Math.max(0, Math.round(completionScore * 100)));

  // Find sharing history: audit events where released fields match this persona's facts
  const personaFactKeys = new Set(persona.facts.map((f) => normalizeFactKey(f.key)));
  const sharingHistory = (vault?.auditLog ?? [])
    .filter((e) => !e.purpose?.startsWith('rule_created') && e.fieldsReleased?.some((f) => personaFactKeys.has(f)))
    .reverse();

  return (
    <Layout activeNav="personas" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-4xl animate-fade-in">
        {/* Back */}
        <button
          onClick={() => navigate('/personas')}
          className="flex items-center gap-2 text-text-secondary hover:text-white text-sm mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Personas
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-primary rounded-2xl flex items-center justify-center flex-shrink-0">
              <Icon className="w-8 h-8 text-white" />
            </div>
            {editingPersona ? (
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  className="w-full text-2xl font-bold bg-card border border-card-border/50 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-accent/50"
                />
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full text-sm bg-card border border-card-border/50 rounded-lg px-3 py-1.5 text-text-secondary focus:outline-none focus:border-accent/50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveEditPersona}
                    disabled={!editName.trim()}
                    className="px-3 py-1 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPersona(false)}
                    className="px-3 py-1 rounded-lg border border-card-border/50 text-text-secondary text-xs font-medium hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-3xl font-bold text-white">{persona.name}</h1>
                <p className="text-text-secondary">{persona.description}</p>
              </div>
            )}
          </div>
          {!editingPersona && (
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={startEditPersona}
                aria-label="Edit persona"
                className="p-2 rounded-lg bg-card border border-card-border/50 text-text-tertiary hover:text-white hover:border-accent/40 transition-colors"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleDeletePersona}
                    className="px-3 py-1.5 rounded-lg bg-red-400/10 border border-red-400/30 text-red-400 text-xs font-medium hover:bg-red-400/20 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 rounded-lg border border-card-border/50 text-text-tertiary text-xs font-medium hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete persona"
                  className="p-2 rounded-lg bg-card border border-card-border/50 text-text-tertiary hover:text-red-400 hover:border-red-400/40 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-white mb-0.5">{persona.facts.length}</div>
            <div className="text-text-tertiary text-xs">Total Facts</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-accent mb-0.5">{sensitivityCounts.low}</div>
            <div className="text-text-tertiary text-xs">🟢 Low</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-yellow-400 mb-0.5">{sensitivityCounts.medium}</div>
            <div className="text-text-tertiary text-xs">🟡 Medium</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-red-400 mb-0.5">{sensitivityCounts.high}</div>
            <div className="text-text-tertiary text-xs">🔴 High</div>
          </div>
        </div>

        {/* Profile Strength */}
        <div className="glass-card p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-text-secondary text-sm font-medium">Profile Strength</span>
            <span className="text-white font-bold">{completionPct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={completionPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${persona.name} profile strength`}
            className="w-full h-2 bg-card rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>

        {/* Completion Prompt - shown when < 50% or fewer than 5 facts */}
        {(completionPct < 50 || persona.facts.length < 5) && (
          <div className="glass-card p-5 mb-8 border border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold mb-1">
                  {persona.facts.length < 5 
                    ? `Add ${5 - persona.facts.length} more fact${5 - persona.facts.length !== 1 ? 's' : ''} to improve your profile`
                    : 'Keep building your profile!'}
                </h3>
                <p className="text-text-secondary text-sm mb-4">
                  More details help AI assistants give you better, more personalized recommendations.
                </p>
                
                {/* Suggested fields */}
                {(() => {
                  const suggestions = getMissingSuggestions(persona.category, persona.facts);
                  if (suggestions.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-text-tertiary text-xs font-medium mb-2">
                        <Lightbulb className="w-3.5 h-3.5" />
                        Suggested fields to add:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => {
                              setActiveTab('facts');
                              // Scroll to add fact section (facts panel handles the add UI)
                            }}
                            className="group px-3 py-1.5 rounded-lg bg-card border border-card-border/50 hover:border-primary/50 hover:bg-primary/10 transition-all text-left"
                          >
                            <span className="text-sm text-white group-hover:text-primary transition-colors">
                              {s.label}
                            </span>
                            <span className="block text-xs text-text-tertiary">
                              e.g., {s.example}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation — roving tabindex with arrow keys */}
        <div
          role="tablist"
          aria-label="Persona sections"
          className="flex border-b border-card-border/35 mb-6"
          onKeyDown={(e: KeyboardEvent) => {
            const tabIds = tabs.map((t) => t.id);
            const idx = tabIds.indexOf(activeTab);
            let nextIdx = idx;
            if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabIds.length;
            else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabIds.length) % tabIds.length;
            else if (e.key === 'Home') nextIdx = 0;
            else if (e.key === 'End') nextIdx = tabIds.length - 1;
            else return;
            e.preventDefault();
            setActiveTab(tabIds[nextIdx]);
            document.getElementById(`tab-${tabIds[nextIdx]}`)?.focus();
          }}
        >
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all -mb-px ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary hover:border-card-border/40'
                }`}
              >
                <TabIcon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'sharing' && sharingHistory.length > 0 && (
                  <span className="ml-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-primary rounded-full">
                    {sharingHistory.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Panels */}
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === 'facts' && (
            <FactsPanel
              facts={persona.facts}
              factIndexMap={factIndexMap}
              showValues={showValues}
              hideHighSensitivity={hideHighSensitivity}
              toggleValue={toggleValue}
              editingFact={editingFact}
              onStartEdit={setEditingFact}
              onSaveEdit={handleEditFact}
              onCancelEdit={() => setEditingFact(null)}
              onDelete={handleDeleteFact}
              onAddFact={handleAddFact}
            />
          )}
          {activeTab === 'sharing' && (
            <SharingPanel history={sharingHistory} personaFactKeys={personaFactKeys} />
          )}
          {activeTab === 'settings' && (
            <PersonaSettingsPanel
              personaName={persona.name}
              settings={persona.personaSettings}
              onSave={handleSavePersonaSettings}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
