import { spawnSync } from 'node:child_process'

process.env.DATABASE_URL ||= 'postgresql://networkmind:networkmind@localhost:5432/networkmind'

const command = process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
const result = spawnSync(command, ['generate'], {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
