"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { explainError, lifecycleName } from "@/lib/marketplace-labels";
import { GithubLivePanel } from "./github-live-panel";

type NamedAsset = { id: string; key: string; name: string; notes: string; archivedAt: string | null; purpose?: string };
type Binding = { id: string; componentId: string; environmentId: string; archivedAt: string | null };
type Reference = { id: string; componentId: string; bindingId: string | null; resourceKind: string; repositoryFullName: string; workflowId: string | null; archivedAt: string | null; url: string };
type AssetData = { id: string; name: string; owner: { id: string; name: string }; assetVersion: number; lifecycleStatus: string; responsibleTeamName: string | null; components: NamedAsset[]; environments: NamedAsset[]; bindings: Binding[]; references: Reference[] };
type Preflight = { assetVersion: number; retirementBlockers: string[]; allowedTransitions: readonly string[] };
type Event = { id: string; actorName: string; action: string; resourceType: string; reason: string | null; occurredAt: string; assetVersionAfter: number };
type Events = { items: Event[]; nextBeforeVersion: number | null };
const purposeNames: Record<string, string> = { DEVELOPMENT: "开发", TEST: "测试", PRODUCTION: "生产" };
const blockerNames: Record<string, string> = { NOT_DEPRECATED: "先将生命周期登记为计划退出", STILL_LISTED: "先由管理员下架市场登记", OPEN_REVISION: "先处理草稿或待审申请", ACTIVE_COMPONENTS: "归档全部组件", ACTIVE_ENVIRONMENTS: "归档全部环境", ACTIVE_BINDINGS: "归档全部组件环境关联", ACTIVE_REFERENCES: "归档全部外部引用" };
const actionNames: Record<string, string> = { CREATED: "登记", UPDATED: "修改", ARCHIVED: "归档", RESTORED: "恢复", TRANSITIONED: "变更生命周期", OWNER_TRANSFERRED: "移交负责人" };
const resourceNames: Record<string, string> = { application: "应用", components: "组件", environments: "环境", bindings: "关联", references: "外部引用" };
function purposes(value = "TEST") { return <select name="purpose" defaultValue={value}>{Object.entries(purposeNames).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select>; }
export function AssetPanel({ appId, initial, initialPreflight, initialEvents, canWrite, admin = false, candidates = [] }: { appId: string; initial: AssetData; initialPreflight: Preflight; initialEvents: Events; canWrite: boolean; admin?: boolean; candidates?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [data, setData] = useState(initial), [preflight, setPreflight] = useState(initialPreflight), [events, setEvents] = useState(initialEvents);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false), [componentId, setComponentId] = useState(""), [referenceKind, setReferenceKind] = useState("REPOSITORY");
  const [target, setTarget] = useState(initialPreflight.allowedTransitions[0] ?? "");
  const root = `/api/${admin ? "admin" : "my"}/apps/${appId}`;
  const editable = canWrite && !admin && data.lifecycleStatus !== "RETIRED";
  const visible = <T extends { archivedAt: string | null }>(items: T[]) => items.filter(item => showArchived || !item.archivedAt);
  const componentName = (id: string) => data.components.find(item => item.id === id)?.name ?? "历史组件";
  const environmentName = (id: string) => data.environments.find(item => item.id === id)?.name ?? "历史环境";
  async function json(url: string, options?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const payload = await response.json();
    if (!response.ok) throw new Error(explainError(payload.error, response.status));
    return payload;
  }
  async function reload() {
    const [assets, flight, history] = await Promise.all([json(root + "/assets"), json(root + "/lifecycle/preflight"), json(root + "/asset-events")]);
    setData(assets); setPreflight(flight); setEvents(history); setTarget(flight.allowedTransitions[0] ?? ""); setComponentId(""); router.refresh();
  }
  async function refresh() {
    setBusy(true); setError(""); setMessage("");
    try { await reload(); setMessage("已重新读取当前数据。"); } catch (error) { setError(error instanceof Error ? error.message : "重新读取失败。"); }
    finally { setBusy(false); }
  }
  async function mutate(path: string, method: string, body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      await json(root + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: data.assetVersion, ...body }) });
      setMessage("已保存。"); await reload();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>, path: string, method: string, convert: (form: FormData) => Record<string, unknown>) {
    event.preventDefault(); void mutate(path, method, convert(new FormData(event.currentTarget)));
  }
  function archive(resource: string, id: string, archived: boolean) { return <button type="button" className="button-secondary" disabled={busy || !editable} onClick={() => void mutate(`/assets/${resource}/${id}`, "PATCH", { archived: !archived })}>{archived ? "恢复" : "归档"}</button>; }
  function named(resource: "components" | "environments", title: string, items: NamedAsset[]) {
    const isEnvironment = resource === "environments";
    return <section className="card asset-group" aria-label={title}><h3>{title}</h3>
      {!visible(items).length && <p className="muted">尚未登记{title}，或已全部归档。</p>}
      {visible(items).map(item => <article className="asset-row" key={item.id}><div className="actions"><strong>{item.name}</strong><span className="tag">{item.archivedAt ? "已归档" : "已登记"}</span>{editable && archive(resource, item.id, !!item.archivedAt)}</div><p className="muted">标识：{item.key}{isEnvironment && ` · 用途：${purposeNames[item.purpose!]}`}</p>{item.notes && <p className="pre-wrap">{item.notes}</p>}
        {editable && !item.archivedAt && <details><summary>编辑{isEnvironment ? "环境" : "组件"}</summary><form className="stack" key={data.assetVersion} onSubmit={event => save(event, `/assets/${resource}/${item.id}`, "PATCH", form => ({ name: form.get("name"), notes: form.get("notes"), ...(isEnvironment ? { purpose: form.get("purpose") } : {}) }))}><label>名称<input name="name" defaultValue={item.name} required maxLength={120} /></label><label>备注<textarea name="notes" defaultValue={item.notes} maxLength={1000} /></label>{isEnvironment && <label>环境用途{purposes(item.purpose)}</label>}<button disabled={busy}>保存修改</button></form></details>}
      </article>)}
      {editable && <details><summary>新增{isEnvironment ? "环境" : "组件"}</summary><form className="stack" key={data.assetVersion} onSubmit={event => save(event, `/assets/${resource}`, "POST", form => ({ key: form.get("key"), name: form.get("name"), notes: form.get("notes"), ...(isEnvironment ? { purpose: form.get("purpose") } : {}) }))}><label>{isEnvironment ? "环境" : "组件"}标识<input name="key" required maxLength={64} pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="小写字母、数字或连字符" /></label><label>{isEnvironment ? "环境" : "组件"}名称<input name="name" required maxLength={120} /></label><label>{isEnvironment ? "环境" : "组件"}备注<textarea name="notes" maxLength={1000} /></label>{isEnvironment && <label>环境用途{purposes()}</label>}<button disabled={busy}>登记{isEnvironment ? "环境" : "组件"}</button></form></details>}
    </section>;
  }
  return <div className="asset-workspace">
    <div className="actions"><p>负责人：{data.owner.name} · 生命周期：{lifecycleName(data.lifecycleStatus)}（人工登记）</p><button className="button-secondary" disabled={busy} onClick={() => void refresh()}>重新读取</button></div>
    <div aria-live="polite">{error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}</div>
    <section id="assets"><h2>应用资产</h2><p className="muted">私有登记信息，仅负责人和管理员可见。组件与环境明确关联；归档保留历史。</p>
      {admin && <p className="notice">管理员治理视图只读。编辑自己负责的资产请从“我的应用”进入。</p>}
      {!admin && !editable && <p className="notice">{data.lifecycleStatus === "RETIRED" ? "应用已退役，资产只读。" : "创建权限已撤销，资产只读。"}</p>}
      <label className="asset-checkbox"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />显示已归档对象</label>
      <section className="card asset-group"><h3>责任团队</h3><p>{data.responsibleTeamName || "尚未登记责任团队"}</p>{editable && <form className="stack" key={data.assetVersion} onSubmit={event => save(event, "/assets", "PATCH", form => ({ responsibleTeamName: String(form.get("responsibleTeamName") ?? "").trim() || null }))}><label>责任团队名称<input name="responsibleTeamName" defaultValue={data.responsibleTeamName ?? ""} maxLength={100} /></label><p className="muted">团队名称不授予操作权限。</p><button disabled={busy}>保存责任团队</button></form>}</section>
      <div className="two-columns">{named("components", "组件", data.components)}{named("environments", "环境", data.environments)}</div>
      <section className="card asset-group" aria-label="组件环境关联"><h3>组件环境关联</h3>{!visible(data.bindings).length && <p className="muted">尚未登记关联。</p>}{visible(data.bindings).map(binding => <article className="asset-row" key={binding.id}><div className="actions"><strong>{componentName(binding.componentId)} → {environmentName(binding.environmentId)}</strong><span className="tag">{binding.archivedAt ? "已归档" : "已登记"}</span>{editable && archive("bindings", binding.id, !!binding.archivedAt)}</div></article>)}
        {editable && <form className="stack" key={data.assetVersion} onSubmit={event => save(event, "/assets/bindings", "POST", form => ({ componentId: form.get("componentId"), environmentId: form.get("environmentId") }))}><label>关联组件<select name="componentId" required defaultValue=""><option value="">请选择组件</option>{data.components.filter(item => !item.archivedAt).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>关联环境<select name="environmentId" required defaultValue=""><option value="">请选择环境</option>{data.environments.filter(item => !item.archivedAt).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button disabled={busy}>登记关联</button></form>}
      </section>
      <section className="card asset-group" aria-label="外部引用"><h3>外部引用</h3><p className="notice">仓库/流水线登记不代表已连接；可在下方按需读取真实 GitHub 提交、PR 与 Actions。运行健康、实际部署仍未接入。</p>{!visible(data.references).length && <p className="muted">尚未登记外部引用；无CI引用也可以正常登记和上架应用。</p>}{visible(data.references).map(reference => <article className="asset-row" key={reference.id}><div className="actions"><strong>{componentName(reference.componentId)} · {reference.resourceKind === "WORKFLOW" ? "流水线" : "仓库"}</strong>{editable && archive("references", reference.id, !!reference.archivedAt)}</div><a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.repositoryFullName}{reference.workflowId ? ` · 流水线编号 ${reference.workflowId}` : ""}</a><p className="muted">{reference.archivedAt ? "已归档" : "已登记，未验证连接"}</p>{reference.bindingId && <p>限定环境：{environmentName(data.bindings.find(binding => binding.id === reference.bindingId)?.environmentId ?? "")}</p>}</article>)}
        {editable && <form className="stack" key={data.assetVersion} onSubmit={event => save(event, "/assets/references", "POST", form => ({ componentId: form.get("componentId"), bindingId: form.get("bindingId") || null, resourceKind: referenceKind, repositoryFullName: form.get("repositoryFullName"), ...(referenceKind === "WORKFLOW" ? { workflowId: form.get("workflowId") } : {}) }))}><label>引用所属组件<select name="componentId" required value={componentId} onChange={event => setComponentId(event.target.value)}><option value="">请选择组件</option>{data.components.filter(item => !item.archivedAt).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>引用限定环境<select name="bindingId" defaultValue="" key={componentId}><option value="">不限定环境</option>{data.bindings.filter(binding => !binding.archivedAt && binding.componentId === componentId).map(binding => <option value={binding.id} key={binding.id}>{environmentName(binding.environmentId)}</option>)}</select></label><label>引用类型<select value={referenceKind} onChange={event => setReferenceKind(event.target.value)}><option value="REPOSITORY">GitHub仓库</option><option value="WORKFLOW">GitHub流水线</option></select></label><label>GitHub仓库<input name="repositoryFullName" required maxLength={140} placeholder="owner/repository" /></label>{referenceKind === "WORKFLOW" && <label>GitHub流水线编号<input name="workflowId" required maxLength={20} pattern="[1-9][0-9]*" /></label>}<button disabled={busy}>登记引用</button></form>}
      </section>
      <GithubLivePanel key={data.assetVersion} root={root} registered={data.references.filter(ref => !ref.archivedAt).length} />
    </section>
    <section id="lifecycle" className="card asset-group"><h2>生命周期与审计</h2><p>当前阶段：{lifecycleName(data.lifecycleStatus)}（人工登记）</p><p className="muted">生命周期独立于市场审核、运行健康和部署结果。变更不会部署或关停目标服务。</p><h3>退役检查</h3>{preflight.retirementBlockers.length ? <ul>{preflight.retirementBlockers.map(blocker => <li key={blocker}>{blockerNames[blocker] ?? blocker}</li>)}</ul> : <p>门户登记条件已满足；仍需人工核查外部影响。</p>}<p className="muted">外部依赖及运行影响：未知，未接入采集。执行时会重新核查条件。</p>
      {(admin || editable) && preflight.allowedTransitions.length > 0 && <form className="stack" key={data.assetVersion} onSubmit={event => save(event, "/lifecycle/transitions", "POST", form => ({ to: target, reason: form.get("reason"), ...(target === "RETIRED" ? { impactAcknowledged: form.get("impactAcknowledged") === "on" } : {}) }))}><label>目标生命周期<select value={target} onChange={event => setTarget(event.target.value)}>{preflight.allowedTransitions.map(value => <option value={value} key={value}>{lifecycleName(value)}</option>)}</select></label><label>生命周期变更理由<textarea name="reason" required maxLength={500} /></label>{target === "RETIRED" && <label className="asset-checkbox"><input name="impactAcknowledged" type="checkbox" required />我已人工核对使用者、外部依赖和目标系统处置；此声明不代表平台验证服务已关停。</label>}<button disabled={busy || (target === "RETIRED" && preflight.retirementBlockers.length > 0)}>{target === "RETIRED" ? "登记退役" : admin ? "恢复为计划退出" : "保存生命周期"}</button></form>}
      {admin && <section className="asset-row"><h3>移交负责人</h3><p className="muted">可接管草稿；待审申请须先处理。历史创建者保留，新负责人也不能自批。移交不会改变上架状态或恢复归档对象。</p><form className="stack" key={data.assetVersion} onSubmit={event => save(event, "/owner-transfer", "POST", form => ({ newOwnerId: form.get("newOwnerId"), reason: form.get("reason") }))}><label>新负责人<select name="newOwnerId" required defaultValue=""><option value="">请选择活跃且有创建权的账号</option>{candidates.filter(candidate => candidate.id !== data.owner.id).map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label><label>移交理由<textarea name="reason" required maxLength={500} /></label><button disabled={busy}>移交负责人</button></form></section>}
      <h3>操作记录</h3>{events.items.map(event => <article className="asset-row" key={event.id}><strong>{actionNames[event.action] ?? event.action} · {resourceNames[event.resourceType] ?? event.resourceType}</strong><p className="muted">{event.actorName} · {new Date(event.occurredAt).toLocaleString("zh-CN")} · 资产版本 {event.assetVersionAfter}</p>{event.reason && <p>{event.reason}</p>}</article>)}{!events.items.length && <p className="muted">暂无资产及生命周期记录。</p>}{events.nextBeforeVersion && <button disabled={busy} className="button-secondary" onClick={async () => { setBusy(true); try { const older = await json(root + `/asset-events?beforeVersion=${events.nextBeforeVersion}`); setEvents({ items: [...events.items, ...older.items], nextBeforeVersion: older.nextBeforeVersion }); } catch (error) { setError(error instanceof Error ? error.message : "读取失败。"); } finally { setBusy(false); } }}>读取更早记录</button>}
    </section>
  </div>;
}
