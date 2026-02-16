import { useState, useCallback, useRef } from 'react';
import { FileText, Upload } from 'lucide-react';

interface ImportZoneProps {
  onFileDrop: (files: FileList | File[]) => void;
  accept?: string;
  ariaLabel?: string;
  idleTitle?: string;
  dropTitle?: string;
  idleDescription?: string;
  dropDescription?: string;
  supportedFormatsText?: string;
}

const DEFAULT_ACCEPT = '.json,.zip,.tgz,.tar.gz,.ics';

export function ImportZone({
  onFileDrop,
  accept = DEFAULT_ACCEPT,
  ariaLabel = 'Upload your export package file',
  idleTitle = 'Drop your export package here',
  dropTitle = 'Drop your file here',
  idleDescription = 'Or click to browse and select your original export package',
  dropDescription = 'Release to upload your export package',
  supportedFormatsText = '.json, .zip, .tgz, .tar.gz, .ics',
}: ImportZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileDrop(e.dataTransfer.files);
    }
  }, [onFileDrop]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileDrop(e.target.files);
    }
  }, [onFileDrop]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleFileSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFileSelect(); } }}
      className={`
        glass-card p-12 border-2 border-dashed cursor-pointer transition-all duration-300
        ${isDragOver 
          ? 'border-accent bg-accent/5 scale-105' 
          : 'border-white/30 hover:border-primary hover:bg-primary/5'
        }
        relative overflow-hidden group
      `}
    >
      {/* Background Animation */}
      <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-5 transition-opacity duration-300" />
      
      {/* Content */}
      <div className="relative text-center space-y-6">
        {/* Icon */}
        <div className={`
          w-20 h-20 mx-auto rounded-full flex items-center justify-center transition-all duration-300
          ${isDragOver 
            ? 'bg-accent/20 text-accent scale-110' 
            : 'bg-white/10 text-white/70 group-hover:bg-primary/20 group-hover:text-primary group-hover:scale-110'
          }
        `}>
          {isDragOver ? (
            <Upload className="w-10 h-10" />
          ) : (
            <FileText className="w-10 h-10" />
          )}
        </div>

        {/* Text */}
        <div className="space-y-3">
          <h3 className={`
            text-2xl font-semibold transition-colors duration-300
            ${isDragOver ? 'text-accent' : 'text-white group-hover:text-primary'}
          `}>
            {isDragOver ? dropTitle : idleTitle}
          </h3>
          
          <p className="text-white/60 text-lg">
            {isDragOver ? dropDescription : idleDescription}
          </p>
        </div>

        {/* Supported Formats */}
        <div className="pt-4 border-t border-white/20">
          <p className="text-white/40 text-sm">
            Supported formats: <span className="text-white/60 font-mono">{supportedFormatsText}</span>
          </p>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Drag Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-accent/10 border-2 border-accent rounded-xl animate-pulse" />
      )}
    </div>
  );
}
