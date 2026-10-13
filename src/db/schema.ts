import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

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

import { check, integer, uuid, uniqueIndex, unique, sql } from "drizzle-orm";

// T02: catalog identity and immutable review snapshots are separate entities.
// Application's current public revision pointer is assigned only in an approval
// transaction. See docs/design/PUBLISHING_MODEL.md for the consistency invariant.
export const applications = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  listingStatus: text("listing_status", { enum: ["UNLISTED", "LISTED"] }).notNull().default("UNLISTED"),
  publishedRevisionId: uuid("published_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("application_listing_status_check", sql`${t.listingStatus} IN ('UNLISTED','LISTED')`),
  check("application_public_pointer_check", sql`${t.listingStatus} <> 'LISTED' OR ${t.publishedRevisionId} IS NOT NULL`),
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
