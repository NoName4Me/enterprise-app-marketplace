import { AppError } from "./app-errors";

export const assetResources = ["components", "environments", "bindings", "references"] as const;
export type AssetResource = typeof assetResources[number];
export type Purpose = "DEVELOPMENT" | "TEST" | "PRODUCTION";
export type ReferenceKind = "REPOSITORY" | "WORKFLOW";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assetId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new AppError(404, "not_found");
  return value;
}
export function assetResource(value: string): AssetResource {
  if (!assetResources.includes(value as AssetResource)) throw new AppError(404, "not_found");
  return value as AssetResource;
}
function invalid(): never { throw new AppError(422, "invalid_asset_fields"); }
function fields(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid();
}
export function expectedVersion(body: Record<string, unknown>) {
  const value = body.expectedVersion;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value >= 2147483647) invalid();
  return value;
}
function text(value: unknown, max: number, empty = false) {
  if (typeof value !== "string") invalid();
  const result = value.trim();
  if ((!empty && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) invalid();
  return result;
}
function key(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(result)) invalid();
  return result;
}
function purpose(value: unknown): Purpose {
  if (!["DEVELOPMENT", "TEST", "PRODUCTION"].includes(value as string)) invalid();
  return value as Purpose;
}
export function repositoryName(value: unknown) {
  const result = text(value, 140).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(result) || [".", ".."].includes(result.split("/")[1])) invalid();
  return result;
}
export function validateAssetCreate(resource: AssetResource, body: Record<string, unknown>) {
  expectedVersion(body);
  switch (resource) {
    case "components":
      fields(body, ["expectedVersion", "key", "name", "notes"]);
      return { kind: resource, key: key(body.key), name: text(body.name, 120), notes: text(body.notes ?? "", 1000, true) } as const;
    case "environments":
      fields(body, ["expectedVersion", "key", "name", "notes", "purpose"]);
      return { kind: resource, key: key(body.key), name: text(body.name, 120), notes: text(body.notes ?? "", 1000, true), purpose: purpose(body.purpose) } as const;
    case "bindings":
      fields(body, ["expectedVersion", "componentId", "environmentId"]);
      return { kind: resource, componentId: assetId(body.componentId), environmentId: assetId(body.environmentId) } as const;
    case "references": {
      fields(body, ["expectedVersion", "componentId", "bindingId", "provider", "resourceKind", "repositoryFullName", "workflowId"]);
      if (body.provider !== undefined && body.provider !== "GITHUB") invalid();
      if (body.resourceKind !== "REPOSITORY" && body.resourceKind !== "WORKFLOW") invalid();
      const workflowId = body.workflowId ?? null;
      if (body.resourceKind === "REPOSITORY" ? workflowId !== null : typeof workflowId !== "string" || !/^[1-9][0-9]{0,19}$/.test(workflowId)) invalid();
      return { kind: resource, componentId: assetId(body.componentId), bindingId: body.bindingId == null ? null : assetId(body.bindingId), provider: "GITHUB", resourceKind: body.resourceKind as ReferenceKind, repositoryFullName: repositoryName(body.repositoryFullName), workflowId: workflowId as string | null } as const;
    }
  }
}
export function validateAssetPatch(resource: AssetResource, body: Record<string, unknown>) {
  expectedVersion(body);
  const editable = resource === "components" ? ["name", "notes"] : resource === "environments" ? ["name", "notes", "purpose"] : [];
  fields(body, ["expectedVersion", "archived", ...editable]);
  if (Object.keys(body).length < 2) invalid();
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean" || Object.keys(body).length !== 2) invalid();
    return { archived: body.archived };
  }
  const patch: { name?: string; notes?: string; purpose?: Purpose; archived?: boolean } = {};
  if ("name" in body) patch.name = text(body.name, 120);
  if ("notes" in body) patch.notes = text(body.notes, 1000, true);
  if ("purpose" in body) patch.purpose = purpose(body.purpose);
  return patch;
}
export function validateTeamPatch(body: Record<string, unknown>) {
  fields(body, ["expectedVersion", "responsibleTeamName"]);
  expectedVersion(body);
  if (!("responsibleTeamName" in body)) invalid();
  return body.responsibleTeamName === null ? null : text(body.responsibleTeamName, 100);
}
