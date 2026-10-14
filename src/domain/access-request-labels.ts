export const accessStatusLabels = {
  PENDING: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
} as const;

export function accessRequestMessage(status: keyof typeof accessStatusLabels, provisioning: string) {
  if (status === "REJECTED") return "申请被驳回，可以重新提交";
  if (status === "PENDING") return "等待应用负责人或管理员审批";
  if (provisioning === "MANUAL_RECORDED") return "人工登记已处理（未验证目标应用实际权限）";
  return "审批已通过，等待人工开通处理（尚未确认实际权限）";
}
