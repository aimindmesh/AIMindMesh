import type { IdeaProposal } from '../../services/organizationApi';

/** Web pages an idea was derived from (links), or the legacy text signals of older ideas. */
export function IdeaSources({ idea }: { idea: Pick<IdeaProposal, 'sources' | 'sourceSignals'> }) {
  if (idea.sources?.length) {
    return (
      <ul className="space-y-1">
        {idea.sources.map(source => (
          <li key={source.url} className="text-[11px] truncate">
            <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-blue-400 underline">{source.title}</a>
          </li>
        ))}
      </ul>
    );
  }
  if (!idea.sourceSignals?.length) return <p className="text-[11px] text-slate-500">No sources recorded.</p>;
  return (
    <ul className="space-y-1 list-disc list-inside">
      {idea.sourceSignals.map((signal, i) => (
        <li key={i} className="text-[11px] text-slate-400 line-clamp-2">{signal}</li>
      ))}
    </ul>
  );
}
