import React from 'react';
import type { IdeaProposal } from '../../services/organizationApi';

/** Web pages an idea was derived from (links), or the legacy text signals of older ideas. */
export const IdeaSources: React.FC<{ idea: Pick<IdeaProposal, 'sources' | 'sourceSignals'> }> = ({ idea }) => {
  if (idea.sources?.length) {
    return (
      <ul className="space-y-1">
        {idea.sources.map(source => (
          <li key={source.url} className="text-[10px] truncate">
            <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-blue-400 underline">{source.title}</a>
          </li>
        ))}
      </ul>
    );
  }
  if (!idea.sourceSignals?.length) return <p className="text-[10px] text-text-secondary">No sources recorded.</p>;
  return (
    <ul className="space-y-1 list-disc list-inside">
      {idea.sourceSignals.map((signal, i) => (
        <li key={i} className="text-[10px] text-text-secondary line-clamp-2">{signal}</li>
      ))}
    </ul>
  );
};
