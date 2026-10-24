import { PersonToAlbum } from './function'
import { init } from '@immich/sdk'
import cron from 'node-cron'
import { Link } from './types'

const pta = new PersonToAlbum()
let running = false

async function main (full: boolean) {
  if (running) {
    console.log('Previous run still in progress, skipping this one.')
    return
  }
  running = true
  try {
    await run(full)
  } finally {
    running = false
  }
}

async function run (full: boolean) {
  console.log(new Date().toISOString() + (full ? ' (full sync)' : ''))

  // Test connection to Immich
  let immichAvailable = false
  const pingUrl = pta.config.immichServer + '/api/server/ping'
  try {
    const response = await fetch(pingUrl)
    const result = await response.json()
    immichAvailable = result.res === 'pong'
  } catch (e) { }
  if (!immichAvailable) {
    console.log('Unable to ping Immich API on ' + pingUrl)
    console.log('Make sure that URL is accessible to this container.')
    console.log('You can test this by running:')
    console.log(`docker exec immich-person-to-album sh -c "wget -qO- ${pingUrl}"`)
    console.log('The result should be `{"res":"pong"}`')
    return
  }

  for (const user of pta.config.users) {
    // Init Immich SDK with the specified API key
    init({ baseUrl: pta.config.immichServer + '/api', apiKey: user.apiKey })

    // Per album: the assets that should stay in it, and whether every link worked
    const albums = new Map<string, { keep: Set<string>, ok: boolean, remove: boolean, description: string }>()

    // Process each of the person-album linkages
    for (const link of user.personLinks as Link[]) {
      // Populate a truncated API key which will be used in the store.json key name
      link.apiKeyShort = user.apiKey.slice(0, 6)
      const album = albums.get(link.albumId) || { keep: new Set<string>(), ok: true, remove: false, description: link.description || link.albumId }
      albums.set(link.albumId, album)
      album.remove = album.remove || !!link.removeUntagged

      const problem = pta.validateLink(link)
      if (problem) {
        console.log(`=== ${link.description || link.albumId} ===`)
        console.log(` - skipped: ${problem}`)
        album.ok = false
        continue
      }
      try {
        const ids = await pta.processLink(link, full)
        ids?.forEach(id => album.keep.add(id))
      } catch (e: any) {
        album.ok = false
        console.log(` - failed: ${e?.status ? `HTTP ${e.status} ` : ''}${e?.data?.message || e?.message || e}`)
      }
    }

    // Removing is only safe after a full sync in which every link of the album worked
    if (full) {
      for (const [albumId, album] of albums) {
        if (!album.remove) continue
        if (!album.ok) {
          console.log(`Not removing anything from album ${albumId}: at least one of its links failed.`)
          continue
        }
        try {
          await pta.removeUntagged(albumId, album.keep, album.description)
        } catch (e: any) {
          console.log(` - removing from album ${albumId} failed: ${e?.data?.message || e?.message || e}`)
        }
      }
    }
  }
  console.log('Waiting for next scheduled task...')
}

// Send the correct process error code for any uncaught exceptions
// so that Docker can gracefully restart the container
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully shutting down...')
  process.exit(0)
})

// Full sync on startup, then incremental runs and a regular full sync on a schedule
main(true)
  .then(() => {
    cron.schedule(pta.config.schedule || '0,30 * * * *', () => main(false))
    const fullSchedule = pta.config.fullSyncSchedule ?? '0 3 * * *'
    if (fullSchedule) cron.schedule(fullSchedule, () => main(true))
  })
