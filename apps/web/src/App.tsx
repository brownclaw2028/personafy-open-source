import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { initPostHog, trackPageView } from './lib/posthog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { SkeletonPage } from './components/LoadingSkeleton';

// ── Eagerly loaded (new 3-step setup flow) ──
import { ValueProposition } from './pages/ValueProposition';
import { CreatePassword } from './pages/CreatePassword';
import { QuickPersonalize } from './pages/QuickPersonalize';
import { type VaultConfig } from './lib/types';
import { convertQuickStartToPersonas, type QuickStartAnswers } from './lib/quickstart-converter';

// ── Lazily loaded (post-setup access for checklist) ──
const LazyImport = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })));
const LazyQuickStart = lazy(() => import('./pages/QuickStart').then((m) => ({ default: m.QuickStart })));
const LazyImportReview = lazy(() => import('./pages/ImportReview').then((m) => ({ default: m.ImportReview })));

// ── Lazily loaded (main app — only when navigated to) ──
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Personas = lazy(() => import('./pages/Personas').then((m) => ({ default: m.Personas })));
const PersonaDetail = lazy(() => import('./pages/PersonaDetail').then((m) => ({ default: m.PersonaDetail })));
const Approvals = lazy(() => import('./pages/Approvals').then((m) => ({ default: m.Approvals })));
const ApprovalDetail = lazy(() => import('./pages/ApprovalDetail').then((m) => ({ default: m.ApprovalDetail })));
const Rules = lazy(() => import('./pages/Rules').then((m) => ({ default: m.Rules })));
const AuditLog = lazy(() => import('./pages/AuditLog').then((m) => ({ default: m.AuditLog })));
const Devices = lazy(() => import('./pages/Devices').then((m) => ({ default: m.Devices })));
const Sources = lazy(() => import('./pages/Sources').then((m) => ({ default: m.Sources })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const DataBrowser = lazy(() => import('./pages/DataBrowser').then((m) => ({ default: m.DataBrowser })));
const Demo = lazy(() => import('./pages/Demo').then((m) => ({ default: m.Demo })));
import type { PrivacyPosture, ChatGPTExport, Persona, ProfileSummary, FollowUpQuestion } from './lib/types';
import {
  extractGeneralFactsWithEvidence,
  type GeneralExtractionRecord,
} from './lib/general-extractor';
import { generatePersonas } from './lib/persona-generator';
import { saveVault, fetchVault } from './lib/vault';
import { mergeImportedPersonas } from './lib/source-merge';
import { VaultProvider, useVault } from './lib/VaultProvider';
import { toast } from './components/Toast';
import './index.css';

function normalizeRole(role: unknown): string {
  if (typeof role !== 'string') return '';
  const normalized = role.trim().toLowerCase();
  if (normalized === 'human') return 'user';
  if (normalized === 'bot') return 'assistant';
  return normalized;
}

function collectTextFragments(value: unknown, fragments: string[], depth = 0): void {
  if (value == null || depth > 5) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) fragments.push(trimmed);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    fragments.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextFragments(item, fragments, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  collectTextFragments(record.text, fragments, depth + 1);
  collectTextFragments(record.content, fragments, depth + 1);
  collectTextFragments(record.parts, fragments, depth + 1);
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const fragments: string[] = [];
  collectTextFragments(record.content, fragments);
  collectTextFragments(record.text, fragments);
  return fragments.join(' ').trim();
}

function toGeneralRecordsFromChatGpt(conversations: ChatGPTExport[]): GeneralExtractionRecord[] {
  const records: GeneralExtractionRecord[] = [];

  conversations.forEach((conversation, conversationIndex) => {
    if (!conversation.mapping || typeof conversation.mapping !== 'object') return;

    const mappingValues = Object.values(conversation.mapping);
    mappingValues.forEach((node, messageIndex) => {
      if (!node || typeof node !== 'object') return;
      const message = (node as Record<string, unknown>).message;
      if (!message || typeof message !== 'object') return;

      const author = (message as Record<string, unknown>).author;
      const role = normalizeRole((author as Record<string, unknown> | null)?.role);
      if (role !== 'user') return;

      const content = extractMessageText(message);
      if (!content) return;

      const nodeId = typeof (node as Record<string, unknown>).id === 'string'
        ? ((node as Record<string, unknown>).id as string)
        : `node-${conversationIndex + 1}-${messageIndex + 1}`;

      records.push({
        sourceType: 'chatgpt',
        sourceId: `chatgpt:${nodeId}`,
        sourceName: `ChatGPT: ${conversation.title || 'Untitled Conversation'}`,
        content,
      });
    });
  });

  return records;
}

function buildProfileSummary(personas: Persona[]): ProfileSummary {
  if (personas.length === 0) {
    return {
      narrative: 'No durable preferences detected yet. Import more conversations or answer quick questions to build your personas.',
      keyTraits: [],
      confidence: 0,
    };
  }

  const keyTraits = personas
    .flatMap((persona) => persona.facts.slice(0, 2).map((fact) => fact.value))
    .slice(0, 6);

  const avgCompletion = personas.reduce((sum, persona) => sum + persona.completionScore, 0) / personas.length;
  const confidence = Math.max(0, Math.min(1, avgCompletion));
  const categories = personas.map((persona) => persona.name).join(', ');

  return {
    narrative: `We identified ${personas.length} persona categories from your imports: ${categories}. You can refine these anytime as new source data is added.`,
    keyTraits,
    confidence,
  };
}

function runSetupExtraction(conversations: ChatGPTExport[]): {
  personas: Persona[];
  profileSummary: ProfileSummary;
  followUpQuestions: FollowUpQuestion[];
} {
  const records = toGeneralRecordsFromChatGpt(conversations);
  const facts = extractGeneralFactsWithEvidence(records);
  const personas = generatePersonas(facts);
  return {
    personas,
    profileSummary: buildProfileSummary(personas),
    followUpQuestions: [],
  };
}

// Default posture auto-selected during the new 3-step setup
const BALANCED_POSTURE: PrivacyPosture = {
  id: 'alarm_system',
  name: 'Balanced',
  description: 'Always ask before sharing anything important',
  icon: 'Shield',
  features: [
    'Anything medium sensitivity or above needs your OK',
    'Only basic info shared automatically',
    'Best mix of convenience and control',
  ],
  recommended: true,
};

interface AppData {
  selectedPosture: PrivacyPosture | null;
  vaultConfig: VaultConfig | null;
  conversations: ChatGPTExport[];
  personas: Persona[];
  profileSummary: ProfileSummary | null;
  followUpQuestions: FollowUpQuestion[];
  setupComplete: boolean;
}

function skeletonLayoutForPath(pathname: string): { cards: number; stats: number } {
  if (pathname === '/') return { cards: 4, stats: 5 };
  if (pathname.startsWith('/personas')) return { cards: 6, stats: 3 };
  if (pathname.startsWith('/approvals')) return { cards: 6, stats: 4 };
  if (pathname.startsWith('/approve/')) return { cards: 5, stats: 0 };
  if (pathname.startsWith('/rules')) return { cards: 4, stats: 3 };
  if (pathname.startsWith('/audit')) return { cards: 6, stats: 3 };
  if (pathname.startsWith('/devices')) return { cards: 4, stats: 3 };
  if (pathname.startsWith('/sources')) return { cards: 5, stats: 3 };
  if (pathname.startsWith('/settings')) return { cards: 4, stats: 2 };
  if (pathname.startsWith('/browse')) return { cards: 5, stats: 1 };
  if (pathname.startsWith('/demo')) return { cards: 4, stats: 0 };
  if (pathname.startsWith('/setup/review')) return { cards: 4, stats: 2 };
  if (pathname.startsWith('/setup')) return { cards: 3, stats: 0 };
  return { cards: 3, stats: 3 };
}

function RouteSkeletonFallback() {
  const location = useLocation();
  const layout = skeletonLayoutForPath(location.pathname);
  return <SkeletonPage cards={layout.cards} stats={layout.stats} />;
}

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const { vault, setPassphrase, refresh, save: vaultSave } = useVault();

  // Track page views on route changes
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  const [justCompletedSetup, setJustCompletedSetup] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [appData, setAppData] = useState<AppData>(() => {
    const saved = localStorage.getItem('personafy_setup_complete');
    if (saved === 'true') {
      return {
        selectedPosture: null,
        vaultConfig: null,
        conversations: [],
        personas: [],
        profileSummary: null,
        followUpQuestions: [],
        setupComplete: true,
      };
    }
    return {
      selectedPosture: null,
      vaultConfig: null,
      conversations: [],
      personas: [],
      profileSummary: null,
      followUpQuestions: [],
      setupComplete: false,
    };
  });

  // Verify vault actually exists when localStorage says setup is complete.
  // Prevents bypass via manually setting the flag.
  // Only redirect to setup on 404 (vault doesn't exist), NOT on 500/network errors.
  useEffect(() => {
    if (localStorage.getItem('personafy_setup_complete') === 'true') {
      fetchVault().then(result => {
        if (!result.ok && !result.locked && result.notFound) {
          localStorage.removeItem('personafy_setup_complete');
          setAppData(prev => ({ ...prev, setupComplete: false }));
        }
      });
    }
  // Run once on mount only
  }, []);

  // ── New 3-step setup handlers ──

  const handleSetupContinue = () => {
    setAppData(prev => ({ ...prev, selectedPosture: BALANCED_POSTURE }));
    navigate('/setup/password');
  };

  const handlePasswordSet = (password: string) => {
    const config: VaultConfig = {
      passphrase: password,
      useBiometrics: true,
      derivedOnly: true,
      vaultName: 'My Personal Vault',
    };
    setAppData(prev => ({ ...prev, vaultConfig: config }));
    setPassphrase(password);
    navigate('/setup/personalize');
  };

  /**
   * Create vault and persist personas. Accepts an optional overridePersonas param
   * to avoid stale React state (setAppData hasn't flushed when this runs synchronously).
   */
  const handleVaultCreated = async (overridePersonas?: Persona[]) => {
    const personasToSave = overridePersonas ?? appData.personas;
    const existingResult = await fetchVault(undefined, appData.vaultConfig?.passphrase);

    const existingVault = existingResult.ok ? existingResult.data : null;

    // Only force-create when there's truly no vault (404). If the vault is
    // locked (encrypted but we don't have the passphrase), the user must
    // unlock first — the server will reject force-create with 409.
    const forceCreate = !existingResult.ok && !existingResult.locked;

    if (!existingResult.ok && existingResult.locked) {
      toast('An encrypted vault already exists. Please unlock it with your passphrase first.', 'error');
      return;
    }

    const vaultPersonas = mergeImportedPersonas([], personasToSave);

    const postureId = appData.selectedPosture?.id.replace(/-/g, '_') ?? 'alarm_system';

    const vaultData: import('./lib/vault').VaultData = {
      version: existingVault?.version ?? '1.0',
      createdAt: existingVault?.createdAt ?? new Date().toISOString(),
      privacyPosture: postureId,
      settings: existingVault?.settings,
      personas: vaultPersonas,
      devices: existingVault?.devices ?? [],
      rules: existingVault?.rules ?? [],
      auditLog: existingVault?.auditLog ?? [],
      approvalQueue: existingVault?.approvalQueue ?? [],
      factReviewQueue: existingVault?.factReviewQueue ?? [],
    };

    const saved = await saveVault(vaultData, appData.vaultConfig?.passphrase, { forceCreate });

    if (!saved.ok) {
      toast(saved.error || 'Failed to save vault data. Please try again.', 'error');
      return;
    }

    // Refresh VaultProvider so it picks up the new vault and clears any prior error
    await refresh();

    localStorage.setItem('personafy_setup_complete', 'true');
    localStorage.removeItem('personafy_personas');
    setJustCompletedSetup(true);
    // Store passphrase before nullifying vaultConfig so post-setup fetch can use it
    const setupPassphrase = appData.vaultConfig?.passphrase;
    setAppData(prev => ({ ...prev, setupComplete: true, vaultConfig: null }));
    // Ensure passphrase remains available for any post-setup vault operations
    if (setupPassphrase) {
      setPassphrase(setupPassphrase);
    }
    setShowCelebration(true);
  };

  const handleQuickQuestionsComplete = async (answers: QuickStartAnswers) => {
    const personas = convertQuickStartToPersonas(answers);
    setAppData(prev => ({ ...prev, personas }));
    await handleVaultCreated(personas);
  };

  const handleSetupImportComplete = async (conversations: ChatGPTExport[]) => {
    try {
      const result = runSetupExtraction(conversations);

      setAppData(prev => ({
        ...prev,
        conversations,
        personas: result.personas,
        profileSummary: result.profileSummary,
        followUpQuestions: result.followUpQuestions,
      }));

      // Navigate to review so the user sees extracted personas before vault creation
      navigate('/setup/review');
    } catch (err) {
      console.error('Import extraction failed:', err);
      toast('Failed to analyze conversations. Please try again.', 'error');
    }
  };

  const handleSetupSkip = async () => {
    await handleVaultCreated([]);
  };

  // ── Legacy handlers (kept for post-setup routes) ──

  const handlePostSetupQuickStartComplete = (answers: QuickStartAnswers) => {
    const personas = convertQuickStartToPersonas(answers);

    const topCats = personas.slice(0, 3).map(p => p.name).join(', ');
    setAppData((prev) => ({
      ...prev,
      personas,
      profileSummary: {
        narrative: personas.length > 0
          ? `You set up ${personas.length} persona${personas.length > 1 ? 's' : ''} via QuickStart: ${topCats}. Add more facts anytime to improve recommendations.`
          : 'No personas created yet. Go back and answer a few questions to get started.',
        keyTraits: personas.flatMap(p => p.facts.slice(0, 2).map(f => f.value)).slice(0, 5),
        confidence: personas.length > 0 ? 0.8 : 0,
      },
      followUpQuestions: [],
    }));
    navigate('/setup/review');
  };

  const handlePostSetupImportComplete = async (conversations: ChatGPTExport[]) => {
    toast('Analyzing conversations…');

    try {
      const result = runSetupExtraction(conversations);

      setAppData(prev => ({
        ...prev,
        conversations,
        personas: result.personas,
        profileSummary: result.profileSummary,
        followUpQuestions: result.followUpQuestions,
      }));

      navigate('/setup/review');
    } catch (err) {
      console.error('Import extraction failed:', err);
      toast('Failed to analyze conversations. Please try again.', 'error');
    }
  };

  const handlePostSetupVaultCreated = async () => {
    if (!vault) {
      toast('Vault not loaded. Please try again.', 'error');
      return;
    }

    const merged = mergeImportedPersonas(vault.personas ?? [], appData.personas);

    const vaultData: import('./lib/vault').VaultData = {
      ...vault,
      personas: merged,
    };

    const ok = await vaultSave(vaultData);

    if (!ok) {
      toast('Failed to save vault data. Please try again.', 'error');
      return;
    }

    localStorage.removeItem('personafy_personas');
    navigate('/');
  };

  const handleAnswerFollowUp = (questionId: string, answer: string) => {
    setAppData(prev => ({
      ...prev,
      followUpQuestions: prev.followUpQuestions.map(q =>
        q.id === questionId ? { ...q, answered: true, answer } : q
      ),
    }));
  };

  const handleNavClick = (itemId: string) => {
    if (itemId === 'data-browser') {
      navigate('/browse');
      return;
    }
    if (itemId === 'demo') {
      navigate('/demo');
      return;
    }
    // Support setup/ prefixed paths from GettingStartedChecklist
    if (itemId.startsWith('setup/')) {
      navigate(`/${itemId}`);
      return;
    }
    navigate(`/${itemId === 'home' ? '' : itemId}`);
  };

  // Auto-advance celebration after 8s
  useEffect(() => {
    if (!showCelebration) return;
    const t = setTimeout(() => { setShowCelebration(false); navigate('/'); }, 8000);
    return () => clearTimeout(t);
  }, [showCelebration, navigate]);

  // Celebration interstitial
  if (showCelebration) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 animate-celebrate">
        <div className="text-center">
          <div className="w-24 h-24 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-8 shadow-glow animate-pulse-glow">
            <CheckCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">You're All Set!</h1>
          <p className="text-white/60 text-lg mb-2 max-w-md mx-auto">
            Your private space is ready. Only you can access it.
          </p>
          <p className="text-white/40 text-sm mb-10">
            Not even we can see what's inside.
          </p>
          <button
            onClick={() => { setShowCelebration(false); navigate('/'); }}
            className="btn-primary px-10 py-4 text-lg font-semibold"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // If setup is not complete, show new 3-step setup flow
  if (!appData.setupComplete) {
    return (
      <Routes>
        <Route path="/setup/welcome" element={<ValueProposition onContinue={handleSetupContinue} />} />
        <Route path="/setup/password" element={<CreatePassword onPasswordSet={handlePasswordSet} onBack={() => navigate('/setup/welcome')} />} />
        <Route
          path="/setup/personalize"
          element={
            <QuickPersonalize
              onQuickQuestionsComplete={handleQuickQuestionsComplete}
              onImportComplete={handleSetupImportComplete}
              onSkip={handleSetupSkip}
              onBack={() => navigate('/setup/password')}
            />
          }
        />
        <Route
          path="/setup/review"
          element={
            <Suspense fallback={<RouteSkeletonFallback />}>
              <LazyImportReview
                profileSummary={appData.profileSummary ?? { narrative: '', keyTraits: [], confidence: 0 }}
                personas={appData.personas}
                followUpQuestions={appData.followUpQuestions ?? []}
                onAnswerFollowUp={handleAnswerFollowUp}
                onVaultCreated={() => handleVaultCreated(appData.personas)}
              />
            </Suspense>
          }
        />
        <Route
          path="/demo"
          element={
            <Suspense fallback={<RouteSkeletonFallback />}>
              <Demo />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/setup/welcome" replace />} />
      </Routes>
    );
  }

  // Main app with sidebar navigation (lazy-loaded pages)
  return (
    <Suspense fallback={<RouteSkeletonFallback />}>
      <Routes>
        <Route
          path="/"
          element={<Home onNavClick={handleNavClick} justCompletedSetup={justCompletedSetup} />}
        />
        <Route
          path="/personas"
          element={
            <Personas
              onNavClick={handleNavClick}
              onPersonaClick={(p) => navigate(`/personas/${p.id}`)}
            />
          }
        />
        <Route
          path="/personas/:personaId"
          element={<PersonaDetail onNavClick={handleNavClick} />}
        />
        <Route
          path="/approvals"
          element={<Approvals onNavClick={handleNavClick} />}
        />
        <Route
          path="/approve/:requestId"
          element={<ApprovalDetail />}
        />
        <Route
          path="/rules"
          element={<Rules onNavClick={handleNavClick} />}
        />
        <Route
          path="/audit"
          element={<AuditLog onNavClick={handleNavClick} />}
        />
        <Route
          path="/devices"
          element={<Devices onNavClick={handleNavClick} />}
        />
        <Route
          path="/sources"
          element={<Sources onNavClick={handleNavClick} />}
        />
        <Route
          path="/settings"
          element={<Settings onNavClick={handleNavClick} />}
        />
        <Route
          path="/browse"
          element={<DataBrowser onNavClick={handleNavClick} />}
        />
        <Route
          path="/demo"
          element={<Demo isPostSetup onNavClick={handleNavClick} />}
        />
        {/* Post-setup routes for Getting Started checklist */}
        <Route
          path="/setup/quickstart"
          element={<LazyQuickStart onComplete={handlePostSetupQuickStartComplete} onBack={() => navigate('/')} />}
        />
        <Route
          path="/setup/import"
          element={<LazyImport onImportComplete={handlePostSetupImportComplete} />}
        />
        <Route
          path="/setup/review"
          element={
            appData.profileSummary ? (
              <LazyImportReview
                profileSummary={appData.profileSummary}
                personas={appData.personas}
                followUpQuestions={appData.followUpQuestions}
                onAnswerFollowUp={handleAnswerFollowUp}
                onVaultCreated={handlePostSetupVaultCreated}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="/setup/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/**
 * Announces route changes to screen readers via an aria-live region.
 * Reads the document title (set by useDocumentTitle) after each navigation.
 */
function RouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Small delay so useDocumentTitle has time to update document.title.
    const timer = setTimeout(() => {
      setAnnouncement(document.title || 'Page loaded');
    }, 100);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}

function App() {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <VaultProvider>
          <div className="min-h-screen bg-background">
            <KeyboardShortcuts>
              <AppRoutes />
              <RouteAnnouncer />
            </KeyboardShortcuts>
            <ToastContainer />
          </div>
        </VaultProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
