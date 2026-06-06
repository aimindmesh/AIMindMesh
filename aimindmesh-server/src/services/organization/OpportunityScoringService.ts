import { IdeaProposal } from './types';

export class OpportunityScoringService {
  score(input: { strategic: number; feasibility: number; novelty: number; privacy: number; maintenance: number }): number {
    return (
      input.strategic * 0.3 +
      input.feasibility * 0.25 +
      input.novelty * 0.15 +
      input.privacy * 0.2 +
      input.maintenance * 0.1
    );
  }

  applyScore(idea: IdeaProposal, scores: { strategic: number; feasibility: number; novelty: number; privacy: number; maintenance: number }): IdeaProposal {
    return {
      ...idea,
      strategicScore: scores.strategic,
      feasibilityScore: scores.feasibility,
      noveltyScore: scores.novelty,
      overallScore: this.score(scores),
      updatedAt: new Date().toISOString(),
    };
  }
}
