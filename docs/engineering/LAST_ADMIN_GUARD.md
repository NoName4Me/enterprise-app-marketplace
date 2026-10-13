# Last administrator protection

Status: implementation submitted for PostgreSQL/CI validation (not full authentication production readiness).

The Better Auth Admin plugin is responsible for authentication, password hashing, sessions and account management. The application adds a separate PostgreSQL trigger preventing an update or delete that would remove the only remaining active administrator.

A user counts as active admin when role contains admin and banned is false. The trigger intercepts:
- ban on the only active administrator;
- role downgrade of the only active administrator;
- deleting the only active administrator;
- races involving operations on different admin rows, serialized with PostgreSQL transaction-scoped advisory locks.

The guard permits administrators to disable other administrators when at least one will remain active, and does not block the very first bootstrap insert. No existing migrations are rewritten: the guard is a separate versioned migration.

Test evidence: tests/admin-guard.integration.test.ts on real PostgreSQL.

Limits: database superusers can bypass or disable triggers; production DB application privileges and migrations must be separated. This does not implement password resets, first-login password change, identity proofing or complete actor-level account audit logging.
