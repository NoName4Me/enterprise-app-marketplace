import { expect, test, type Page } from "@playwright/test";

const suffix = process.env.GITHUB_RUN_ID ?? String(Date.now());
const creatorEmail = `e2e-creator-${suffix}@example.test`;
const readerEmail = `e2e-reader-${suffix}@example.test`;
const adminEmail = "t01-admin@example.test";
const adminPassword = "CI-only-changed-admin-password-not-a-real-secret-456!";
const employeePassword = "CI-browser-test-only-password-12345!";
const appName = `E2E报表中心${suffix}`;
const updatedName = `E2E新版报表中心${suffix}`;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/(apps|account\/security)(?:\?|$)/);
  if (page.url().includes("/account/security")) {
    await page.getByLabel("当前密码", { exact: true }).fill(password);
    await page.getByLabel("新密码", { exact: true }).fill(password + "-personal");
    await page.getByLabel("确认新密码", { exact: true }).fill(password + "-personal");
    await page.getByRole("button", { name: "保存新密码" }).click();
  }
  await expect(page).toHaveURL(/\/apps(?:\?|$)/);
}

async function createUser(page: Page, email: string, name: string) {
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("初始密码").fill(employeePassword);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.locator("li").filter({ hasText: email })).toBeVisible();
}

test("three independent users: permissions, rejected revision, publish, search, and reviewed updates", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();

  try {
    await login(admin, adminEmail, adminPassword);
    await admin.goto("/admin/users");
    await createUser(admin, creatorEmail, "E2E发布者");
    await createUser(admin, readerEmail, "E2E普通员工");
    const creatorRow = admin.locator("li").filter({ hasText: creatorEmail });
    await creatorRow.getByRole("button", { name: "授予创建权" }).click();
    await expect(creatorRow).toContainText("创建权：有");

    await login(reader, readerEmail, employeePassword);
    await reader.goto("/my/apps");
    await expect(reader.getByText("当前账号没有应用创建权限", { exact: false })).toBeVisible();
    const forbidden = await reader.request.post("/api/my/apps", {
      data: { name: "越权登记", summary: "禁止", targetUrl: "https://example.test/denied" },
    });
    expect(forbidden.status()).toBe(403);

    await login(creator, creatorEmail, employeePassword);
    await creator.goto("/my/apps");
    await creator.getByRole("link", { name: "登记 Web 应用" }).click();
    await creator.getByLabel("应用名称").fill(appName);
    await creator.getByLabel("应用简介").fill("业务数据报表与指标");
    await creator.getByLabel("应用分类").selectOption("analytics");
    await creator.getByLabel("应用详细描述").fill("首次登记并等待审核。");
    await creator.getByLabel("HTTPS 访问地址").fill("https://example.test/e2e-v1");
    await creator.getByRole("button", { name: "保存并提交审核" }).click();
    await expect(creator).toHaveURL(/\/my\/apps\/[0-9a-f-]{36}$/);
    const managedUrl = creator.url();
    const appId = managedUrl.split("/").at(-1)!;
    await expect(creator.getByText(/审核中：本版本不可修改/)).toBeVisible();

    // P1-A: use real browser session cookies against HTTP routes while pending.
    const assetUrl = `/api/my/apps/${appId}/assets`;
    const initialAssets = await creator.request.get(assetUrl);
    expect(initialAssets.headers()["cache-control"]).toBe("private, no-store");
    expect((await initialAssets.json()).assetVersion).toBe(1);
    const headers = { origin: new URL(managedUrl).origin };
    const componentResponse = await creator.request.post(assetUrl + "/components", {
      headers, data: { expectedVersion: 1, key: "portal", name: "门户组件", notes: "仅负责人可见" },
    });
    expect(componentResponse.status()).toBe(201);
    const component = (await componentResponse.json()).resource;
    const environmentResponse = await creator.request.post(assetUrl + "/environments", {
      headers, data: { expectedVersion: 2, key: "test", name: "测试环境", purpose: "TEST" },
    });
    expect(environmentResponse.status()).toBe(201);
    const environment = (await environmentResponse.json()).resource;
    const bindingResponse = await creator.request.post(assetUrl + "/bindings", {
      headers, data: { expectedVersion: 3, componentId: component.id, environmentId: environment.id },
    });
    expect(bindingResponse.status()).toBe(201);
    const binding = (await bindingResponse.json()).resource;
    const referenceResponse = await creator.request.post(assetUrl + "/references", {
      headers, data: { expectedVersion: 4, componentId: component.id, bindingId: binding.id, resourceKind: "WORKFLOW", repositoryFullName: "Example/Portal", workflowId: "12345" },
    });
    expect(referenceResponse.status()).toBe(201);
    const registeredAssets = await (await creator.request.get(assetUrl)).json();
    expect(registeredAssets.references[0]).toMatchObject({ connectionStatus: "NOT_VERIFIED", lastCollectedAt: null });
    expect(registeredAssets.healthStatus).toBe("NOT_CONNECTED");
    expect((await reader.request.get(assetUrl)).status()).toBe(404);
    const governance = await admin.request.get(`/api/admin/apps/${appId}/assets`);
    expect(governance.status()).toBe(200);
    expect((await governance.json()).components).toHaveLength(1);
    expect((await admin.request.patch(assetUrl + `/components/${component.id}`, { headers, data: { expectedVersion: 5, name: "越权修改" } })).status()).toBe(404);
    const stale = await creator.request.patch(assetUrl + `/components/${component.id}`, { headers, data: { expectedVersion: 1, name: "过期覆盖" } });
    expect(stale.status()).toBe(409);
    expect((await creator.request.get(`/api/my/apps/${appId}/asset-events`)).status()).toBe(200);
    expect((await reader.request.get(`/api/my/apps/${appId}/asset-events`)).status()).toBe(404);

    await reader.goto(`/apps/${appId}`);
    await expect(reader.getByRole("heading", { name: "404" })).toBeVisible();
    await admin.goto("/admin/reviews");
    await admin.getByRole("link", { name: new RegExp(appName) }).click();
    await expect(admin.getByText("首次上架")).toBeVisible();
    await admin.getByLabel("驳回原因").fill("请完善应用介绍");
    await admin.getByRole("button", { name: "驳回申请" }).click();
    await expect(admin).toHaveURL(/\/admin\/reviews$/);

    await creator.goto(managedUrl);
    await expect(creator.getByText("驳回原因：请完善应用介绍")).toBeVisible();
    await creator.getByRole("button", { name: "建立新的修改草稿" }).click();
    await expect(creator.getByRole("button", { name: "保存并提交审核" })).toBeVisible();
    await creator.getByLabel("应用详细描述").fill("完善后的内容，等待管理员审核。");
    await creator.getByRole("button", { name: "保存并提交审核" }).click();
    await expect(creator.getByText(/审核中：本版本不可修改/)).toBeVisible();

    await admin.goto("/admin/reviews");
    await admin.getByRole("link", { name: new RegExp(appName) }).click();
    await admin.getByRole("button", { name: "批准上架" }).click();
    await expect(admin).toHaveURL(/\/admin\/reviews$/);

    await reader.goto("/apps");
    await expect(reader.getByRole("link", { name: new RegExp(appName) })).toBeVisible();
    await reader.getByRole("searchbox", { name: "搜索应用" }).fill(appName);
    await reader.getByRole("button", { name: "搜索" }).click();
    await expect(reader.getByRole("link", { name: new RegExp(appName) })).toBeVisible();
    await reader.goto(`/apps/${appId}`);
    await expect(reader.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute(
      "href", "https://example.test/e2e-v1",
    );

    await creator.goto(managedUrl);
    await creator.getByRole("button", { name: "建立新的修改草稿" }).click();
    await creator.getByLabel("应用名称").fill(updatedName);
    await creator.getByLabel("HTTPS 访问地址").fill("https://example.test/e2e-v2");
    await creator.getByRole("button", { name: "保存并提交审核" }).click();
    await expect(creator.getByText(/审核中：本版本不可修改/)).toBeVisible();

    await reader.goto(`/apps/${appId}`);
    await expect(reader.getByRole("heading", { name: appName, exact: true })).toBeVisible();
    await expect(reader.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute(
      "href", "https://example.test/e2e-v1",
    );

    await admin.goto("/admin/reviews");
    await admin.getByRole("link", { name: new RegExp(updatedName) }).click();
    await expect(admin.getByText("当前已上架版本（对比）")).toBeVisible();
    await admin.getByRole("button", { name: "批准上架" }).click();
    await expect(admin).toHaveURL(/\/admin\/reviews$/);

    await reader.goto(`/apps/${appId}`);
    await expect(reader.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
    await expect(reader.getByRole("link", { name: /打开 Web 应用/ })).toHaveAttribute(
      "href", "https://example.test/e2e-v2",
    );
    await reader.getByRole("button", { name: "退出登录" }).click();
    await expect(reader).toHaveURL(/\/login$/);
  } finally {
    await Promise.all([adminContext.close(), creatorContext.close(), readerContext.close()]);
  }
});
