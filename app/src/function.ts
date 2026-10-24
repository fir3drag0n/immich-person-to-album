import { Link, Config } from './types'
import { addAssetsToAlbum, removeAssetFromAlbum, searchAssets, MetadataSearchDto } from '@immich/sdk'
import store from './store'
import path from 'path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE = 1000
const CHUNK_SIZE = 500

interface AssetSet {
  ids: Set<string>
  /** Most recent `updatedAt` of all returned assets */
  mostRecent?: string
}

export class PersonToAlbum {
  config: Config

  constructor () {
    this.initConfig()
  }

  /**
   * Read the config.json file or parse the CONFIG env value to get the configuration
   */
  initConfig () {
    try {
      if (process.env.CONFIG) {
        // Attempt to parse docker-compose config string into JSON (if specified)
        this.config = JSON.parse(process.env.CONFIG)
      } else {
        const configJson = require(path.resolve('../data/config.json'))
        if (typeof configJson === 'object') this.config = configJson
      }
    } catch (e) {
      console.log(e)
      console.log('Unable to parse config file.')
    }
  }

  /**
   * People of a link, from `personIds` or the original `personId`
   */
  getPersonIds (link: Link): string[] {
    const ids = link.personIds?.length ? link.personIds : (link.personId ? [link.personId] : [])
    return [...new Set(ids)]
  }

  /**
   * Check a link before using it, so a typo in one ID gives a clear message
   * instead of a bare API error.
   */
  validateLink (link: Link): string | null {
    const people = this.getPersonIds(link)
    if (!people.length) return 'no personId/personIds given'
    const bad = [...people, link.albumId].filter(id => !UUID.test(id || ''))
    if (bad.length) return `invalid ID(s): ${bad.join(', ')} (expected a UUID like 1b2c3d4e-...)`
    if (link.match && !['any', 'all'].includes(link.match)) return `invalid match "${link.match}" (use "any" or "all")`
    for (const date of [link.takenAfter, link.takenBefore]) {
      if (date && isNaN(Date.parse(date))) return `invalid date "${date}"`
    }
    return null
  }

  /**
   * Fetch all asset IDs matching a search, following every page
   */
  async fetchAssets (dto: MetadataSearchDto): Promise<AssetSet> {
    const result: AssetSet = { ids: new Set() }
    // Newer Immich versions page with a cursor, older ones with a page number
    let next: { page?: number, cursor?: string } | null = { page: 1 }
    while (next !== null) {
      const res = await searchAssets({ metadataSearchDto: { ...dto, ...next, size: PAGE_SIZE } })
      for (const asset of res.assets.items) {
        result.ids.add(asset.id)
        if (!result.mostRecent || asset.updatedAt > result.mostRecent) result.mostRecent = asset.updatedAt
      }
      if (!res.assets.items.length) next = null
      else if (res.assets.nextCursor) next = { cursor: res.assets.nextCursor }
      else if (res.assets.nextPage) next = { page: parseInt(res.assets.nextPage, 10) }
      else next = null
    }
    return result
  }

  /**
   * All assets of a link (optionally only those updated after `updatedAfter`)
   */
  async fetchLinkAssets (link: Link, updatedAfter?: string): Promise<AssetSet> {
    const base: MetadataSearchDto = {}
    if (updatedAfter) base.updatedAfter = updatedAfter
    if (link.takenAfter) base.takenAfter = new Date(link.takenAfter).toISOString()
    if (link.takenBefore) base.takenBefore = new Date(link.takenBefore).toISOString()

    const people = this.getPersonIds(link)
    // Immich combines several personIds with AND, so `all` is a single search
    if (link.match === 'all' || people.length === 1) {
      return this.fetchAssets({ ...base, personIds: people })
    }
    // `any`: one search per person, then merge
    const merged: AssetSet = { ids: new Set() }
    for (const personId of people) {
      const part = await this.fetchAssets({ ...base, personIds: [personId] })
      part.ids.forEach(id => merged.ids.add(id))
      if (part.mostRecent && (!merged.mostRecent || part.mostRecent > merged.mostRecent)) merged.mostRecent = part.mostRecent
    }
    return merged
  }

  async addToAlbum (albumId: string, ids: string[]) {
    let added = 0
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const res = await addAssetsToAlbum({ id: albumId, bulkIdsDto: { ids: ids.slice(i, i + CHUNK_SIZE) } })
      added += res.filter(x => x.success).length
    }
    return added
  }

  async removeFromAlbum (albumId: string, ids: string[]) {
    let removed = 0
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const res = await removeAssetFromAlbum({ id: albumId, bulkIdsDto: { ids: ids.slice(i, i + CHUNK_SIZE) } })
      removed += res.filter(x => x.success).length
    }
    return removed
  }

  /**
   * Process one link.
   *
   * Incremental: only assets updated since the last run (fast, but misses faces that
   * were assigned to older photos later on, see upstream issue #11).
   * Full: all assets of the link, compared with the album, so nothing is missed.
   *
   * Returns the asset IDs of the link on a full sync (used for `removeUntagged`).
   */
  async processLink (link: Link, full: boolean): Promise<Set<string> | undefined> {
    const key = this.getUpdateKeyName(link)
    const people = this.getPersonIds(link)

    if (link.description) console.log(`=== ${link.description} ===`)
    console.log(`${full ? 'Full' : 'Incremental'} sync: ${people.join(link.match === 'all' ? ' AND ' : ' OR ')} -> album ${link.albumId}`)

    const since = full ? undefined : store.get(key)
    const assets = await this.fetchLinkAssets(link, since)

    let toAdd = [...assets.ids]
    if (full) {
      const album = await this.fetchAssets({ albumIds: [link.albumId] })
      toAdd = toAdd.filter(id => !album.ids.has(id))
    }
    const added = toAdd.length ? await this.addToAlbum(link.albumId, toAdd) : 0
    console.log(` - ${assets.ids.size} matching asset(s), ${added} newly added`)

    // Only move the timestamp forward, never back, and only if something was found
    const previous = store.get(key)
    if (assets.mostRecent && (!previous || assets.mostRecent > previous)) {
      await store.set(key, assets.mostRecent)
    }
    return full ? assets.ids : undefined
  }

  /**
   * Remove assets from an album that belong to none of its links.
   * Only call this when every link of the album was processed successfully.
   */
  async removeUntagged (albumId: string, keep: Set<string>, description: string) {
    const album = await this.fetchAssets({ albumIds: [albumId] })
    const remove = [...album.ids].filter(id => !keep.has(id))
    if (!remove.length) return
    const removed = await this.removeFromAlbum(albumId, remove)
    console.log(`=== ${description} ===`)
    console.log(` - removed ${removed} asset(s) that no longer match`)
  }

  /**
   * Get the correctly formatted key name for most-recent updated value in the store.
   * For a single person this is the same key as in the original version, so
   * existing store.json files keep working.
   */
  getUpdateKeyName (link: Link) {
    const people = this.getPersonIds(link)
    const parts = [link.apiKeyShort, people.join(link.match === 'all' ? '&' : '+'), link.albumId]
    if (link.takenAfter || link.takenBefore) parts.push(`${link.takenAfter || ''}..${link.takenBefore || ''}`)
    return parts.join(':')
  }
}
