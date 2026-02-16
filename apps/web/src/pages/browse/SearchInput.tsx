import { Search, X } from 'lucide-react';

type SearchTheme = 'dark' | 'gmail' | 'amazon' | 'notion' | 'chatgpt' | 'claude';

const THEME_STYLES: Record<SearchTheme, { input: string; icon: string; clear: string }> = {
  dark: {
    input: 'bg-white/10 border border-card-border/50 text-white placeholder:text-text-tertiary focus:ring-1 focus:ring-primary',
    icon: 'text-text-tertiary',
    clear: 'text-text-tertiary hover:text-white',
  },
  gmail: {
    input: 'bg-[#eaf1fb] border-none text-[#202124] placeholder:text-[#5f6368] focus:ring-1 focus:ring-[#1a73e8]',
    icon: 'text-[#5f6368]',
    clear: 'text-[#5f6368] hover:text-[#202124]',
  },
  amazon: {
    input: 'bg-white border border-[#888c8c] text-[#0f1111] placeholder:text-[#767676] focus:ring-1 focus:ring-[#e77600]',
    icon: 'text-[#555]',
    clear: 'text-[#555] hover:text-[#0f1111]',
  },
  notion: {
    input: 'bg-[#f7f6f3] border-none text-[#37352f] placeholder:text-[#9b9a97] focus:ring-1 focus:ring-[#2eaadc]',
    icon: 'text-[#9b9a97]',
    clear: 'text-[#9b9a97] hover:text-[#37352f]',
  },
  chatgpt: {
    input: 'bg-[#f0f0f0] border-none text-[#0d0d0d] placeholder:text-[#6e6e80] focus:ring-1 focus:ring-[#10a37f]',
    icon: 'text-[#6e6e80]',
    clear: 'text-[#6e6e80] hover:text-[#0d0d0d]',
  },
  claude: {
    input: 'bg-[#e8e2d6] border-none text-[#2d2b28] placeholder:text-[#8a8784] focus:ring-1 focus:ring-[#da7756]',
    icon: 'text-[#8a8784]',
    clear: 'text-[#8a8784] hover:text-[#2d2b28]',
  },
};

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  theme?: SearchTheme;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className, theme = 'dark' }: SearchInputProps) {
  const s = THEME_STYLES[theme];

  return (
    <div className={`relative ${className ?? ''}`}>
      <Search className={`w-4 h-4 ${s.icon} absolute left-3 top-1/2 -translate-y-1/2`} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none ${s.input}`}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className={`absolute right-2 top-1/2 -translate-y-1/2 ${s.clear}`}
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
