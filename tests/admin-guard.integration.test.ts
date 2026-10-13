import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import { user } from "../src/db/schema";

const mainAdminEmail = "t01-admin@example.test";
const extraId = randomUUID();
const extraEmail = "t05-extra-admin-" + extraId + "@example.test";

afterAll(async () => {
  await db.delete(user).where(eq(user.id, extraId));
});

describe.sequential("last active administrator invariant at PostgreSQL boundary", () => {
  it("blocks banning, demoting and deleting the sole administrator", async () => {
    const [base] = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, mainAdminEmail)).limit(1);
    expect(base?.id).toBeTruthy();
    await expect(db.update(user).set({ banned: true })
      .where(eq(user.id, base.id))).rejects.toThrow();
    await expect(db.update(user).set({ role: "user" })
      .where(eq(user.id, base.id))).rejects.toThrow();
    await expect(db.delete(user).where(eq(user.id, base.id))).rejects.toThrow();
    const [still] = await db.select({ role: user.role, banned: user.banned })
      .from(user).where(eq(user.id, base.id));
    expect(still.role).toContain("admin");
    expect(still.banned).toBe(false);
  });

  it("allows demotion of another administrator while keeping the final one active", async () => {
    await db.insert(user).values({
      id: extraId, name: "T05 backup administrator",
      email: extraEmail, role: "admin", banned: false,
    });
    await db.update(user).set({ banned: true }).where(eq(user.id, extraId));
    const [extra] = await db.select({ banned: user.banned }).from(user)
      .where(eq(user.id, extraId));
    expect(extra.banned).toBe(true);

    const [base] = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, mainAdminEmail)).limit(1);
    await expect(db.update(user).set({ banned: true })
      .where(eq(user.id, base.id))).rejects.toThrow();
  });

  it("serializes simultaneous attempts to remove two administrators", async () => {
    const [base] = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, mainAdminEmail)).limit(1);
    await db.update(user).set({ banned: false, role: "admin" })
      .where(eq(user.id, extraId));
    try {
      const results = await Promise.allSettled([
        db.update(user).set({ banned: true }).where(eq(user.id, base.id)),
        db.update(user).set({ banned: true }).where(eq(user.id, extraId)),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const active = await db.select({ id: user.id, banned: user.banned, role: user.role })
        .from(user);
      expect(active.filter(u => u.banned !== true && u.role?.split(",").includes("admin"))).toHaveLength(1);
    } finally {
      await db.update(user).set({ banned: false }).where(eq(user.id, base.id));
      await db.update(user).set({ banned: false }).where(eq(user.id, extraId));
    }
  });
});
