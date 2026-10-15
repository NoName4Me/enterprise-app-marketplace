import { relations } from "drizzle-orm";
import { bigint, jsonb, pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

// Better Auth 1.7.6 core + admin plugin fields.
// Compare with the output of the pinned official auth CLI in CI.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  canCreateApp: boolean("can_create_app").default(false).notNull(),
  mustChangePassword: boolean("must_change_password").default(true).notNull(),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (table) => [index("session_userId_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
}, (table) => [index("account_userId_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

import { check, integer, uuid, uniqueIndex, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// T02: catalog identity and immutable review snapshots are separate entities.
// Application's current public revision pointer is assigned only in an approval
// transaction. See docs/ARCHITECTURE.md for the consistency invariant.
export const applications = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  sourceKind: text("source_kind", { enum: ["EXTERNAL", "HOSTED"] }).notNull().default("EXTERNAL"),
  sourceRepository: text("source_repository"),
  listingStatus: text("listing_status", { enum: ["UNLISTED", "LISTED"] }).notNull().default("UNLISTED"),
  publishedRevisionId: uuid("published_revision_id"),
  featured: boolean("featured").notNull().default(false),
  assetVersion: integer("asset_version").notNull().default(1),
  lifecycleStatus: text("lifecycle_status", { enum: ["UNKNOWN", "PILOT", "ACTIVE", "DEPRECATED", "RETIRED"] }).notNull().default("UNKNOWN"),
  responsibleTeamName: text("responsible_team_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("application_source_kind_check", sql`${t.sourceKind} IN ('EXTERNAL','HOSTED')`),
  check("application_hosted_repo_check", sql`${t.sourceKind} <> 'HOSTED' OR ${t.sourceRepository} IS NOT NULL`),
  check("application_listing_status_check", sql`${t.listingStatus} IN ('UNLISTED','LISTED')`),
  check("application_public_pointer_check", sql`${t.listingStatus} <> 'LISTED' OR ${t.publishedRevisionId} IS NOT NULL`),
  check("application_asset_version_positive", sql`${t.assetVersion} > 0`),
  check("application_lifecycle_check", sql`${t.lifecycleStatus} IN ('UNKNOWN','PILOT','ACTIVE','DEPRECATED','RETIRED')`),
  check("application_retired_unlisted", sql`${t.lifecycleStatus} <> 'RETIRED' OR ${t.listingStatus} = 'UNLISTED'`),
  check("application_team_length", sql`length(${t.responsibleTeamName}) BETWEEN 1 AND 100`),
  index("applications_owner_idx").on(t.ownerUserId),
]);

export const appRevisions = pgTable("app_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  status: text("status", { enum: ["DRAFT", "PENDING", "APPROVED", "REJECTED"] }).notNull().default("DRAFT"),
  name: text("name").notNull().default(""),
  summary: text("summary").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("other"),
  targetUrl: text("target_url").notNull().default(""),
  iconRef: text("icon_ref"),
  createdBy: text("created_by").notNull().references(() => user.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by").references(() => user.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("app_revisions_app_sequence_unique").on(t.appId, t.sequence),
  uniqueIndex("app_revisions_one_open_idx").on(t.appId).where(sql`${t.status} IN ('DRAFT','PENDING')`),
  check("app_revision_sequence_positive", sql`${t.sequence} > 0`),
  check("app_revision_status_check", sql`${t.status} IN ('DRAFT','PENDING','APPROVED','REJECTED')`),
  index("app_revisions_pending_idx").on(t.status),
]);

export const reviewEvents = pgTable("review_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").notNull().references(() => appRevisions.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => user.id),
  action: text("action", { enum: ["SUBMITTED", "APPROVED", "REJECTED"] }).notNull(),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("review_event_action_check", sql`${t.action} IN ('SUBMITTED','APPROVED','REJECTED')`),
  unique("review_event_revision_action_unique").on(t.revisionId, t.action),
  index("review_events_app_idx").on(t.appId),
]);

export const appFavorites = pgTable("app_favorites", {
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("app_favorite_user_unique").on(t.appId, t.userId), index("app_favorites_user_idx").on(t.userId)]);

export const appFeedback = pgTable("app_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  body: text("body").notNull().default(""),
  ownerReply: text("owner_reply"),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("app_feedback_user_unique").on(t.appId, t.userId), check("app_feedback_rating_check", sql`${t.rating} BETWEEN 1 AND 5`), index("app_feedback_app_idx").on(t.appId)]);

export const appDiscussions = pgTable("app_discussions", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  body: text("body").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("app_discussions_app_idx").on(t.appId), index("app_discussions_parent_idx").on(t.parentId)]);

export const catalogEvents = pgTable("catalog_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("catalog_events_app_idx").on(t.appId)]);

// Account audit intentionally excludes credentials, tokens, email and request bodies.
export const securityEvents = pgTable("security_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: text("actor_user_id"),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(),
  before: jsonb("before_state"),
  after: jsonb("after_state"),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, table => [index("security_events_time_idx").on(table.occurredAt)]);

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, table => [index("auth_rate_limits_time_idx").on(table.lastRequest)]);

// P1-A: private asset registration. No runtime credentials or collected status.
const assetTimes = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
export const appComponents = pgTable("app_components", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  key: text("key").notNull(), name: text("name").notNull(),
  notes: text("notes").notNull().default(""), ...assetTimes(),
}, t => [
  unique("component_app_key_unique").on(t.appId, t.key),
  unique("component_app_id_unique").on(t.appId, t.id),
  check("component_key_check", sql`${t.key} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`),
  check("component_text_check", sql`length(${t.name}) BETWEEN 1 AND 120 AND length(${t.notes}) <= 1000`),
]);
export const appEnvironments = pgTable("app_environments", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  key: text("key").notNull(), name: text("name").notNull(),
  purpose: text("purpose", { enum: ["DEVELOPMENT", "TEST", "PRODUCTION"] }).notNull(),
  notes: text("notes").notNull().default(""), ...assetTimes(),
}, t => [
  unique("environment_app_key_unique").on(t.appId, t.key),
  unique("environment_app_id_unique").on(t.appId, t.id),
  check("environment_key_check", sql`${t.key} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`),
  check("environment_text_check", sql`length(${t.name}) BETWEEN 1 AND 120 AND length(${t.notes}) <= 1000`),
  check("environment_purpose_check", sql`${t.purpose} IN ('DEVELOPMENT','TEST','PRODUCTION')`),
]);
export const componentEnvironments = pgTable("component_environments", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  componentId: uuid("component_id").notNull(), environmentId: uuid("environment_id").notNull(),
  ...assetTimes(),
}, t => [
  unique("binding_app_pair_unique").on(t.appId, t.componentId, t.environmentId),
  unique("binding_app_component_id_unique").on(t.appId, t.componentId, t.id),
  foreignKey({ name: "binding_component_fk", columns: [t.appId, t.componentId], foreignColumns: [appComponents.appId, appComponents.id] }).onDelete("restrict"),
  foreignKey({ name: "binding_environment_fk", columns: [t.appId, t.environmentId], foreignColumns: [appEnvironments.appId, appEnvironments.id] }).onDelete("restrict"),
]);
export const externalReferences = pgTable("external_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  componentId: uuid("component_id").notNull(), bindingId: uuid("binding_id"),
  provider: text("provider", { enum: ["GITHUB"] }).notNull().default("GITHUB"),
  resourceKind: text("resource_kind", { enum: ["REPOSITORY", "WORKFLOW"] }).notNull(),
  repositoryFullName: text("repository_full_name").notNull(), workflowId: text("workflow_id"),
  ...assetTimes(),
}, t => [
  foreignKey({ name: "reference_component_fk", columns: [t.appId, t.componentId], foreignColumns: [appComponents.appId, appComponents.id] }).onDelete("restrict"),
  foreignKey({ name: "reference_binding_fk", columns: [t.appId, t.componentId, t.bindingId], foreignColumns: [componentEnvironments.appId, componentEnvironments.componentId, componentEnvironments.id] }).onDelete("restrict"),
  unique("reference_identity_unique").on(t.appId, t.componentId, t.bindingId, t.resourceKind, t.repositoryFullName, t.workflowId).nullsNotDistinct(),
  check("reference_provider_check", sql`${t.provider} = 'GITHUB'`),
  check("reference_repository_check", sql`${t.repositoryFullName} ~ '^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9_.-]{1,100}$' AND split_part(${t.repositoryFullName}, '/', 2) NOT IN ('.','..')`),
  check("reference_kind_check", sql`(${t.resourceKind} = 'REPOSITORY' AND ${t.workflowId} IS NULL) OR (${t.resourceKind} = 'WORKFLOW' AND ${t.workflowId} ~ '^[1-9][0-9]{0,19}$' AND ${t.workflowId} IS NOT NULL)`),
  index("references_binding_idx").on(t.appId, t.bindingId),
]);
export const assetEvents = pgTable("asset_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  action: text("action", { enum: ["CREATED", "UPDATED", "ARCHIVED", "RESTORED", "TRANSITIONED", "OWNER_TRANSFERRED"] }).notNull(),
  resourceType: text("resource_type", { enum: ["application", "components", "environments", "bindings", "references"] }).notNull(),
  resourceId: uuid("resource_id").notNull(),
  beforeState: jsonb("before_state"), afterState: jsonb("after_state"),
  reason: text("reason"),
  assetVersionAfter: integer("asset_version_after").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("asset_event_version_unique").on(t.appId, t.assetVersionAfter),
  check("asset_event_action_check", sql`${t.action} IN ('CREATED','UPDATED','ARCHIVED','RESTORED','TRANSITIONED','OWNER_TRANSFERRED')`),
  check("asset_event_reason_check", sql`length(${t.reason}) BETWEEN 1 AND 500`),
  check("asset_event_resource_check", sql`${t.resourceType} IN ('application','components','environments','bindings','references')`),
  check("asset_event_version_check", sql`${t.assetVersionAfter} > 1`),
]);

/**
 * P2: Portal access request decision and manually recorded provisioning are separate facts.
 * This table never asserts that the target application actually granted access.
 */
export const appAccessRequests = pgTable("app_access_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").notNull().references(() => applications.id, { onDelete: "restrict" }),
  requesterUserId: text("requester_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED"] }).notNull().default("PENDING"),
  decidedBy: text("decided_by").references(() => user.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  provisioningStatus: text("provisioning_status", { enum: ["NOT_STARTED", "PENDING", "MANUAL_RECORDED"] }).notNull().default("NOT_STARTED"),
  provisionedBy: text("provisioned_by").references(() => user.id, { onDelete: "restrict" }),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  provisioningNote: text("provisioning_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("access_requests_one_active_idx").on(t.appId, t.requesterUserId)
    .where(sql`${t.status} IN ('PENDING','APPROVED')`),
  index("access_requests_requester_idx").on(t.requesterUserId, t.createdAt),
  index("access_requests_status_idx").on(t.status, t.createdAt),
  check("access_request_reason_check", sql`length(${t.reason}) BETWEEN 5 AND 500`),
  check("access_request_status_check", sql`${t.status} IN ('PENDING','APPROVED','REJECTED')`),
  check("access_request_provision_status_check", sql`${t.provisioningStatus} IN ('NOT_STARTED','PENDING','MANUAL_RECORDED')`),
  check("access_request_decision_check", sql`(
    (${t.status} = 'PENDING' AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.provisioningStatus} = 'NOT_STARTED')
    OR (${t.status} = 'REJECTED' AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.provisioningStatus} = 'NOT_STARTED')
    OR (${t.status} = 'APPROVED' AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.provisioningStatus} IN ('PENDING','MANUAL_RECORDED'))
  )`),
  check("access_request_provision_check", sql`(
    (${t.provisioningStatus} <> 'MANUAL_RECORDED' AND ${t.provisionedBy} IS NULL AND ${t.provisionedAt} IS NULL AND ${t.provisioningNote} IS NULL)
    OR (${t.provisioningStatus} = 'MANUAL_RECORDED' AND ${t.provisionedBy} IS NOT NULL AND ${t.provisionedAt} IS NOT NULL AND ${t.provisioningNote} IS NOT NULL AND length(${t.provisioningNote}) BETWEEN 5 AND 500)
  )`),
  check("access_request_no_self_decision", sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.requesterUserId}`),
  check("access_request_no_self_provision", sql`${t.provisionedBy} IS NULL OR ${t.provisionedBy} <> ${t.requesterUserId}`),
]);

export const requirements = pgTable("requirements", {
  id: uuid("id").defaultRandom().primaryKey(),
  appId: uuid("app_id").references(() => applications.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  type: text("type", { enum: ["NEW_APP","FEATURE","BUG","IMPROVEMENT"] }).notNull(),
  title: text("title").notNull(), description: text("description").notNull(),
  status: text("status", { enum: ["OPEN","IN_PROGRESS","DONE","REJECTED"] }).default("OPEN").notNull(),
  assignedTo: text("assigned_to").references(() => user.id, { onDelete: "restrict" }),
  githubIssueUrl: text("github_issue_url"), githubPrUrl: text("github_pr_url"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  index("requirements_app_idx").on(t.appId, t.createdAt),
  index("requirements_author_idx").on(t.createdBy, t.createdAt),
]);
export const requirementComments = pgTable("requirement_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("requirement_comments_idx").on(t.requirementId, t.createdAt)]);
export const codingTasks = pgTable("coding_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  repository: text("repository").notNull(),
  externalTaskId: text("external_task_id"),
  state: text("state", { enum: ["REQUESTING","ACCEPTED","UNKNOWN"] }).default("REQUESTING").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("coding_tasks_requirement_unique").on(t.requirementId)]);
