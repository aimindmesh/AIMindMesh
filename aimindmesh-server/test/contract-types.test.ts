import { describe, expectTypeOf, it } from 'vitest';
import type * as Api from '../src/types/api';
import type { AiTaskDefinition, AiTaskExecution, AiTaskStatus } from '../src/types/aiTask';
import type { Directive, IdeaProposal, OrgRole, RoleCreationProposal } from '../src/services/organization/types';
import type { FeedItem, FeedReply } from '../src/services/FeedManager';
import type { WikiPage, WikiPageSummary } from '../src/services/WikiManager';
import type { JobStatus } from '../src/services/DocumentIngester';

/**
 * Compile-time contract: the server's internal types must stay assignable to the
 * shared API types the clients compile against (checked by `npm run typecheck:test`).
 */
describe('server types match the shared API contract', () => {
  it('AI tasks', () => {
    expectTypeOf<AiTaskDefinition>().toMatchTypeOf<Api.AiTaskDefinition>();
    expectTypeOf<AiTaskExecution>().toMatchTypeOf<Api.AiTaskExecution>();
    expectTypeOf<AiTaskStatus>().toEqualTypeOf<Api.AiExecutionStatus>();
  });

  it('organization', () => {
    expectTypeOf<Directive>().toMatchTypeOf<Api.Directive>();
    expectTypeOf<OrgRole>().toMatchTypeOf<Api.OrgRole>();
    expectTypeOf<RoleCreationProposal>().toMatchTypeOf<Api.RoleCreationProposal>();
    expectTypeOf<IdeaProposal>().toMatchTypeOf<Api.IdeaProposal>();
  });

  it('feed, wiki and ingestion', () => {
    expectTypeOf<FeedItem>().toMatchTypeOf<Api.FeedItem>();
    expectTypeOf<FeedReply>().toMatchTypeOf<Api.FeedReply>();
    expectTypeOf<WikiPage>().toMatchTypeOf<Api.WikiPage>();
    expectTypeOf<WikiPageSummary>().toMatchTypeOf<Api.WikiPageSummary>();
    expectTypeOf<JobStatus>().toMatchTypeOf<Api.IngestionJob>();
  });
});
