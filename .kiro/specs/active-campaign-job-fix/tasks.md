# Implementation Plan

## Overview

Fix the `ActiveCampaign` scheduled job by applying two surgical code changes — registering the `Campaign` Parse subclass and adding `{ useMasterKey: true }` to `findAll()` — validated through exploratory property tests before and preservation tests after the fix.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3.1", "3.2"] },
    { "wave": 4, "tasks": ["3.3", "3.4"] },
    { "wave": 5, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - ActiveCampaign throws on every invocation
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms both defects exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface the concrete counterexample `activeCampaign({})` → throws `"non-existent class: Campaign"`
  - **Scoped PBT Approach**: Bug is deterministic (structural, not data-dependent) — scope the property to all invocations of `activeCampaign`; any call is a counterexample
  - Create `src/cloud/job/campaign/index.spec.ts`
  - Mock `Parse.Query` to simulate the ACL rejection: when `findAll()` is called without `{ useMasterKey: true }`, reject with `Error("This user is not allowed to access non-existent class: Campaign")`
  - Test 1 — basic invocation, no campaigns: call `activeCampaign({})`, assert it throws the known error string
  - Test 2 — subclass resolution: assert `new Parse.Query(Campaign).className` is `undefined` before `registerSubclass` is called (confirm Defect B)
  - Test 3 — invocation with a due campaign seeded: mock returns one `PENDING` campaign with `publicAt = yesterday`; assert `activeCampaign({})` still throws (campaign is never saved)
  - Run tests: `npm test -- --testPathPattern="job/campaign/index.spec"` — expect ALL to FAIL
  - Document counterexamples found (e.g., `activeCampaign({})` rejects immediately, no `.save()` calls reached)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-bug-condition behaviors remain unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe unfixed code behavior for inputs where `isBugCondition` does NOT hold, then write assertions
  - Scope: all code paths that do NOT involve `activeCampaign`'s two defects: `expireCampaign`, `beforeSave`/`afterSave` triggers, campaigns with `publicAt > now`, the schedule-cancel path
  - Create `src/cloud/job/campaign/expire.spec.ts` for `expireCampaign` preservation
  - Create `src/cloud/campaign/index.spec.ts` for `beforeSave` trigger preservation (or augment if file exists)
  - **Preservation Test A — `expireCampaign` unaffected:** mock `Parse.Query` returning ACTIVE campaigns past `endDate`; verify `findAll({ useMasterKey: true })` is called and each campaign is saved with `status = EXPIRED`; verify it is NOT broken by the model change
  - **Preservation Test B — future campaigns stay PENDING:** generate property: for any campaign with `publicAt > now`, `activeCampaign` (when it eventually runs correctly) does not transition it; assert `save` is never called for future campaigns
  - **Preservation Test C — cancel path preserved:** mock `nextCampainQuery.first()` returning `undefined`; assert `jobScheduleActiveCampaign.cancel()` is called when no future PENDING campaign exists
  - **Preservation Test D — `beforeSave` rescheduling unaffected:** mock a new Campaign `isNew() === true`; assert `jobScheduleActiveCampaign.reschedule()` is still called by the trigger
  - Run tests on unfixed code: `npm test -- --testPathPattern="(expire|cloud/campaign)"` — expect ALL to PASS
  - Document observed behavior as the baseline to preserve
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix the ActiveCampaign job — register subclass and add useMasterKey
  - [ ] 3.1 Register the Campaign subclass in `src/models/campaign.ts`
    - Open `src/models/campaign.ts`
    - After the closing brace of the `Campaign` class declaration, add: `Parse.Object.registerSubclass('Campaign', Campaign);`
    - This must appear at module level (not inside any function) so it executes when the module is imported
    - Verify: `new Parse.Query(Campaign).className` now returns `"Campaign"` instead of `undefined`
    - _Bug_Condition: `NOT Parse.Object.registeredSubclass('Campaign')` (Defect B from design)_
    - _Expected_Behavior: `new Parse.Query(Campaign).className === "Campaign"` for all query constructions_
    - _Preservation: No other model files are touched; `expireCampaign` and `beforeSave` imports of Campaign are unaffected_
    - _Requirements: 2.3_

  - [ ] 3.2 Add `{ useMasterKey: true }` to `findAll()` in `src/cloud/job/campaign/index.ts`
    - Open `src/cloud/job/campaign/index.ts`
    - Change `.findAll()` (line ~14) to `.findAll({ useMasterKey: true })`
    - This mirrors the exact pattern already used in `expire.ts` (line 19) and on the `campaign.save()` call directly below
    - Do NOT change any other line — `nextCampainQuery.first()`, `campaign.save()`, and `jobScheduleActiveCampaign` logic are untouched
    - _Bug_Condition: `activeCampaign calls query.findAll() WITHOUT useMasterKey: true` (Defect A from design)_
    - _Expected_Behavior: Parse Server bypasses ACL restrictions; query returns all PENDING campaigns with `publicAt ≤ now`_
    - _Preservation: `nextCampainQuery.first()` call, the `.cancel()` path, and `forEach` save loop are byte-for-byte unchanged_
    - _Requirements: 2.1, 2.2_

  - [ ] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - ActiveCampaign executes without error
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior (no throw, campaigns saved to ACTIVE)
    - Run: `npm test -- --testPathPattern="job/campaign/index.spec"`
    - **EXPECTED OUTCOME**: ALL tests PASS (confirms both defects are fixed)
    - If test 2 (subclass resolution) still fails, verify `registerSubclass` is called at module load time and the spec imports the model file
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-affected behavior unchanged after fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `npm test -- --testPathPattern="(expire|cloud/campaign)"`
    - **EXPECTED OUTCOME**: ALL preservation tests still PASS (confirms no regressions)
    - Pay particular attention to `expireCampaign` — it imports `Campaign` from the same model file that now has `registerSubclass`; confirm it still works identically
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite: `npm test`
  - All four test files must pass: `index.spec.ts` (bug condition), `expire.spec.ts`, `cloud/campaign/index.spec.ts`, and any other existing specs
  - Confirm zero regressions across the suite
  - If any test fails unexpectedly, investigate before proceeding — do not suppress failures
  - Ask the user if any questions arise about test setup (Parse mock strategy, module initialization order, etc.)

## Notes

- Test framework: Jest + ts-jest (see `package.json` jest config). Run tests with `npm test -- --testPathPattern="<pattern>"` for targeted runs.
- Task 1 tests are expected to FAIL on unfixed code — this is correct and confirms the bug exists. Do not fix the code to make task 1 pass; proceed to task 3 instead.
- Task 2 tests are expected to PASS on unfixed code — they establish the baseline for preservation.
- The `nextCampainQuery.first()` call (note the typo in the original source) may also need `{ useMasterKey: true }` — confirm during exploratory testing in task 1, but the design scopes the required fix to `findAll()` only.
- `Parse.Object.registerSubclass` must be called at module load time (top level), not inside a function, so it executes on `import`.
