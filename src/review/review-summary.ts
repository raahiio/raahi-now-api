import { sql } from 'kysely';
import type { ReviewKind } from '../db/schema.js';

/** The latest decision on a Drop or event, shown to its owner and to reviewers. Never public. */
export interface ReviewSummary {
  state: 'approved' | 'rejected' | 'removed';
  reason: string | null;
  decidedAt: string;
}

/**
 * Correlated subquery for the latest decided review row of `ref`, as a `review` column
 * (`ReviewSummary | null`). Runs on the app connection only: the public role cannot read review_items.
 */
export function latestReview(kind: ReviewKind, ref: 'drops.id' | 'events.id') {
  return sql<ReviewSummary | null>`(
    select json_build_object(
      'state', ri.state,
      'reason', ri.reason,
      'decidedAt', to_char(ri.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    from review_items ri
    where ri.kind = ${kind} and ri.ref_id = ${sql.ref(ref)} and ri.state <> 'pending'
    order by ri.decided_at desc, ri.id desc
    limit 1
  )`.as('review');
}
