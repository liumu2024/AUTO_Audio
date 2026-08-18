import {
  CREATIVE_LIBRARY_SEED_LOCAL_USER_ID,
  seedCreativeLibraryFixtures,
} from '../src/modules/creative-library/creative-library-seed.js'
import { prisma } from '../src/shared/prisma.service.js'

async function main() {
  const localMode = process.env.DPL304_LOCAL_MODE === 'true'
  const appUserId = localMode
    ? 1
    : (await prisma.user.upsert({
        where: { userIdHash: 'demo_user_hash' },
        update: {},
        create: {
          userIdHash: 'demo_user_hash',
          username: 'demo',
          concurrentLimit: 2,
          availableCredits: 100,
        },
      })).id
  const libraryUserId = localMode
    ? CREATIVE_LIBRARY_SEED_LOCAL_USER_ID
    : (await prisma.user.upsert({
        where: { userIdHash: 'curated_creative_library_v1' },
        update: {},
        create: {
          userIdHash: 'curated_creative_library_v1',
          username: 'curated-library-v1',
          concurrentLimit: 1,
          availableCredits: 0,
        },
      })).id

  const library = await seedCreativeLibraryFixtures(libraryUserId)
  console.info('Seeded app user id=', appUserId, 'curated profile user id=', libraryUserId, 'library=', library)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
