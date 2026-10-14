export const categoryNames: Record<string, string> = {
  office: "办公", analytics: "数据分析", development: "研发工具",
  collaboration: "协作沟通", other: "其他",
};
export function statusName(status: string) {
  return ({
    DRAFT: "草稿", PENDING: "待审核", APPROVED: "已批准",
    REJECTED: "已驳回",
  } as Record<string, string>)[status] ?? status;
}

const knownErrors: Record<string, string> = {
  asset_version_conflict: "应用资产已被更新，请重新读取后再保存。",
  application_retired: "应用已退役，只能查看；请联系管理员恢复。",
  asset_read_only: "此对象已归档或应用已退役，只能查看。",
  parent_archived: "关联的组件、环境或绑定已归档，请先恢复父对象。",
  active_dependencies: "还有未归档的关联或引用，请先归档这些对象。",
  duplicate_asset: "标识或关联已存在；归档不会释放标识，请恢复原对象。",
  asset_unchanged: "没有可保存的变化，或该动作已经完成。",
  invalid_asset_fields: "资产字段不正确，请检查标识、名称、用途及GitHub引用。",
  retirement_blocked: "退役条件尚未满足，请重新读取并查看阻塞项。",
  invalid_lifecycle_transition: "当前阶段不允许这个变更，请重新读取。",
  impact_acknowledgement_required: "退役前需要人工核对并确认使用者及外部影响。",
  pending_revision_blocks_transfer: "存在待审申请，审核处理完后才能移交。",
  owner_not_eligible: "新负责人必须是活跃、已改密且拥有创建权的账号。",
  admin_restore_required: "退役恢复只能由管理员执行。",
  reason_required: "请填写变更理由，最多500字。",
  invalid_governance_fields: "治理字段不正确，请检查变更内容。",
  password_change_required: "请先修改初始密码，再使用应用市场。",
  invalid_text: "请填写内容，并控制在允许的字数范围内。",
  invalid_rating: "请选择 1–5 星评分。",
  feedback_moderated: "该评价已由管理员隐藏，暂时不能重新发布。",
  unauthorized: "请先登录，或重新登录后操作。",
  forbidden: "没有执行此操作的权限。",
  not_found: "没有找到该内容，或你无权查看。",
  invalid_body: "表单内容不正确，请检查填写的字段。",
  invalid_json: "提交的数据格式不正确。",
  unknown_field: "提交了不支持的字段。",
  missing_required_fields: "请填写名称、简介和 HTTPS 访问地址。",
  invalid_target_url: "访问地址必须是有效的 HTTPS 链接。",
  invalid_icon_url: "图标地址必须是有效的 HTTPS 链接。",
  invalid_category: "请选择有效的分类。",
  text_too_long: "输入内容超过长度限制。",
  already_reviewed: "这条申请已经被其他管理员处理。",
  no_editable_draft: "当前没有可编辑的草稿。",
  active_revision_exists: "已有草稿或待审版本，请先处理。",
  rejection_reason_required: "驳回时必须填写原因（不超过 500 字）。",
  self_review_forbidden: "不能审核自己创建或当前负责的应用。",
};
export function explainError(code?: string, status?: number) {
  if (code && knownErrors[code]) return knownErrors[code];
  if (status === 409) return "当前状态发生变化，请刷新页面后重试。";
  return "操作失败，请稍后重试。";
}

export function lifecycleName(status: string) {
  return ({ UNKNOWN: "尚未登记", PILOT: "试点", ACTIVE: "正式维护", DEPRECATED: "计划退出", RETIRED: "已退役" } as Record<string, string>)[status] ?? status;
}
