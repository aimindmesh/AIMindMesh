import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface DropdownProps {
  options: (DropdownOption | DropdownGroup)[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function Dropdown({ options, value, onChange, className = '', disabled = false }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const allOptions = options.reduce((acc: DropdownOption[], curr) => {
    if ('options' in curr) {
      return [...acc, ...curr.options];
    }
    return [...acc, curr];
  }, []);

  const selectedOption = allOptions.find(o => o.value === value);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-surface hover:bg-surface-hover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="truncate">{selectedOption?.label || value || 'Select option...'}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-border shadow-2xl rounded-lg py-1 max-h-[400px] overflow-auto custom-scrollbar animate-in slide-in-from-top-1 fade-in duration-200 border-secondary/20">
          {options.map((item, idx) => {
            if ('options' in item) {
              return (
                <div key={idx}>
                  <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 bg-muted/5">
                    {item.label}
                  </div>
                  {item.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-primary/10 transition-colors ${
                        option.value === value ? 'bg-primary/5 text-primary font-medium' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate pl-2">{option.label}</span>
                      {option.value === value && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              );
            }
            return (
              <button
                key={item.value}
                onClick={() => {
                  onChange(item.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-primary/10 transition-colors ${
                  item.value === value ? 'bg-primary/5 text-primary font-medium' : 'text-foreground'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.value === value && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
