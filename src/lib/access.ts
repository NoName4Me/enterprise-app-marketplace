export type AccountPermissions={disabled:boolean;isAdmin:boolean;canCreateApp:boolean};
export function mayUseMarketplace(u:AccountPermissions|null){return u!==null && !u.disabled;}
export function mayCreateApp(u:AccountPermissions|null){return mayUseMarketplace(u)&&Boolean(u?.canCreateApp);}
export function mayReviewApp(u:AccountPermissions|null){return mayUseMarketplace(u)&&Boolean(u?.isAdmin);}
