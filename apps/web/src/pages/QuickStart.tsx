import { useState, useMemo, useRef } from 'react';
import {
  Sparkles,
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Activity,
  Gift,
  ArrowRight,
  ArrowLeft,
  Check,
} from 'lucide-react';

import type { QuickStartAnswers } from '../lib/quickstart-converter';

interface QuickStartProps {
  onComplete: (answers: QuickStartAnswers) => void;
  onBack: () => void;
  /** Optional question ID filter. When provided, only matching questions are shown. */
  questionIds?: string[];
}

interface QuestionDef {
  id: string;
  question: string;
  type: 'choice' | 'text' | 'multi';
  options?: string[];
  placeholder?: string;
  factKey: string;
  sensitivity: 'low' | 'medium' | 'high';
}

interface CategoryDef {
  id: keyof QuickStartAnswers;
  name: string;
  icon: typeof ShoppingBag;
  emoji: string;
  color: string;
  questions: QuestionDef[];
}

const categories: CategoryDef[] = [
  {
    id: 'shopping',
    name: 'Shopping',
    icon: ShoppingBag,
    emoji: '🛍️',
    color: 'from-blue-500 to-cyan-400',
    questions: [
      { id: 's1', question: "What's your typical clothing style?", type: 'choice', options: ['Casual', 'Smart casual', 'Formal', 'Streetwear', 'Minimalist', 'Athletic'], factKey: 'apparel.style', sensitivity: 'low' },
      { id: 's2', question: "What's your pants waist size?", type: 'text', placeholder: 'e.g., 32', factKey: 'apparel.pants.waist', sensitivity: 'low' },
      { id: 's3', question: "What's your pants inseam?", type: 'text', placeholder: 'e.g., 30', factKey: 'apparel.pants.inseam', sensitivity: 'low' },
      { id: 's4', question: "What's your shirt size?", type: 'choice', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], factKey: 'apparel.shirt.size', sensitivity: 'low' },
      { id: 's5', question: "What's your shoe size?", type: 'text', placeholder: 'e.g., 10', factKey: 'apparel.shoe.size', sensitivity: 'low' },
      { id: 's6', question: 'What brands do you like?', type: 'text', placeholder: 'e.g., Nike, Patagonia, J.Crew', factKey: 'apparel.preferred_brands', sensitivity: 'low' },
      { id: 's7', question: 'Monthly clothing budget?', type: 'choice', options: ['Under $100', '$100-250', '$250-500', '$500-1000', '$1000+'], factKey: 'budget.monthly_clothing', sensitivity: 'medium' },
    ],
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: Plane,
    emoji: '✈️',
    color: 'from-violet-500 to-purple-400',
    questions: [
      { id: 't1', question: 'Preferred seat on flights?', type: 'choice', options: ['Window', 'Aisle', 'Middle (really?)', 'No preference'], factKey: 'flight.seat_preference', sensitivity: 'low' },
      { id: 't2', question: 'Hotel room preference?', type: 'choice', options: ['High floor', 'Low floor', 'Quiet room', 'Near elevator', 'No preference'], factKey: 'hotel.room_preference', sensitivity: 'low' },
      { id: 't3', question: 'Favorite travel destinations?', type: 'text', placeholder: 'e.g., Japan, Italy, Iceland', factKey: 'travel.favorite_destinations', sensitivity: 'low' },
      { id: 't4', question: 'Frequent flyer programs?', type: 'text', placeholder: 'e.g., United MileagePlus, Delta SkyMiles', factKey: 'travel.loyalty_programs', sensitivity: 'medium' },
      { id: 't5', question: 'Travel budget per trip?', type: 'choice', options: ['Budget ($500-1k)', 'Mid-range ($1k-3k)', 'Premium ($3k-5k)', 'Luxury ($5k+)'], factKey: 'budget.per_trip', sensitivity: 'medium' },
    ],
  },
  {
    id: 'food',
    name: 'Food & Dining',
    icon: UtensilsCrossed,
    emoji: '🍽️',
    color: 'from-orange-500 to-amber-400',
    questions: [
      { id: 'f1', question: 'Any dietary restrictions?', type: 'multi', options: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Keto', 'Halal', 'Kosher', 'Nut allergy'], factKey: 'dietary.restrictions', sensitivity: 'medium' },
      { id: 'f2', question: 'Favorite cuisines?', type: 'text', placeholder: 'e.g., Italian, Japanese, Mexican', factKey: 'food.favorite_cuisines', sensitivity: 'low' },
      { id: 'f3', question: 'Spice tolerance?', type: 'choice', options: ['Mild', 'Medium', 'Hot', 'Extra hot 🔥'], factKey: 'food.spice_level', sensitivity: 'low' },
      { id: 'f4', question: 'Dining budget per meal?', type: 'choice', options: ['Under $15', '$15-30', '$30-50', '$50-100', '$100+'], factKey: 'budget.per_meal', sensitivity: 'low' },
    ],
  },
  {
    id: 'fitness',
    name: 'Fitness',
    icon: Activity,
    emoji: '🏃',
    color: 'from-green-500 to-emerald-400',
    questions: [
      { id: 'x1', question: 'Primary workout type?', type: 'choice', options: ['Running', 'Weight training', 'Yoga', 'Swimming', 'Cycling', 'CrossFit', 'None currently'], factKey: 'fitness.primary_activity', sensitivity: 'low' },
      { id: 'x2', question: 'How often do you work out?', type: 'choice', options: ['Daily', '4-5x/week', '2-3x/week', 'Once a week', 'Rarely'], factKey: 'fitness.frequency', sensitivity: 'low' },
      { id: 'x3', question: 'Fitness goal?', type: 'choice', options: ['Lose weight', 'Build muscle', 'Stay healthy', 'Train for event', 'Flexibility'], factKey: 'fitness.goal', sensitivity: 'low' },
    ],
  },
  {
    id: 'gifts',
    name: 'Gift Giving',
    icon: Gift,
    emoji: '🎁',
    color: 'from-pink-500 to-rose-400',
    questions: [
      { id: 'g1', question: 'Gift budget range?', type: 'choice', options: ['Under $25', '$25-50', '$50-100', '$100-250', '$250+'], factKey: 'budget.gift_range', sensitivity: 'low' },
      { id: 'g2', question: 'Gift style preference?', type: 'choice', options: ['Practical', 'Sentimental', 'Experience-based', 'Luxury', 'Handmade'], factKey: 'gifts.style', sensitivity: 'low' },
      { id: 'g3', question: 'Who do you shop for most?', type: 'text', placeholder: 'e.g., Partner, kids, parents, friends', factKey: 'gifts.primary_recipients', sensitivity: 'low' },
    ],
  },
];

export function QuickStart({ onComplete, onBack, questionIds }: QuickStartProps) {
  // When questionIds is provided, filter categories to only include matching questions
  const filteredCategories = useMemo(() => {
    if (!questionIds) return categories;
    return categories
      .map(cat => ({
        ...cat,
        questions: cat.questions.filter(q => questionIds.includes(q.id)),
      }))
      .filter(cat => cat.questions.length > 0);
  }, [questionIds]);

  const [catIndex, setCatIndex] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<QuickStartAnswers>({
    shopping: {},
    travel: {},
    food: {},
    fitness: {},
    gifts: {},
  });
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const advancingRef = useRef(false);

  const cat = filteredCategories[catIndex];
  const question = cat.questions[qIndex];
  const totalQuestions = filteredCategories.reduce((sum, c) => sum + c.questions.length, 0);
  const answeredBefore = filteredCategories.slice(0, catIndex).reduce((sum, c) => sum + c.questions.length, 0) + qIndex;
  const progressPct = Math.round(((answeredBefore + 1) / totalQuestions) * 100);

  const currentAnswer = answers[cat.id][question.id] ?? '';

  const CatIcon = cat.icon;

  const saveAnswer = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [cat.id]: { ...prev[cat.id], [question.id]: value },
    }));
  };

  /**
   * Advance to the next question (or complete).
   * Accepts an optional `pendingValue` to ensure the current answer
   * is included in the final onComplete payload (avoids stale state).
   */
  const advance = (pendingValue?: string) => {
    // Guard against double-advance (rapid choice clicks)
    if (advancingRef.current) return;
    advancingRef.current = true;
    requestAnimationFrame(() => { advancingRef.current = false; });

    // Build the latest answers including any pending value
    let latestAnswers = answers;
    if (pendingValue !== undefined) {
      latestAnswers = {
        ...answers,
        [cat.id]: { ...answers[cat.id], [question.id]: pendingValue },
      };
      setAnswers(latestAnswers);
    }

    // For multi-select, save joined selection
    if (question.type === 'multi' && multiSelect.size > 0 && pendingValue === undefined) {
      const joined = Array.from(multiSelect).join(', ');
      latestAnswers = {
        ...latestAnswers,
        [cat.id]: { ...latestAnswers[cat.id], [question.id]: joined },
      };
      setAnswers(latestAnswers);
      setMultiSelect(new Set());
    }

    if (qIndex < cat.questions.length - 1) {
      setQIndex(qIndex + 1);
    } else if (catIndex < filteredCategories.length - 1) {
      setCatIndex(catIndex + 1);
      setQIndex(0);
    } else {
      onComplete(latestAnswers);
    }
  };

  const goBack = () => {
    if (qIndex > 0) {
      const prevQ = cat.questions[qIndex - 1];
      setQIndex((prev) => prev - 1);
      // Restore multi-select UI state when navigating back to a multi question.
      if (prevQ.type === 'multi') {
        const stored = answers[cat.id][prevQ.id] ?? '';
        setMultiSelect(new Set(stored.split(',').map((s) => s.trim()).filter(Boolean)));
      } else {
        setMultiSelect(new Set());
      }
    } else if (catIndex > 0) {
      const prevCat = filteredCategories[catIndex - 1];
      const prevQ = prevCat.questions[prevCat.questions.length - 1];
      setCatIndex((prev) => prev - 1);
      setQIndex(prevCat.questions.length - 1);
      if (prevQ.type === 'multi') {
        const stored = answers[prevCat.id][prevQ.id] ?? '';
        setMultiSelect(new Set(stored.split(',').map((s) => s.trim()).filter(Boolean)));
      } else {
        setMultiSelect(new Set());
      }
    }
  };

  const skip = () => advance();

  const canAdvance = useMemo(() => {
    if (question.type === 'multi') return multiSelect.size > 0;
    return currentAnswer.trim().length > 0;
  }, [question.type, multiSelect.size, currentAnswer]);

  const isLastQuestion = catIndex === filteredCategories.length - 1 && qIndex === cat.questions.length - 1;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16">
      {/* Progress header */}
      <div className="w-full max-w-xl mb-12 animate-fade-in">
        {/* Category breadcrumbs */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {filteredCategories.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                i === catIndex ? 'text-white' : i < catIndex ? 'text-accent' : 'text-text-tertiary'
              }`}
            >
              {i < catIndex ? <Check className="w-3 h-3 text-accent" /> : <span>{c.emoji}</span>}
              <span className="hidden sm:inline">{c.name}</span>
              {i < filteredCategories.length - 1 && <span className="text-text-tertiary/40 mx-1">›</span>}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-text-tertiary text-xs">
          <span>{answeredBefore + 1} of {totalQuestions}</span>
          <span>{progressPct}%</span>
        </div>
      </div>

      {/* Question card */}
      <div className="w-full max-w-xl animate-slide-up" key={`${cat.id}-${question.id}`}>
        <div className="glass-card p-8">
          {/* Category badge */}
          <div className="flex items-center gap-2 mb-6">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center`}>
              <CatIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-white font-semibold">{cat.name}</div>
              <div className="text-text-tertiary text-xs">Question {qIndex + 1} of {cat.questions.length}</div>
            </div>
          </div>

          {/* Question */}
          <h2 className="text-xl font-bold text-white mb-6">{question.question}</h2>

          {/* Answer input */}
          {question.type === 'choice' && (
            <div className="grid grid-cols-2 gap-3">
              {question.options?.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { saveAnswer(opt); if (!isLastQuestion) advance(opt); }}
                  className={`p-3 rounded-xl border text-sm font-medium text-left transition-all ${
                    currentAnswer === opt
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-card-border/50 bg-card text-text-secondary hover:border-accent/30 hover:text-white'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {question.type === 'multi' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {question.options?.map((opt) => {
                  const isSelected = multiSelect.has(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        setMultiSelect((prev) => {
                          const next = new Set(prev);
                          if (opt === 'None') {
                            return new Set(['None']);
                          }
                          next.delete('None');
                          if (isSelected) next.delete(opt);
                          else next.add(opt);
                          return next;
                        });
                      }}
                      className={`p-3 rounded-xl border text-sm font-medium text-left transition-all ${
                        isSelected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-card-border/50 bg-card text-text-secondary hover:border-accent/30 hover:text-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 inline mr-1.5" />}
                      {opt}
                    </button>
                  );
                })}
              </div>
              <p className="text-text-tertiary text-xs">Select all that apply</p>
            </div>
          )}

          {question.type === 'text' && (
            <div>
              <input
                type="text"
                value={currentAnswer}
                onChange={(e) => saveAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canAdvance) advance(); }}
                placeholder={question.placeholder}
                autoFocus
                className="w-full px-4 py-3 bg-card border border-card-border/50 rounded-xl text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="w-full max-w-xl flex items-center justify-between mt-8">
        <button
          onClick={answeredBefore === 0 ? onBack : goBack}
          className="flex items-center gap-2 text-text-tertiary hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          {answeredBefore === 0 ? 'Back' : 'Previous'}
        </button>

        <div className="flex items-center gap-3">
          {!isLastQuestion && (
            <button
              onClick={skip}
              className="text-text-tertiary hover:text-text-secondary transition-colors text-sm"
            >
              Skip
            </button>
          )}
          {(question.type === 'text' || question.type === 'multi' || isLastQuestion) && (
            <button
              onClick={() => advance()}
              disabled={!canAdvance}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                canAdvance
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-glow'
                  : 'bg-card border border-card-border/50 text-text-tertiary cursor-not-allowed'
              }`}
            >
              {isLastQuestion ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  Build My Vault
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-text-tertiary text-xs max-w-md">
        <p>Skip any question you're not comfortable with. You can always add more later.</p>
      </div>
    </div>
  );
}
