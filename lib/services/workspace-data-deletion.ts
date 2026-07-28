import { db } from '@/lib/db'

export async function deleteWorkspaceData({
  workspaceId,
  userId,
}: {
  workspaceId: string
  userId: string
}) {
  await db.$transaction(async (tx) => {
    await tx.feedback.deleteMany({ where: { workspaceId } })
    await tx.conversation.deleteMany({ where: { workspaceId } })
    await tx.conversationMessage.deleteMany({ where: { workspaceId } })
    await tx.recommendation.deleteMany({
      where: {
        OR: [
          { analysisRun: { workspaceId } },
          { contact: { workspaceId } },
        ],
      },
    })
    await tx.evidence.deleteMany({ where: { workspaceId } })
    await tx.analysisRun.deleteMany({ where: { workspaceId } })
    await tx.importJob.deleteMany({ where: { workspaceId } })
    await tx.contactEdge.deleteMany({ where: { workspaceId } })
    await tx.interaction.deleteMany({ where: { workspaceId } })
    await tx.contact.deleteMany({ where: { workspaceId } })
    await tx.auditLog.deleteMany({ where: { workspaceId } })
    await tx.auditLog.create({
      data: {
        workspaceId,
        userId,
        action: 'WORKSPACE_DATA_DELETED',
        metadata: {},
      },
    })
  })
}
