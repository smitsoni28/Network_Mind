import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const calls: Array<{ name: string; args: unknown }> = []
  const method = (name: string) => vi.fn(async (args: unknown) => {
    calls.push({ name, args })
    return { count: 1 }
  })
  const tx = {
    feedback: { deleteMany: method('feedback.deleteMany') },
    conversation: { deleteMany: method('conversation.deleteMany') },
    conversationMessage: { deleteMany: method('conversationMessage.deleteMany') },
    recommendation: { deleteMany: method('recommendation.deleteMany') },
    evidence: { deleteMany: method('evidence.deleteMany') },
    analysisRun: { deleteMany: method('analysisRun.deleteMany') },
    importJob: { deleteMany: method('importJob.deleteMany') },
    contactEdge: { deleteMany: method('contactEdge.deleteMany') },
    interaction: { deleteMany: method('interaction.deleteMany') },
    contact: { deleteMany: method('contact.deleteMany') },
    auditLog: {
      deleteMany: method('auditLog.deleteMany'),
      create: method('auditLog.create'),
    },
    workspace: {
      delete: method('workspace.delete'),
      deleteMany: method('workspace.deleteMany'),
      update: method('workspace.update'),
    },
    user: {
      delete: method('user.delete'),
      deleteMany: method('user.deleteMany'),
      update: method('user.update'),
    },
  }
  const db = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  }
  return { calls, db, tx }
})

vi.mock('@/lib/db', () => ({ db: mocks.db }))

import { deleteWorkspaceData } from '@/lib/services/workspace-data-deletion'

beforeEach(() => {
  mocks.calls.length = 0
  vi.clearAllMocks()
})

describe('deleteWorkspaceData', () => {
  it('deletes workspace relationship-intelligence data in a scoped transaction', async () => {
    await deleteWorkspaceData({ workspaceId: 'workspace-1', userId: 'user-1' })

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.calls.map((call) => call.name)).toEqual([
      'feedback.deleteMany',
      'conversation.deleteMany',
      'conversationMessage.deleteMany',
      'recommendation.deleteMany',
      'evidence.deleteMany',
      'analysisRun.deleteMany',
      'importJob.deleteMany',
      'contactEdge.deleteMany',
      'interaction.deleteMany',
      'contact.deleteMany',
      'auditLog.deleteMany',
      'auditLog.create',
    ])
    expect(mocks.tx.conversation.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.conversationMessage.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.feedback.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.analysisRun.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.importJob.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.evidence.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.contactEdge.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.interaction.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.contact.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.recommendation.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { analysisRun: { workspaceId: 'workspace-1' } },
          { contact: { workspaceId: 'workspace-1' } },
        ],
      },
    })
  })

  it('preserves workspace and user records and leaves only a minimal deletion audit event', async () => {
    await deleteWorkspaceData({ workspaceId: 'workspace-1', userId: 'user-1' })

    expect(mocks.tx.workspace.delete).not.toHaveBeenCalled()
    expect(mocks.tx.workspace.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.workspace.update).not.toHaveBeenCalled()
    expect(mocks.tx.user.delete).not.toHaveBeenCalled()
    expect(mocks.tx.user.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    expect(mocks.tx.auditLog.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' } })
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        action: 'WORKSPACE_DATA_DELETED',
        metadata: {},
      },
    })
  })
})
