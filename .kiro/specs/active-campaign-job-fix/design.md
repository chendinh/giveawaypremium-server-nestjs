# ActiveCampaign Job Fix — Bugfix Design

## Overview

The `ActiveCampaign` scheduled job fails on every execution with the error
`"This user is not allowed to access non-existent class: Campaign"`. This
prevents `PENDING` campaigns from auto-transitioning to `ACTIVE` — they must
be activated manually from the Parse Dashboard.

Two independent defects combine to cause the failure:

1. `activeCampaign()` calls `query.findAll()` without `{ useMasterKey: true }`,
   so Parse Server rejects the unauthenticated read against the ACL-protected
   `Campaign` class.
2. The `Campaign` subclass is never registered via
   `Parse.Object.registerSubclass('Campaign', Campaign)`, so Parse cannot
   resolve the JavaScript class to the `"Campaign"` collection name at runtime.

The fix is minimal and surgical: add `{ useMasterKey: true }` to the
`findAll()` call in `src/cloud/job/campaign/index.ts`, and add
`Parse.Object.registerSubclass('Campaign', Campaign)` at the bottom of
`src/models/campaign.ts`. No schema, logic, or business rule changes are
required.

---

## Glossary

- **Bug_Condition (C)**: Holds for every execution of `activeCampaign()` while
  both defects are present — the subclass is unregistered AND `findAll()` lacks
  `useMasterKey`.
- **Property (P)**: The job runs to completion without throwing, and every
  `PENDING` campaign whose `publicAt ≤ now` is saved with `status = ACTIVE`.
- **Preservation**: All other behavior — `expireCampaign`, `beforeSave`
  rescheduling, campaigns with a future `publicAt`, the schedule-cancel path —
  must remain byte-for-byte identical after the fix.
- **`activeCampaign`**: The async function in
  `src/cloud/job/campaign/index.ts` that is the subject of this fix.
- **`expireCampaign`**: The working counterpart in
  `src/cloud/job/campaign/expire.ts`; its `{ useMasterKey: true }` call is the
  correct pattern this fix mirrors.
- **`jobScheduleActiveCampaign`**: The `node-schedule` job in
  `src/cloud/schedule/index.ts` that fires `activeCampaign` on a cron schedule.
- **`CampaignStatusEnums`**: Enum with values `PENDING`, `ACTIVE`, `EXPIRED`
  defined in `src/models/campaign.ts`.

---

## Bug Details

### Bug Condition

The bug fires unconditionally on every invocation of `activeCampaign()` because
both defects are structural (not data-dependent). Parse throws before any
campaign record is read.

**Defect A — Missing `useMasterKey`:**

```typescript
// src/cloud/job/campaign/index.ts — CURRENT (buggy)
const campaigns = await query
  .equalTo('status', CampaignStatusEnums.PENDING)
  .lessThanOrEqualTo('publicAt', now.toDate())
  .findAll(); // ← no { useMasterKey: true }
```

Parse Server evaluates the request as unauthenticated. The `Campaign` class
has ACLs that block public reads, so the server rejects it with:
`"This user is not allowed to access non-existent class: Campaign"`.

**Defect B — Unregistered subclass:**

```typescript
// src/models/campaign.ts — CURRENT (buggy)
export class Campaign extends Parse.Object {
  constructor() {
    super('Campaign');
  }
}
// registerSubclass() is never called
```

When `new Parse.Query(Campaign)` is evaluated at runtime, Parse's internal
registry lookup fails to find the class name mapping, producing the same
`"non-existent class"` error.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT:  X of type JobExecutionContext (a single run of activeCampaign)
  OUTPUT: boolean

  // Both conditions are structural — present on every invocation
  subclassNotRegistered ← NOT Parse.Object.registeredSubclass('Campaign')
  findAllLacksMasterKey ← activeCampaign calls query.findAll() WITHOUT useMasterKey: true

  RETURN subclassNotRegistered OR findAllLacksMasterKey
END FUNCTION
```

### Examples

- **Normal run (no campaigns due):** `activeCampaign({})` is called → throws
  `"This user is not allowed to access non-existent class: Campaign"` before
  reading any records. Expected: returns cleanly with no saves.
- **Run with one due campaign:** `publicAt = yesterday`, `status = PENDING` →
  same throw. Expected: that campaign is saved with `status = ACTIVE`.
- **Run with multiple due campaigns:** 5 campaigns qualify → same throw.
  Expected: all 5 are saved to `ACTIVE` in parallel.
- **`nextCampaign` query (second query in the function):** Also uses
  `new Parse.Query(Campaign)` without `useMasterKey` — will fail the same way
  once Defect A is fixed but Defect B remains.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `expireCampaign` job and its `{ useMasterKey: true }` call are not touched
  and must continue to transition `ACTIVE → EXPIRED` correctly.
- `beforeSave` trigger on `Campaign` (`src/cloud/campaign/index.ts`) continues
  to reschedule `jobScheduleActiveCampaign` on `isNew()` and
  `jobScheduleExpireCampaign` when status transitions to `ACTIVE`.
- Campaigns with `publicAt > now` continue to be ignored by `activeCampaign`
  (the `lessThanOrEqualTo` filter is untouched).
- When no future `PENDING` campaign exists, `jobScheduleActiveCampaign.cancel()`
  is still called (the cancel logic is untouched).
- The `nextCampainQuery` (second query inside `activeCampaign`) continues to
  use `greaterThan('publicAt', now.toDate())` to look ahead for the next
  scheduled campaign.

**Scope:**

All code paths that do NOT involve the `activeCampaign` execution context are
completely unaffected. Specifically:

- Mouse clicks / manual admin saves from the Parse Dashboard
- `expireCampaign` job
- `beforeSave` / `afterSave` triggers on `Campaign`
- Any other Parse class or job

---

## Hypothesized Root Cause

1. **Missing `useMasterKey` on `findAll()`**: The developer copied the query
   structure from an earlier, unprotected pattern and did not add
   `{ useMasterKey: true }`. Comparing with `expireCampaign` (same directory)
   makes the omission obvious — `expire.ts` line 19 reads
   `await query.findAll({ useMasterKey: true })` while `index.ts` has only
   `await query.findAll()` with no options object.

2. **Unregistered Parse subclass**: The `Campaign` class in
   `src/models/campaign.ts` calls `super('Campaign')` in its constructor,
   which is correct for new instances. However, Parse's query engine uses a
   separate class registry to resolve `new Parse.Query(Campaign)` to a
   collection name. Without `Parse.Object.registerSubclass('Campaign', Campaign)`,
   the registry lookup returns `undefined` and Parse emits the
   `"non-existent class"` error. All other model files in `src/models/` appear
   to have the same omission — confirming this is a project-wide pattern gap,
   not a one-off mistake.

---

## Correctness Properties

Property 1: Bug Condition — ActiveCampaign Executes Without Error

_For any_ job execution context where both defects are present
(`isBugCondition(X) = true`), the fixed `activeCampaign` function SHALL
complete without throwing an exception AND SHALL save every `PENDING` campaign
with `publicAt ≤ now` to `status = ACTIVE` using `{ useMasterKey: true }`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Non-Affected Behavior Unchanged

_For any_ code path where the bug condition does NOT hold (i.e., all paths
outside `activeCampaign` execution: `expireCampaign`, `beforeSave` triggers,
campaigns with `publicAt > now`, the schedule-cancel path), the fixed code
SHALL produce exactly the same behavior as the original code.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File 1:** `src/models/campaign.ts`

**Change:** Register the subclass immediately after the class declaration so
Parse's registry is populated before any query or trigger executes.

```typescript
// BEFORE
export class Campaign extends Parse.Object {
  constructor() {
    super('Campaign');
  }
}

// AFTER
export class Campaign extends Parse.Object {
  constructor() {
    super('Campaign');
  }
}
Parse.Object.registerSubclass('Campaign', Campaign);
```

**File 2:** `src/cloud/job/campaign/index.ts`

**Change:** Add `{ useMasterKey: true }` to the `findAll()` call, mirroring
the pattern already used in `expire.ts` and in the per-campaign `save()` call
on the very next line.

```typescript
// BEFORE
const campaigns = await query
  .equalTo('status', CampaignStatusEnums.PENDING)
  .lessThanOrEqualTo('publicAt', now.toDate())
  .findAll();

// AFTER
const campaigns = await query
  .equalTo('status', CampaignStatusEnums.PENDING)
  .lessThanOrEqualTo('publicAt', now.toDate())
  .findAll({ useMasterKey: true });
```

No other lines, files, or logic need to change. The second query
(`nextCampainQuery.first()`) does not use `findAll` and is a non-list read —
it may also need `{ useMasterKey: true }` if the ACL blocks it, which should
be confirmed during exploratory testing.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach:

1. **Exploratory phase** — run tests against the unfixed code to reproduce the
   error and confirm the root cause analysis.
2. **Fix + preservation phase** — apply the fix, re-run, and verify both that
   the bug is gone and that surrounding behavior is unchanged.

### Exploratory Bug Condition Checking

**Goal:** Surface a concrete counterexample that reproduces the error on the
unfixed code. Confirm both root causes (unregistered subclass AND missing
`useMasterKey`) before writing the fix.

**Test Plan:** Call `activeCampaign({})` in a test environment backed by a real
or mock Parse Server instance that has ACLs enabled on the `Campaign` class.
Assert that the error is thrown and matches the known error string.

**Test Cases:**

1. **Basic invocation — no campaigns:** Seed 0 campaigns. Call
   `activeCampaign({})`. On unfixed code: throws
   `"This user is not allowed to access non-existent class: Campaign"`.
2. **Invocation with due campaign:** Seed 1 `PENDING` campaign with
   `publicAt = yesterday`. Call `activeCampaign({})`. On unfixed code: same
   throw — campaign remains `PENDING`.
3. **Subclass resolution check:** Call `new Parse.Query(Campaign).className`.
   On unfixed code: `undefined` or an error. On fixed code: `"Campaign"`.
4. **`nextCampainQuery` path:** Seed 1 `PENDING` campaign with
   `publicAt = tomorrow`. Call `activeCampaign({})`. Verify whether
   `nextCampainQuery.first()` also throws without `useMasterKey`.

**Expected Counterexamples:**

- `activeCampaign({})` throws immediately — no campaigns are read or updated.
- Possible stack trace origin: `Parse.Query.findAll()` → Parse Server ACL check
  → `"This user is not allowed to access non-existent class: Campaign"`.

### Fix Checking

**Goal:** Verify that after the fix, for all inputs where the bug condition
held, the function now produces the correct result.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  result ← activeCampaign_fixed(X)
  ASSERT no_error(result)
  ASSERT campaigns_with_publicAt_lte_now_have_status_ACTIVE(result)
END FOR
```

**Test Cases:**

1. `activeCampaign({})` with 0 due campaigns → resolves without error, no saves.
2. `activeCampaign({})` with 1 due campaign → resolves, that campaign is `ACTIVE`.
3. `activeCampaign({})` with N due campaigns → resolves, all N are `ACTIVE`.
4. `activeCampaign({})` with due + future campaigns mixed → only due ones
   transition; future ones remain `PENDING`.

### Preservation Checking

**Goal:** Verify that all behavior outside the bug condition is unchanged after
the fix.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT activeCampaign_original(X) = activeCampaign_fixed(X)
END FOR
```

**Testing Approach:** Property-based testing is appropriate here because it
generates a wide range of campaign states (random `publicAt` dates, random
`status` values) and asserts that the fixed function's outputs for non-buggy
inputs are indistinguishable from the original.

**Test Cases:**

1. **Future campaigns stay PENDING:** Seed campaigns with `publicAt = tomorrow`.
   Run `activeCampaign_fixed`. Assert all remain `PENDING`.
2. **Cancel path preserved:** Seed 0 future `PENDING` campaigns. Run job.
   Assert `jobScheduleActiveCampaign` is cancelled (`.cancel()` called).
3. **`expireCampaign` unaffected:** Run `expireCampaign` before and after
   applying the `Campaign` model change. Assert behavior is identical.
4. **`beforeSave` rescheduling unaffected:** Save a new `Campaign` (isNew=true).
   Assert `jobScheduleActiveCampaign.reschedule()` is still called.

### Unit Tests

- Test that `Parse.Object.registeredSubclass('Campaign')` returns the `Campaign`
  class after the model file is imported.
- Test that `new Parse.Query(Campaign).className` equals `"Campaign"` after fix.
- Test `activeCampaign` with a mocked `Parse.Query` — assert `findAll` is called
  with `{ useMasterKey: true }`.
- Test edge cases: empty result set, single result, multiple results.

### Property-Based Tests

- Generate random arrays of campaign objects with random `status` and `publicAt`
  values; assert that only those with `status = PENDING` and `publicAt ≤ now`
  are transitioned to `ACTIVE` after the fix.
- Generate random campaign states for preservation check; assert that non-buggy
  inputs produce the same outcome as before the fix.
- Test that `nextCampaign` lookup (the `first()` call) behaves correctly across
  many random `publicAt` values — verifying the cancel/reschedule decision.

### Integration Tests

- Boot the NestJS + Parse Server stack in a test environment; trigger
  `activeCampaign` via `jobScheduleActiveCampaign` and assert the job completes
  successfully end-to-end.
- Seed a `PENDING` campaign with `publicAt = 1 minute ago`; wait for the cron
  to fire; assert the campaign is `ACTIVE` in MongoDB.
- Run both `activeCampaign` and `expireCampaign` in sequence; assert no
  interference between the two jobs.
