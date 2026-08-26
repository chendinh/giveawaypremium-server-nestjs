# Bugfix Requirements Document

## Introduction

The `ActiveCampaign` scheduled job fails on every execution with the error:
`[Jobs] ActiveCampaign failed: This user is not allowed to access non-existent class: Campaign`

The job is responsible for finding all `Campaign` records with status `PENDING` whose `publicAt` date has passed, then transitioning them to `ACTIVE`. Because it fails silently, campaigns never auto-activate — they must be activated manually from the dashboard.

The `ExpireCampaign` job (which transitions `ACTIVE` → `EXPIRED`) works correctly because it passes `{ useMasterKey: true }` to `query.findAll()`. The `ActiveCampaign` job does not, causing Parse Server to reject the unauthenticated query against the `Campaign` class.

Additionally, the `Campaign` Parse.Object subclass is never registered via `Parse.Object.registerSubclass()`, which is required for Parse Server to resolve the class name from a JavaScript subclass instance.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the `ActiveCampaign` scheduled job executes THEN the system throws `"This user is not allowed to access non-existent class: Campaign"` and no campaigns are activated

1.2 WHEN `activeCampaign` calls `query.findAll()` on the `Campaign` class THEN the system rejects the query because no master key is provided and the class ACL blocks unauthenticated access

1.3 WHEN the `Campaign` subclass is instantiated as `new Parse.Query(Campaign)` THEN the system cannot resolve the class name because `Parse.Object.registerSubclass('Campaign', Campaign)` has never been called

### Expected Behavior (Correct)

2.1 WHEN the `ActiveCampaign` scheduled job executes THEN the system SHALL successfully query all `PENDING` campaigns whose `publicAt` ≤ now without throwing an error

2.2 WHEN `activeCampaign` calls `query.findAll()` THEN the system SHALL use `{ useMasterKey: true }` so that the query bypasses ACL restrictions, consistent with how `expireCampaign` operates

2.3 WHEN the `Campaign` Parse.Object subclass is used in a query THEN the system SHALL correctly resolve it to the `"Campaign"` class name because `Parse.Object.registerSubclass('Campaign', Campaign)` has been called before any query executes

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `publicAt` is in the future for a `PENDING` campaign THEN the system SHALL CONTINUE TO leave its status unchanged during the `ActiveCampaign` job run

3.2 WHEN no `PENDING` campaigns have a `publicAt` ≤ now THEN the system SHALL CONTINUE TO cancel the `jobScheduleActiveCampaign` schedule (no next campaign exists)

3.3 WHEN a campaign's status is `ACTIVE` and its `endDate` has passed THEN the system SHALL CONTINUE TO be expired correctly by the `ExpireCampaign` job without any regression

3.4 WHEN a new `Campaign` is saved with `isNew() === true` THEN the system SHALL CONTINUE TO reschedule `jobScheduleActiveCampaign` via `beforeSave`

3.5 WHEN a campaign transitions to `ACTIVE` status THEN the system SHALL CONTINUE TO reschedule `jobScheduleExpireCampaign` via `beforeSave`

---

## Bug Condition

**Bug Condition Function:**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type JobExecutionContext (ActiveCampaign job run)
  OUTPUT: boolean

  // Bug fires whenever activeCampaign() is called, because:
  // (a) Campaign subclass is not registered with Parse, AND
  // (b) findAll() is called without useMasterKey: true
  RETURN true  // every invocation is affected
END FUNCTION
```

**Property — Fix Checking:**

```pascal
// Property: Fix Checking — ActiveCampaign executes without error
FOR ALL X WHERE isBugCondition(X) DO
  result ← activeCampaign'(X)
  ASSERT no_error(result)
  ASSERT campaigns_with_publicAt_lte_now_have_status_ACTIVE(result)
END FOR
```

**Property — Preservation Checking:**

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT activeCampaign(X) = activeCampaign'(X)
END FOR
```
