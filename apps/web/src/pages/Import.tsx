import { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, Loader2, Database, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ImportZone } from '../components/ImportZone';
import { ProgressBar } from '../components/ProgressBar';
import { toast } from '../components/Toast';
import type { ChatGPTExport, ImportProgress } from '../lib/types';
import type { SourceType } from '../lib/source-types';
import { SOURCE_TYPE_LABELS } from '../lib/source-types';
import {
  PackageParseError,
  type PackageParseErrorCode,
  parseImportPackage,
  type ParsedImportPackage,
} from '../lib/import/package-parser';
import sampleData from '../data/demo-export.json';

interface ImportProps {
  onImportComplete: (conversations: ChatGPTExport[]) => void;
}

type ImportSourceSelection = 'auto' | SourceType;

interface ImportSourceOption {
  value: ImportSourceSelection;
  label: string;
  description: string;
}

const SUPPORTED_UPLOAD_ACCEPT = '.json,.zip,.tgz,.tar.gz,.ics';
const SUPPORTED_UPLOAD_FORMATS = '.json, .zip, .tgz, .tar.gz, .ics';
const IMPORT_PARSE_WORKER_TIMEOUT_MS = 120_000;

const IMPORT_SOURCE_OPTIONS: ImportSourceOption[] = [
  {
    value: 'auto',
    label: 'Auto-detect (Recommended)',
    description: 'Upload original export packages (.zip, .tgz/.tar.gz, .json, .ics); source is detected from package contents.',
  },
  {
    value: 'chatgpt',
    label: 'ChatGPT (Setup Ready)',
    description: 'Best with OpenAI export zip containing conversations.json (legacy conversations.json uploads still accepted).',
  },
  {
    value: 'gmail',
    label: 'Gmail',
    description: 'Google Takeout archive (.zip/.tgz) with Gmail MBOX files under Takeout/Mail.',
  },
  {
    value: 'amazon',
    label: 'Amazon',
    description: 'Amazon Request Your Data zip with Retail.OrderHistory*.csv (Digital/Returns optional).',
  },
  {
    value: 'claude',
    label: 'Claude',
    description: 'Claude export JSON package containing chat_messages conversation data.',
  },
  {
    value: 'notion',
    label: 'Notion',
    description: 'Notion export zip (Markdown & CSV or HTML), including index/page/database files.',
  },
  {
    value: 'gemini',
    label: 'Gemini',
    description: 'Gemini export JSON package with conversations data.',
  },
  {
    value: 'calendar',
    label: 'Calendar',
    description: 'Calendar export in .ics format (calendar.json fallback supported).',
  },
];

const SOURCE_PACKAGE_HINTS: Record<ImportSourceSelection, string> = {
  auto: 'Use Auto-detect for original export packages. If detection fails, select a specific source and retry.',
  chatgpt: 'Expected package: OpenAI export zip with conversations.json and chat.html (or legacy conversations.json file).',
  gmail: 'Expected package: Google Takeout zip/tgz with MBOX files in Takeout/Mail.',
  amazon: 'Expected package: Amazon Request Your Data zip containing Retail.OrderHistory*.csv.',
  claude: 'Expected package: Claude JSON export with chat_messages conversation arrays.',
  notion: 'Expected package: Notion zip export (Markdown & CSV or HTML).',
  gemini: 'Expected package: Gemini conversations JSON package.',
  calendar: 'Expected package: calendar.ics (calendar.json fallback supported).',
};

type ImportPackageWorkerResponse =
  | {
      ok: true;
      parsed: ParsedImportPackage;
    }
  | {
      ok: false;
      code?: PackageParseErrorCode;
      error: string;
    };

class ImportParseWorkerError extends Error {
  code?: PackageParseErrorCode;

  constructor(message: string, code?: PackageParseErrorCode) {
    super(message);
    this.name = 'ImportParseWorkerError';
    this.code = code;
  }
}

function parseImportPackageInWorker(
  file: File,
  selectedSource: ImportSourceSelection,
): Promise<ParsedImportPackage> {
  return file.arrayBuffer().then((bytes) => new Promise<ParsedImportPackage>((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL('../workers/importPackageWorker.ts', import.meta.url),
        { type: 'module' },
      );

      const timeout = window.setTimeout(() => {
        worker?.terminate();
        reject(new Error('Import package parser worker timed out'));
      }, IMPORT_PARSE_WORKER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<ImportPackageWorkerResponse>) => {
        window.clearTimeout(timeout);
        worker?.terminate();
        if (event.data.ok) {
          resolve(event.data.parsed);
          return;
        }
        reject(new ImportParseWorkerError(event.data.error, event.data.code));
      };

      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        worker?.terminate();
        reject(new Error(event.message || 'Import package parser worker failed'));
      };

      const payload = selectedSource === 'auto'
        ? { fileName: file.name, bytes }
        : { fileName: file.name, bytes, selectedSource };
      worker.postMessage(payload, [bytes]);
    } catch (error) {
      worker?.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }));
}

function packageParseErrorMessage(
  error: PackageParseError,
  selectedSource: ImportSourceSelection,
): string {
  const sourceHint = SOURCE_PACKAGE_HINTS[selectedSource];
  const securityCodes: PackageParseErrorCode[] = [
    'PATH_TRAVERSAL',
    'SYMLINK_ENTRY_REJECTED',
    'HARDLINK_ENTRY_REJECTED',
  ];
  const sizeCodes: PackageParseErrorCode[] = [
    'MAX_ENTRIES_EXCEEDED',
    'MAX_UNCOMPRESSED_BYTES_EXCEEDED',
    'MAX_SINGLE_FILE_BYTES_EXCEEDED',
    'NESTED_ARCHIVE_DEPTH_EXCEEDED',
  ];

  if (error.code === 'ADAPTER_PARSE_FAILED') {
    const detail = error.message.toLowerCase();
    if (selectedSource !== 'auto') {
      return `This package did not match ${SOURCE_TYPE_LABELS[selectedSource]} format. ${sourceHint}`;
    }
    if (detail.includes('could not detect source type')) {
      return `Could not detect source type from package contents. ${sourceHint}`;
    }
    return `Could not parse this package structure. ${sourceHint}`;
  }

  if (error.code === 'UNSUPPORTED_FORMAT') {
    return `Unsupported file type. Allowed extensions: ${SUPPORTED_UPLOAD_FORMATS}. ${sourceHint}`;
  }

  if (error.code === 'FORMAT_SPOOFED') {
    return `File extension and file content did not match. Re-export from the source and upload the original package.`;
  }

  if (securityCodes.includes(error.code)) {
    return `Import blocked for security: archive contains unsafe paths/links. Re-export from the source without modifying archive contents.`;
  }

  if (sizeCodes.includes(error.code)) {
    return `Package is too large or too deeply nested for browser parsing limits. Export a smaller scope or split the archive and retry.`;
  }

  return `Import rejected (${error.code}): ${error.message}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChatGPTExport(value: unknown): value is ChatGPTExport {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<ChatGPTExport>;
  return typeof maybe.title === 'string'
    && typeof maybe.create_time === 'number'
    && typeof maybe.update_time === 'number'
    && !!maybe.mapping
    && typeof maybe.mapping === 'object';
}

function asChatGPTExports(records: unknown[]): ChatGPTExport[] {
  if (!records.every(isChatGPTExport)) {
    throw new Error('The uploaded package did not contain valid ChatGPT conversation records');
  }
  return records;
}

export function Import({ onImportComplete }: ImportProps) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ImportSourceSelection>('auto');
  const selectedSourceOption = useMemo(
    () => IMPORT_SOURCE_OPTIONS.find((option) => option.value === selectedSource) ?? IMPORT_SOURCE_OPTIONS[0],
    [selectedSource],
  );

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);

    try {
      setProgress({ stage: 'parsing', progress: 10, message: 'Reading package...' });
      let parsingProgress = 10;
      const parsingTicker = window.setInterval(() => {
        parsingProgress = Math.min(parsingProgress + 2, 35);
        setProgress((current) => {
          if (!current || current.stage !== 'parsing') return current;
          return {
            ...current,
            progress: Math.max(current.progress, parsingProgress),
            message: 'Parsing package...',
          };
        });
      }, 250);

      let parsedPackage: ParsedImportPackage;
      try {
        parsedPackage = await parseImportPackageInWorker(file, selectedSource);
      } catch (workerError) {
        if (workerError instanceof ImportParseWorkerError && workerError.code) {
          throw new PackageParseError(workerError.code, workerError.message);
        }
        if (workerError instanceof Error && workerError.message.includes('timed out')) {
          throw new Error('Import is taking too long to parse. Try a smaller archive scope and retry.');
        }
        parsedPackage = await parseImportPackage(
          file,
          selectedSource === 'auto' ? {} : { selectedSource },
        );
      } finally {
        window.clearInterval(parsingTicker);
      }

      if (parsedPackage.warnings.length > 0) {
        for (const warning of parsedPackage.warnings) {
          toast(warning, 'info');
        }
      }

      if (parsedPackage.sourceType !== 'chatgpt') {
        const sourceLabel = SOURCE_TYPE_LABELS[parsedPackage.sourceType];
        setProgress({
          stage: 'complete',
          progress: 100,
          message: `${sourceLabel} package validated. Redirecting to Sources...`,
        });
        await sleep(600);
        setProgress(null);
        toast(
          `${sourceLabel} package parsed successfully. Continue extraction from the Sources page.`,
          'success',
        );
        navigate('/sources');
        return;
      }

      const conversations = asChatGPTExports(parsedPackage.records);

      await sleep(500); // Simulate processing
      setProgress({ stage: 'extracting', progress: 40, message: 'Extracting conversation records...' });

      await sleep(800);
      setProgress({ stage: 'analyzing', progress: 70, message: 'Analyzing patterns...' });

      await sleep(1000);
      setProgress({ stage: 'complete', progress: 100, message: 'Analysis complete!' });

      await sleep(500);
      onImportComplete(conversations);

    } catch (error) {
      console.error('Failed to process file:', error);
      setProgress(null);
      if (error instanceof PackageParseError) {
        toast(packageParseErrorMessage(error, selectedSource), 'error');
      } else if (error instanceof Error) {
        toast(error.message, 'error');
      } else {
        toast('Failed to process file. Please check the format and try again.', 'error');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [navigate, onImportComplete, selectedSource]);

  const handleFileDrop = useCallback((acceptedFiles: FileList | File[]) => {
    const files = Array.from(acceptedFiles);
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const handleSampleData = useCallback(async () => {
    setIsProcessing(true);

    try {
      setProgress({ stage: 'parsing', progress: 20, message: 'Loading sample data...' });
      await sleep(600);

      setProgress({ stage: 'extracting', progress: 50, message: 'Extracting conversation records...' });
      await sleep(800);

      setProgress({ stage: 'analyzing', progress: 80, message: 'Analyzing patterns...' });
      await sleep(1000);

      setProgress({ stage: 'complete', progress: 100, message: 'Analysis complete!' });
      await sleep(500);

      onImportComplete(sampleData as unknown as ChatGPTExport[]);
    } catch (error) {
      console.error('Failed to process sample data:', error);
      setProgress(null);
      toast('Failed to process sample data. Please try again.', 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [onImportComplete]);

  if (isProcessing && progress) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8">
        <div className="w-full max-w-2xl">
          {/* Processing Header */}
          <div className="text-center mb-12 animate-fade-in">
            <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6">
              {progress.stage === 'complete' ? (
                <FileText className="w-10 h-10 text-white" />
              ) : (
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              )}
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">
              {progress.stage === 'complete' ? 'Processing Complete!' : 'Processing Import'}
            </h1>
            <p className="text-white/60 text-lg">
              {progress.message}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <ProgressBar progress={progress.progress} />
          </div>

          {/* Status Messages */}
          <div className="space-y-3">
            <div className={`flex items-center space-x-3 ${progress.stage !== 'parsing' ? 'text-white/50' : 'text-white'}`}>
              <div className={`w-2 h-2 rounded-full ${progress.stage === 'parsing' ? 'bg-primary animate-pulse' : progress.progress > 20 ? 'bg-accent' : 'bg-white/30'}`} />
              <span>Parsing package</span>
            </div>
            <div className={`flex items-center space-x-3 ${progress.stage !== 'extracting' ? 'text-white/50' : 'text-white'}`}>
              <div className={`w-2 h-2 rounded-full ${progress.stage === 'extracting' ? 'bg-primary animate-pulse' : progress.progress > 50 ? 'bg-accent' : 'bg-white/30'}`} />
              <span>Extracting source records</span>
            </div>
            <div className={`flex items-center space-x-3 ${progress.stage !== 'analyzing' ? 'text-white/50' : 'text-white'}`}>
              <div className={`w-2 h-2 rounded-full ${progress.stage === 'analyzing' ? 'bg-primary animate-pulse' : progress.progress > 80 ? 'bg-accent' : 'bg-white/30'}`} />
              <span>Building your personas</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-8">
      {/* Header */}
      <div className="text-center mb-8 animate-fade-in">
        <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6">
          <Upload className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-white mb-4">
          Import Your Data
        </h1>
        <p className="text-xl text-white/70 max-w-2xl mx-auto">
          Upload the original export package from your data source. ChatGPT packages continue directly to persona setup.
        </p>
      </div>

      {/* Source Picker */}
      <div className="w-full max-w-3xl mb-4 animate-fade-in">
        <div className="glass-card p-4 border border-white/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <label htmlFor="import-source-picker" className="text-white font-medium block">
                Source
              </label>
              <p className="text-white/60 text-sm mt-1">
                {selectedSourceOption.description}
              </p>
            </div>
            <select
              id="import-source-picker"
              value={selectedSource}
              onChange={(event) => setSelectedSource(event.target.value as ImportSourceSelection)}
              className="px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50 min-w-64"
            >
              {IMPORT_SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Import Zone */}
      <div className="w-full max-w-3xl mb-6 animate-slide-up">
        <ImportZone
          onFileDrop={handleFileDrop}
          accept={SUPPORTED_UPLOAD_ACCEPT}
          ariaLabel={`Upload your ${selectedSource === 'auto' ? 'export package file' : `${SOURCE_TYPE_LABELS[selectedSource]} export package file`}`}
          idleTitle={selectedSource === 'auto' ? 'Drop your export package here' : `Drop your ${SOURCE_TYPE_LABELS[selectedSource]} export package here`}
          dropTitle="Drop your package here"
          idleDescription={selectedSource === 'auto'
            ? 'Or click to browse and select your original export package'
            : `Or click to browse and select your ${SOURCE_TYPE_LABELS[selectedSource]} export package`}
          dropDescription={selectedSource === 'auto'
            ? 'Release to upload your export package'
            : `Release to upload your ${SOURCE_TYPE_LABELS[selectedSource]} package`}
          supportedFormatsText={SUPPORTED_UPLOAD_FORMATS}
        />
      </div>

      {/* Divider */}
      <div className="flex items-center space-x-6 mb-6 w-full max-w-lg">
        <div className="flex-1 h-px bg-white/20"></div>
        <span className="text-white/40 text-sm font-medium">OR</span>
        <div className="flex-1 h-px bg-white/20"></div>
      </div>

      {/* Alternative paths */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-center animate-fade-in">
        <div className="text-center">
          <button
            onClick={() => navigate('/setup/quickstart')}
            className="btn-primary group px-6 py-3"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            Quick Questionnaire
          </button>
          <p className="text-white/50 text-sm mt-3 max-w-xs">
            Answer a few questions to build your personas in 2-4 minutes. No exports needed.
          </p>
        </div>
        <div className="text-center">
          <button
            onClick={handleSampleData}
            className="btn-secondary group"
            disabled={isProcessing}
          >
            <Database className="w-5 h-5 mr-2 group-hover:text-accent transition-colors" />
            Try ChatGPT Sample Data
          </button>
          <p className="text-white/50 text-sm mt-3 max-w-xs">
            Explore with realistic sample conversations and run the same setup flow.
          </p>
        </div>
      </div>

      {/* Footer Instructions */}
      <div className="mt-8 text-center text-white/40 text-sm max-w-2xl">
        <p className="mb-2">
          <strong>Supported package formats:</strong> <span className="font-mono">{SUPPORTED_UPLOAD_FORMATS}</span>
        </p>
        <p className="mb-2">
          Gmail: Takeout <span className="font-mono">.zip/.tgz</span> with MBOX. Amazon: Request Your Data <span className="font-mono">.zip</span> with <span className="font-mono">Retail.OrderHistory*.csv</span>. Notion: export <span className="font-mono">.zip</span> (Markdown/CSV or HTML).
        </p>
        <p className="mb-2">
          ChatGPT exports continue directly into persona setup. Other sources are validated here and routed to <strong>Sources</strong> for extraction workflows.
        </p>
        <p>
          Tip: keep source set to <strong>Auto-detect</strong> unless your package type is ambiguous.
        </p>
      </div>
    </div>
  );
}
