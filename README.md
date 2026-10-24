# Immich automatic Person -> Album

> **Fork note (fir3drag0n) – 2.2.0:** maintained fork of
> [alangrainger/immich-person-to-album](https://github.com/alangrainger/immich-person-to-album), tested with Immich 3.3.5.
> Existing configs keep working. Changes:
> - **Faces assigned after the first sync are picked up** ([upstream #11](https://github.com/alangrainger/immich-person-to-album/issues/11)):
>   besides the quick incremental runs there is a **full sync** on startup and on `fullSyncSchedule` (default daily 03:00)
>   that compares the album with all assets of the linked people.
> - No crash when a run finds no new assets (the `items[0]` problem behind #10/#11), and the stored timestamp is the newest
>   asset of all pages instead of the first item of the first page.
> - **Several people per link** (#6, #7): `personIds` with `match: "any"` (default) or `"all"` (only photos with all of them).
> - **Date filter** (#8): `takenAfter` / `takenBefore`.
> - **Remove untagged photos** (#5): optional `removeUntagged` per link, applied during the full sync.
>   `"added"` (2.1.0) only removes photos this tool added itself, so photos you put into the album by hand always stay.
>   Safety brake `maxRemovePercent` (2.2.0, default 10): a full sync never removes more than that share of an album at once.
> - IDs are validated up front with a clear message per link (likely cause of #9: a person ID with a missing character).
> - `@immich/sdk` 3.3.5, page size 1000, adds/removes in chunks of 500, no overlapping runs.
>
> Build the image yourself: `docker build -t immich-person-to-album:2.0.0 .` (or use the GHCR image built by the workflow
> on a `v*` tag: `ghcr.io/fir3drag0n/immich-person-to-album`).

Automatically add people (faces) to an album and keep that album up-to-date. You can then share that automatic person-album 
with another user (for example, a shared album of your children).

You can arbitrarily add any face/person to any album. So you could make a "Family" album which contains all your family 
members and is automatically updated.

You can use API keys from any number of Immich users, so the one Docker container can handle doing automatic
albums for all your users.

## Setup

Take a copy of the [docker-compose.yml](https://github.com/alangrainger/immich-person-to-album/blob/main/docker-compose.yml) file.

```yaml
services:
  immich-person-to-album:
    image: alangrainger/immich-person-to-album:latest
    restart: always
    volumes:
      - ./data:/data
```

There are two methods for specifying the config options:

### Configure via `config.json` file

1. In the folder which contains your `docker-compose.yml` file, create a `/data/` folder.
2. Inside the `data` folder, put a copy of [config.json](https://github.com/alangrainger/immich-person-to-album/blob/main/data/config.json.example).
3. Edit the `config.json` file as required.

### ...or via Inline configuration

Alternatively, you can add the configuration inline in your `docker-compose.yml` file like this:

```yaml
    volumes:
      - ./data:/data
    environment:
      CONFIG: |
        {
          "immichServer": "http://192.168.0.20:2283",
          "schedule": "*/30 * * * *",
          "users": [
            {
              "apiKey": "XXXXXXXXXX",       # Immich user's API key (read-only access)
              "personLinks": [
                {
                  "description": "Photos of Joe",
                  "personId": "YYYYYYYYYY", # Joe's person ID
                  "albumId": "ZZZZZZZZZZ"   # Shared album ID
                }
              ]
            }
          ]
        }
```

### Create an API key

1. Open Immich on desktop
2. Click on your profile picture
3. Click **Account Settings**
4. Go to API Keys
5. Click **New API Key**
6. Give it a name
7. Add the permissions `asset.read`, `album.read` and `albumAsset.create` (plus `albumAsset.delete` if you use `removeUntagged`)
8. Click **Create**
9. Copy the new API key and put it in your config file 

### Get your person and album IDs

Person IDs: 

- Immich → Explore → People → Click person → Copy ID from URL
- Example URL: http://your-server/people/f3437c84-83f9-4e84-9640-0dcd12efd08e
- Person ID: f3437c84-83f9-4e84-9640-0dcd12efd08e

Album IDs:

- Immich → Albums → Click album → Copy ID from URL
- Example URL: http://your-server/albums/ff85e8c5-32e6-49e0-a0ad-e4dd7ef66bce
- Album ID: ff85e8c5-32e6-49e0-a0ad-e4dd7ef66bce

## All options

```jsonc
{
  "immichServer": "http://192.168.0.20:2283",
  "schedule": "*/30 * * * *",       // quick incremental sync (default: every 30 minutes)
  "fullSyncSchedule": "0 3 * * *",  // full sync (default: daily 03:00, "" disables it; always runs on startup)
  "users": [
    {
      "apiKey": "XXXXXXXXXX",
      "personLinks": [
        // original format: one person
        { "description": "Joe", "personId": "…", "albumId": "…" },
        // several people, photos with at least one of them, only since 2020, keep the album clean
        { "description": "Family", "personIds": ["…", "…"], "match": "any", "albumId": "…",
          "takenAfter": "2020-01-01", "removeUntagged": "added" },
        // only photos showing both
        { "description": "Joe & Ann", "personIds": ["…", "…"], "match": "all", "albumId": "…" }
      ]
    }
  ]
}
```

`removeUntagged` cleans the album during a full sync in which all links of that album succeeded:

- `"added"` (recommended): removes photos **this tool added** that no longer match (e.g. a wrongly tagged face was
  fixed in Immich). Photos you added by hand are never touched. The tool remembers what it added in `store.json`
  (`added:<key>:<albumId>`); photos added before 2.1.0 are not in that list.
- `true`: removes **every** photo that matches none of the album's links, **including photos you added by hand**.

`maxRemovePercent` (default `10`) is a safety brake: if a full sync would remove more than that percentage of the
album at once (for example after face assignments were reset in bulk), it removes nothing and logs a warning.
At least one photo can always be removed. If several links point at one album, the lowest value applies.

## Troubleshooting

Make sure you can access your Immich API from inside the `immich-person-to-album` container. Run this command from outside the container, making sure to replace the address with your Immich server address:

```bash
docker exec immich-person-to-album sh -c "wget -qO- http://192.168.0.20:2283/api/server/ping"
```

It will return `{"res":"pong"}` if Immich is accessible to the `immich-person-to-album` container.

## Acknowledgements

Thanks to https://github.com/ajb3932/immich-partner-sharing for the idea and for some of the readme text.

The only reason for making this project is that at time of release, the above project [hadn't been updated](https://github.com/ajb3932/immich-partner-sharing/issues/4) to support Immich 2.x.
