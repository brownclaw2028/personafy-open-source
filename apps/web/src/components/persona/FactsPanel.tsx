import { useState, useMemo, useEffect, type FormEvent } from 'react';
import {
  Search,
  Plus,
  Lock,
  Eye,
  EyeOff,
  Edit3,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { VaultFact } from '../../lib/VaultProvider';
import {
  groupFactsByCategory,
  sortFacts,
  detectDuplicateFacts,
  formatFactKey,
  type FactSortOption,
} from '../../lib/utils';

import { sensitivityConfig } from './constants';

/* ---- Facts Tab ---- */

export function FactsPanel({
  facts,
  factIndexMap,
  showValues,
  hideHighSensitivity = true,
  toggleValue,
  editingFact,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAddFact,
}: {
  facts: VaultFact[];
  factIndexMap: Map<VaultFact, number>;
  showValues: Record<string, boolean>;
  hideHighSensitivity?: boolean;
  toggleValue: (id: string) => void;
  editingFact: string | null;
  onStartEdit: (id: string) => void;
  onSaveEdit: (index: number, newValue: string) => void;
  onCancelEdit: () => void;
  onDelete: (index: number) => void;
  onAddFact: (fact: VaultFact) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [factSearch, setFactSearch] = useState('');
  const [factSort, setFactSort] = useState<FactSortOption>('default');
  const [showDuplicates, setShowDuplicates] = useState(false);

  const duplicates = useMemo(() => detectDuplicateFacts(facts), [facts]);

  const filteredFacts = useMemo(() => {
    // When showing duplicates, filter to only duplicate keys
    if (showDuplicates && duplicates.length > 0) {
      const dupKeys = new Set(duplicates.map((d) => d.key));
      const duped = facts.filter((f) => dupKeys.has(f.key));
      const q = factSearch.trim().toLowerCase();
      if (!q) return duped;
      return duped.filter(
        (f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q),
      );
    }
    const q = factSearch.trim().toLowerCase();
    if (!q) return facts;
    return facts.filter(
      (f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q),
    );
  }, [facts, factSearch, showDuplicates, duplicates]);

  const searchBaseCount = useMemo(() => {
    if (!showDuplicates || duplicates.length === 0) return facts.length;
    const dupKeys = new Set(duplicates.map((d) => d.key));
    return facts.filter((f) => dupKeys.has(f.key)).length;
  }, [facts, showDuplicates, duplicates]);

  const sortedFacts = useMemo(
    () => sortFacts(filteredFacts, factSort),
    [filteredFacts, factSort],
  );

  const factsByCategory = useMemo(() => groupFactsByCategory(sortedFacts), [sortedFacts]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Duplicate warning banner */}
      {duplicates.length > 0 && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
          showDuplicates
            ? 'bg-yellow-400/10 border-yellow-400/30'
            : 'bg-yellow-400/5 border-yellow-400/20'
        }`}>
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-yellow-400/90 text-sm font-medium">
              {duplicates.length} key{duplicates.length !== 1 ? 's have' : ' has'} multiple values
            </p>
            <p className="text-yellow-400/60 text-xs mt-0.5">
              {duplicates.slice(0, 3).map((d) => d.key).join(', ')}
              {duplicates.length > 3 ? `, +${duplicates.length - 3} more` : ''}
            </p>
          </div>
          <button
            onClick={() => setShowDuplicates(!showDuplicates)}
            className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors flex-shrink-0 ${
              showDuplicates
                ? 'bg-yellow-400/20 text-yellow-400 hover:bg-yellow-400/30'
                : 'bg-yellow-400/10 text-yellow-400/80 hover:bg-yellow-400/20 hover:text-yellow-400'
            }`}
          >
            {showDuplicates ? 'Show all' : 'Show duplicates'}
          </button>
        </div>
      )}

      {/* Search + Sort bar — only show when there are enough facts to warrant it */}
      {facts.length > 5 && (
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder={`Search ${searchBaseCount} facts…`}
              value={factSearch}
              onChange={(e) => setFactSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm"
              aria-label="Search facts"
            />
            {(factSearch || showDuplicates) && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-xs">
                {filteredFacts.length}/{searchBaseCount}
              </span>
            )}
          </div>
          <select
            value={factSort}
            onChange={(e) => setFactSort(e.target.value as FactSortOption)}
            aria-label="Sort facts"
            className="px-3 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary text-sm focus:outline-none focus:border-accent/50 transition-colors cursor-pointer min-w-[140px]"
          >
            <option value="default">Default order</option>
            <option value="key_asc">Key A → Z</option>
            <option value="sensitivity_desc">Sensitivity ↓</option>
            <option value="confidence_desc">Confidence ↓</option>
          </select>
        </div>
      )}
      {Object.entries(factsByCategory).map(([category, catFacts]) => (
        <div key={category}>
          <h3 className="text-text-tertiary text-xs uppercase tracking-wider mb-3 font-medium">
            {category}
          </h3>
          <div className="space-y-2">
            {catFacts.map((fact) => {
              const idxFromMap = factIndexMap.get(fact);
              const resolvedIndex = idxFromMap ?? facts.indexOf(fact);
              const factId = `fact:${resolvedIndex}`;
              const sens = sensitivityConfig[fact.sensitivity];
              const overrideVisible = showValues[factId];
              const defaultVisible = !hideHighSensitivity;
              const isVisible = overrideVisible === undefined ? defaultVisible : overrideVisible;
              const isHidden = fact.sensitivity === 'high' && !isVisible;
              const isEditing = editingFact === factId;

              return (
                <FactRow
                  key={factId}
                  fact={fact}
                  sens={sens}
                  isHidden={isHidden}
                  isEditing={isEditing}
                  onToggleValue={() => toggleValue(factId)}
                  onStartEdit={() => onStartEdit(factId)}
                  onSaveEdit={(newValue) => onSaveEdit(resolvedIndex, newValue)}
                  onCancelEdit={onCancelEdit}
                  onDelete={() => onDelete(resolvedIndex)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* No results state */}
      {factSearch && filteredFacts.length === 0 && (
        <div className="py-8 text-center text-text-tertiary text-sm">
          No facts matching &ldquo;{factSearch}&rdquo;
        </div>
      )}

      {showAddForm ? (
        <AddFactForm
          onSave={(fact) => { onAddFact(fact); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="w-full glass-card p-4 flex items-center justify-center gap-2 text-text-tertiary hover:text-accent hover:border-accent/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">Add Fact</span>
        </button>
      )}
    </div>
  );
}

/* ---- Individual Fact Row ---- */

function FactRow({
  fact,
  sens,
  isHidden,
  isEditing,
  onToggleValue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  fact: VaultFact;
  sens: { color: string; bg: string; label: string };
  isHidden: boolean;
  isEditing: boolean;
  onToggleValue: () => void;
  onStartEdit: () => void;
  onSaveEdit: (newValue: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const [editValue, setEditValue] = useState(fact.value);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (editValue.trim()) onSaveEdit(editValue);
  };

  if (isEditing) {
    return (
      <form onSubmit={handleEditSubmit} className="glass-card p-4 border-accent/30 flex items-center gap-4">
        <div className={`w-8 h-8 rounded-lg ${sens.bg} flex items-center justify-center flex-shrink-0`}>
          <Lock className={`w-4 h-4 ${sens.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-text-secondary text-sm" title={fact.key}>{formatFactKey(fact.key)}</span>
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            autoFocus
            className="mt-1 w-full px-3 py-1.5 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="submit" className="p-1.5 rounded-lg text-accent hover:bg-accent/10 transition-colors" aria-label="Save">
            <CheckCircle className="w-4 h-4" />
          </button>
          <button type="button" onClick={onCancelEdit} className="p-1.5 rounded-lg text-text-tertiary hover:text-white transition-colors" aria-label="Cancel">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="glass-card p-4 flex items-center gap-4 group hover:border-accent/20 transition-all">
      <div className={`w-8 h-8 rounded-lg ${sens.bg} flex items-center justify-center flex-shrink-0`}>
        <Lock className={`w-4 h-4 ${sens.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-text-secondary text-sm" title={fact.key}>{formatFactKey(fact.key)}</span>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded ${sens.bg} ${sens.color}`}>{sens.label}</span>
          <span className="text-text-tertiary text-xs">
            {Math.min(100, Math.max(0, Math.round(fact.confidence * 100)))}% confidence
          </span>
          {fact.source && <span className="text-text-tertiary/60 text-xs">from {fact.source}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isHidden ? (
          <span className="text-text-tertiary text-sm font-mono">••••••</span>
        ) : (
          <span className="text-white text-sm font-medium">{fact.value}</span>
        )}
        {fact.sensitivity === 'high' && (
          <button
            type="button"
            onClick={onToggleValue}
            aria-label={isHidden ? `Show ${fact.key}` : `Hide ${fact.key}`}
            className="text-text-tertiary hover:text-accent transition-colors"
          >
            {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        )}
        {/* Edit + Delete — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label={`Edit ${fact.key}`}
            className="p-1 rounded text-text-tertiary hover:text-accent transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {confirmDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="px-2 py-0.5 rounded text-xs text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors font-medium"
            >
              Confirm
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${fact.key}`}
              className="p-1 rounded text-text-tertiary hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Add Fact Form ---- */

const COMMON_FACT_KEYS = [
  'apparel.shoe.size', 'apparel.pants.waist', 'apparel.shirt.size', 'apparel.dress.size',
  'food.diet', 'food.allergies', 'food.cuisine.favorite', 'food.cuisine.disliked',
  'travel.airline.preferred', 'travel.hotel.preferred', 'travel.seat.preference',
  'shopping.budget.range', 'shopping.style', 'shopping.brands.favorite',
  'fitness.activity', 'fitness.goal', 'health.conditions',
  'entertainment.music.genre', 'entertainment.movies.genre', 'entertainment.books.genre',
  'home.city', 'home.pets', 'work.role', 'work.industry',
];

function AddFactForm({
  onSave,
  onCancel,
}: {
  onSave: (fact: VaultFact) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('low');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;
    onSave({
      key: key.trim().toLowerCase().replace(/\s+/g, '_'),
      value: value.trim(),
      sensitivity,
      confidence: 1.0,
      source: 'manual',
      extractedAt: Date.now(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card p-5 border-accent/20 space-y-4 animate-slide-up">
      <div className="flex items-center gap-2 mb-1">
        <Plus className="w-4 h-4 text-accent" />
        <h3 className="text-white font-medium text-sm">Add New Fact</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="add-fact-key" className="text-text-tertiary text-xs mb-1 block">Key</label>
          <input
            id="add-fact-key"
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g., apparel.shoe.size"
            autoFocus
            list="fact-key-suggestions"
            className="w-full px-3 py-2 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary text-sm font-mono focus:outline-none focus:border-accent/50"
          />
          <datalist id="fact-key-suggestions">
            {COMMON_FACT_KEYS.map(k => <option key={k} value={k} />)}
          </datalist>
        </div>
        <div>
          <label htmlFor="add-fact-value" className="text-text-tertiary text-xs mb-1 block">Value</label>
          <input
            id="add-fact-value"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g., 10.5"
            className="w-full px-3 py-2 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary text-sm focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>
      <div>
        <label id="add-fact-sensitivity-label" className="text-text-tertiary text-xs mb-1 block">Sensitivity</label>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as const).map((s) => {
            const conf = sensitivityConfig[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSensitivity(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sensitivity === s
                    ? `${conf.bg} ${conf.color} ring-1 ring-current`
                    : 'bg-card border border-card-border/50 text-text-tertiary hover:text-white'
                }`}
              >
                {conf.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-card-border/50 rounded-lg text-text-secondary hover:text-white text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!key.trim() || !value.trim()}
          className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add Fact
        </button>
      </div>
    </form>
  );
}
