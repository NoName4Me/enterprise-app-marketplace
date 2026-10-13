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
  self_review_forbidden: "不能审核自己提交的应用。",
};
export function explainError(code?: string, status?: number) {
  if (code && knownErrors[code]) return knownErrors[code];
  if (status === 409) return "当前状态发生变化，请刷新页面后重试。";
  return "操作失败，请稍后重试。";
}
