import type { SelectorGroup } from '../ui/CategorizedSelector';

/** Colour of a candidate severity badge (list and detail). */
export const SEVERITY_COLOR = (s: number) =>
  s >= 8 ? 'bg-error/20 text-error' : s >= 5 ? 'bg-warning/20 text-warning' : 'bg-primary/20 text-primary';

/** Colour of a candidate status badge (list and detail). */
export const CANDIDATE_STATUS_COLOR = (s: string) => {
  if (s === 'pending') return 'bg-surface text-muted-foreground';
  if (s === 'generating') return 'bg-warning/20 text-warning';
  if (s === 'validating') return 'bg-primary/20 text-primary';
  if (s === 'proposed') return 'bg-success/20 text-success';
  if (s === 'failed') return 'bg-error/20 text-error';
  return 'bg-surface text-muted-foreground';
};

/** The categorized selector opened by the evolution view (route a task, preferred node). */
export interface SelectorConfig {
  title: string;
  groups: SelectorGroup[];
  onSelect: (v: string) => void;
  currentValue: string;
}
