import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.upsert({
    where: { userIdHash: 'demo_user_hash' },
    update: {},
    create: {
      userIdHash: 'demo_user_hash',
      username: 'demo',
      concurrentLimit: 2,
      availableCredits: 100,
    },
  })

  console.info('Seeded user id=', user.id)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
