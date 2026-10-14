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

    // Exercise the real asset forms, then a conflict caused by another write.
    await creator.goto(managedUrl);
    const componentSection = creator.getByRole("region", { name: "组件", exact: true });
    await componentSection.getByText("新增组件", { exact: true }).click();
    await componentSection.getByLabel("组件标识").fill("api");
    await componentSection.getByLabel("组件名称").fill("API组件");
    await componentSection.getByRole("button", { name: "登记组件", exact: true }).click();
    await expect(componentSection.getByText("API组件", { exact: true })).toBeVisible();
    const environmentSection = creator.getByRole("region", { name: "环境", exact: true });
    await environmentSection.getByText("新增环境", { exact: true }).click();
    await environmentSection.getByLabel("环境标识").fill("development");
    await environmentSection.getByLabel("环境名称").fill("开发环境");
    await environmentSection.getByRole("combobox").selectOption("DEVELOPMENT");
    await environmentSection.getByRole("button", { name: "登记环境", exact: true }).click();
    await expect(environmentSection.getByText("开发环境", { exact: true })).toBeVisible();
    const bindingsSection = creator.getByRole("region", { name: "组件环境关联", exact: true });
    await bindingsSection.getByLabel("关联组件").selectOption({ label: "API组件" });
    await bindingsSection.getByLabel("关联环境").selectOption({ label: "开发环境" });
    await bindingsSection.getByRole("button", { name: "登记关联" }).click();
    await expect(bindingsSection.getByText("API组件 → 开发环境", { exact: true })).toBeVisible();
    const referencesSection = creator.getByRole("region", { name: "外部引用", exact: true });
    await referencesSection.getByLabel("引用所属组件").selectOption({ label: "API组件" });
    await referencesSection.getByLabel("引用限定环境").selectOption({ label: "开发环境" });
    await referencesSection.getByLabel("引用类型").selectOption("WORKFLOW");
    await referencesSection.getByLabel("GitHub仓库", { exact: true }).fill("NoName4Me/enterprise-app-marketplace");
    await referencesSection.getByLabel("GitHub流水线编号").fill("382348450");
    await referencesSection.getByRole("button", { name: "登记引用" }).click();
    await expect(referencesSection.getByRole("link", { name: /noname4me/ })).toBeVisible();
    await expect(referencesSection.getByText(/尚未验证连接/)).toBeVisible();
    const portal = componentSection.locator("article").filter({ hasText: "门户组件" });
    await portal.getByText("编辑组件", { exact: true }).click();
    await portal.getByLabel("名称", { exact: true }).fill("冲突覆盖");
    const currentAssets = await (await creator.request.get(assetUrl)).json();
    const outsideWrite = await creator.request.patch(assetUrl, { headers, data: { expectedVersion: currentAssets.assetVersion, responsibleTeamName: "测试责任团队" } });
    expect(outsideWrite.status()).toBe(200);
    await portal.getByRole("button", { name: "保存修改" }).click();
    await expect(creator.getByRole("alert").filter({ hasText: "应用资产已被更新" })).toContainText("重新读取");
    await creator.getByRole("button", { name: "重新读取" }).click();
    await expect(creator.getByText("测试责任团队", { exact: true })).toBeVisible();
    await expect(componentSection.getByText("门户组件", { exact: true })).toBeVisible();
    await creator.locator("#assets").scrollIntoViewIfNeeded();
    await creator.screenshot({ path: "test-results/p1-assets-workspace.png" });

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
    await expect(reader.getByRole("heading", { name: "应用资产", exact: true })).toHaveCount(0);

    // Read-only owner UI, then retirement/restoration/transfer through the UI.
    await admin.goto("/admin/users");
    const row = admin.locator("li").filter({ hasText: creatorEmail });
    await row.getByRole("button", { name: "撤销创建权" }).click();
    await expect(row).toContainText("创建权：无");
    await creator.goto(managedUrl);
    await expect(creator.getByText("创建权限已撤销，资产只读。", { exact: true })).toBeVisible();
    await expect(creator.getByRole("button", { name: "登记组件", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "授予创建权" }).click();
    await expect(row).toContainText("创建权：有");
    await creator.goto(managedUrl);
    const lifecycleSection = creator.locator("#lifecycle");
    await lifecycleSection.getByLabel("目标生命周期").selectOption("ACTIVE");
    await lifecycleSection.getByLabel("生命周期变更理由").fill("登记正式维护");
    await lifecycleSection.getByRole("button", { name: "保存生命周期" }).click();
    await expect(lifecycleSection.getByText("当前阶段：正式维护（人工登记）", { exact: true })).toBeVisible();
    await lifecycleSection.getByLabel("目标生命周期").selectOption("DEPRECATED");
    await lifecycleSection.getByLabel("生命周期变更理由").fill("计划退出测试应用");
    await lifecycleSection.getByRole("button", { name: "保存生命周期" }).click();
    await expect(lifecycleSection.getByText("当前阶段：计划退出（人工登记）", { exact: true })).toBeVisible();
    for (const name of ["外部引用", "组件环境关联", "组件", "环境"]) {
      const region = creator.getByRole("region", { name, exact: true });
      while (await region.getByRole("button", { name: "归档", exact: true }).count()) {
        await region.getByRole("button", { name: "归档", exact: true }).first().click();
        await expect(creator.getByRole("button", { name: "重新读取" })).toBeEnabled();
      }
    }
    const downlist = await admin.request.patch(`/api/admin/catalog/${appId}`, { headers, data: { action: "unlist", reason: "测试退役前下架" } });
    expect(downlist.status()).toBe(200);
    await creator.getByRole("button", { name: "重新读取" }).click();
    await expect(lifecycleSection.getByText("门户登记条件已满足；仍需人工核查外部影响。", { exact: true })).toBeVisible();
    await lifecycleSection.getByLabel("目标生命周期").selectOption("RETIRED");
    await lifecycleSection.getByLabel("生命周期变更理由").fill("仅测试登记退役，无外部关停证明");
    await lifecycleSection.getByLabel(/我已人工核对使用者/).check();
    await lifecycleSection.getByRole("button", { name: "登记退役" }).click();
    await expect(lifecycleSection.getByText("当前阶段：已退役（人工登记）", { exact: true })).toBeVisible();
    await expect(creator.getByRole("button", { name: "建立新的修改草稿" })).toHaveCount(0);
    await admin.goto(`/admin/apps/${appId}`);
    await expect(admin.getByText("管理员治理视图只读。", { exact: false })).toBeVisible();
    await admin.getByLabel("生命周期变更理由").fill("测试恢复治理登记");
    await admin.getByRole("button", { name: "恢复为计划退出" }).click();
    await expect(admin.locator("#lifecycle").getByText("当前阶段：计划退出（人工登记）", { exact: true })).toBeVisible();
    await admin.goto("/admin/users");
    await admin.locator("li").filter({ hasText: readerEmail }).getByRole("button", { name: "授予创建权" }).click();
    await expect(admin.locator("li").filter({ hasText: readerEmail })).toContainText("创建权：有");
    await admin.goto(`/admin/apps/${appId}`);
    await admin.getByLabel("新负责人").selectOption({ label: "E2E普通员工" });
    await admin.getByLabel("移交理由").fill("测试应用负责人交接");
    await admin.getByRole("button", { name: "移交负责人" }).click();
    await expect(admin.getByText(/负责人：E2E普通员工/)).toBeVisible();
    await creator.goto(managedUrl);
    await expect(creator.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await reader.getByRole("button", { name: "退出登录" }).click();
    await expect(reader).toHaveURL(/\/login$/);
  } finally {
    await Promise.all([adminContext.close(), creatorContext.close(), readerContext.close()]);
  }
});
