export type AccountPermissions = {
  banned: boolean | null;
  role: string | null;
  canCreateApp: boolean;
};

export function mayUseMarketplace(account: AccountPermissions | null): boolean {
  return account !== null && account.banned !== true;
}

export function mayCreateApp(account: AccountPermissions | null): boolean {
  return mayUseMarketplace(account) && Boolean(account?.canCreateApp);
}

export function mayReviewApp(account: AccountPermissions | null): boolean {
  return mayUseMarketplace(account) && account?.role?.split(",").includes("admin") === true;
}
