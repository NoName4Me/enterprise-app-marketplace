import { expect, test, type Page } from "@playwright/test";

const suffix = process.env.GITHUB_RUN_ID ?? String(Date.now());
const creatorEmail = `e2e-creator-${suffix}@example.test`;
const readerEmail = `e2e-reader-${suffix}@example.test`;
const adminEmail = "t01-admin@example.test";
const adminPassword = "CI-only-test-password-not-a-real-secret-123!";
const employeePassword = "CI-browser-test-only-password-12345!";
const appName = `E2E报表中心${suffix}`;
const newName = `E2E新版报表中心${suffix}`;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/apps(?:\?|$)/);
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
async function addEmployee(page: Page, email: string, name: string) {
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("初始密码").fill(employeePassword);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.locator("li").filter({ hasText: email })).toBeVisible();
}

test("real browser flow: account permissions → draft → rejection → approval → public discovery → reviewed update", async ({ page }) => {
  await login(page, adminEmail, adminPassword);
  await page.goto("/admin/users");
  await addEmployee(page, creatorEmail, "E2E发布者");
  await addEmployee(page, readerEmail, "E2E普通员工");
  const creatorRow = page.locator("li").filter({ hasText: creatorEmail });
  await creatorRow.getByRole("button", { name: "授予创建权" }).click();
  await expect(creatorRow).toContainText("创建权：有");
  await logout(page);

  // The ordinary employee cannot write data even when calling API directly.
  await login(page, readerEmail, employeePassword);
  await page.goto("/my/apps");
  await expect(page.getByText("当前账号没有应用创建权限")).toBeVisible();
  const denied = await page.request.post("/api/my/apps", {
    data: { name: "越权登记", summary: "禁止", targetUrl: "https://example.test/denied" },
  });
  expect(denied.status()).toBe(403);
  await logout(page);

  await login(page, creatorEmail, employeePassword);
  await page.goto("/my/apps");
  await page.getByRole("link", { name: "登记 Web 应用" }).click();
  await page.getByLabel("应用名称").fill(appName);
  await page.getByLabel("应用简介").fill("业务数据报表与指标");
  await page.getByLabel("应用分类").selectOption("analytics");
  await page.getByLabel("应用详细描述").fill("提交审核后展示的应用详情。");
  await page.getByLabel("HTTPS 访问地址").fill("https://example.test/e2e-v1");
  await page.getByRole("button", { name: "保存并提交审核" }).click();
  await expect(page).toHaveURL(/\/my\/apps\/[0-9a-f-]{36}$/);
  const managedUrl = page.url();
  const appId = managedUrl.split("/").at(-1)!;
  await expect(page.getByText(/审核中：本版本不可修改/)).toBeVisible();
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await page.goto("/my/apps");
  await logout(page);

  await login(page, adminEmail, adminPassword);
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: new RegExp(appName) }).click();
  await expect(page.getByText("首次上架")).toBeVisible();
  await page.getByLabel("驳回原因").fill("请完善应用介绍");
  await page.getByRole("button", { name: "驳回申请" }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await logout(page);

  await login(page, creatorEmail, employeePassword);
  await page.goto(managedUrl);
  await expect(page.getByText("驳回原因：请完善应用介绍")).toBeVisible();
  await page.getByRole("button", { name: "建立新的修改草稿" }).click();
  await expect(page.getByRole("button", { name: "保存并提交审核" })).toBeVisible();
  await page.getByLabel("应用详细描述").fill("完善后的内容，等待管理员审核。");
  await page.getByRole("button", { name: "保存并提交审核" }).click();
  await expect(page.getByText(/审核中：本版本不可修改/)).toBeVisible();
  await logout(page);

  await login(page, adminEmail, adminPassword);
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: new RegExp(appName) }).click();
  await page.getByRole("button", { name: "批准上架" }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await logout(page);

  await login(page, readerEmail, employeePassword);
  await page.goto("/apps");
  await expect(page.getByRole("link", { name: new RegExp(appName) })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索应用" }).fill(appName);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("link", { name: new RegExp(appName) })).toBeVisible();
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute("href", "https://example.test/e2e-v1");
  await logout(page);

  await login(page, creatorEmail, employeePassword);
  await page.goto(managedUrl);
  await page.getByRole("button", { name: "建立新的修改草稿" }).click();
  await page.getByLabel("应用名称").fill(newName);
  await page.getByLabel("HTTPS 访问地址").fill("https://example.test/e2e-v2");
  await page.getByRole("button", { name: "保存并提交审核" }).click();
  await expect(page.getByText(/审核中：本版本不可修改/)).toBeVisible();
  await logout(page);

  await login(page, readerEmail, employeePassword);
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole("heading", { name: appName, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute("href", "https://example.test/e2e-v1");
  await logout(page);

  await login(page, adminEmail, adminPassword);
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: new RegExp(newName) }).click();
  await expect(page.getByText("当前已上架版本（对比）")).toBeVisible();
  await page.getByRole("button", { name: "批准上架" }).click();
  await logout(page);

  await login(page, readerEmail, employeePassword);
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole("heading", { name: newName, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute("href", "https://example.test/e2e-v2");
});
