# Raahi NOW — Phase 1 spec: Drops and events, creation and listing

This file is the binding spec for Phase 1 of the Raahi NOW backend. It is an extract of two longer documents. If this file and the plan disagree, this file wins.

- Product spec: "Raahi NOW — Feature Requirements: Drops, Events & Buddies" (https://claude.ai/artifact/6BYimhHFnHrPF2DD2xBpDq)
- Backend plan: "Raahi NOW — Backend and API plan" (https://claude.ai/artifact/FjQLhZq9gQWPsD9SofPFHL)

## 1. Scope

**In Phase 1:** foundations; markets with time zones; profile; media upload; Drop creation, editing and lifecycle for locals; event creation (accounts and guests); guest claim codes; the review queue; public lists and details for Drops and events; sweepers; outbox; OpenAPI.

**Not in Phase 1:** unlock, RSVP, bookings, offers, payments, Buddies, share, push, notification settings. Exact places, meet details and "after RSVP" addresses are therefore reachable only by their owner and reviewers.

## 2. API conventions

| Topic | Rule |
| --- | --- |
| Base path | `/v1` |
| Auth | `Authorization: Bearer <Firebase ID token>`. Public GETs work without a token and return the logged-out view |
| Roles | `local`: the user has a `locals` row with `verified_at` set. `reviewer` and `admin`: Firebase custom claims. A claim alone never grants `local` |
| Guests | Events accept guest posts with `hostName`, `hostEmail` and an `X-Device-Id` header. The response returns `claimCode` once. A guest manages their event with `X-Claim-Code: <code>` or `Authorization: Manage <token>` |
| Ids | UUIDv7 strings. Markets use slug text ids |
| Time input | Wall-clock `YYYY-MM-DDTHH:mm` plus the market id. The server resolves it in the market's IANA zone. A time that does not exist or occurs twice at a daylight-saving change returns 422 |
| Time output | UTC ISO instants (`...Z`), plus `startsAtLocal` (ISO with offset) and the market's zone name |
| Errors | `{ "code", "field"?, "message", "requestId" }`. Validation failures: 422 `{ "code": "validation_failed", "errors": [{ "code", "field", "message" }], "requestId" }` |
| Status codes | 200, 201 success; 401 `auth.required` or `auth.invalid_token`; 403 not allowed; 404 not found, also for items a viewer may not know exist; 409 state conflict; 422 validation; 429 rate limited |
| Pagination | `?limit=20&cursor=...`. Default 20, maximum 50. Out of range: 422 `limit.range`. A cursor that does not decode: 422 `cursor.invalid` |
| Caching | Anonymous list and detail responses: `Cache-Control: public, max-age=15`. Always `Vary: Authorization`. Requests carrying Authorization: `Cache-Control: private, no-store` |
| Audience-aware output | Every response goes through a serializer taking the audience: `public`, `owner`, `reviewer` |

## 3. Shared field rules

| Rule | Value |
| --- | --- |
| Plain text | HTML tags stripped, edges trimmed, repeated spaces collapsed. Control characters rejected (`text.control_chars`). Lengths count Unicode code points after this normalization |
| Text tiers | Title 5–80. Short 2–120. Body 20–1000. A field's own range overrides |
| Contact details | Not allowed in titles or body text: phone numbers (7 or more digits once separators are removed), emails, `@handles`, URLs and bare domains. Error `text.contact_details` |
| Links | Only in a link field. `https` only, host not on the shortener list: bit.ly, t.co, tinyurl.com, goo.gl, ow.ly, is.gd, buff.ly, rebrand.ly, cutt.ly, shorturl.at |
| Handles | Leading `@` removed. Instagram and Threads ≤ 30 characters, X ≤ 15, TikTok 2–24, YouTube 3–30. Letters, numbers, dot and underscore. X: no dot |
| Images | JPEG, PNG or WebP. At most 5,242,880 bytes. Shortest side at least 800 px. GPS and other metadata removed on processing |
| Places | Fuzzy area 2–80 (public). Exact place or address 5–160 (private) |
| Time zones | One IANA zone per market. All instants stored in UTC |
| Review states | `pending`, `approved`, `rejected`, `removed`. A rejection or removal needs a reason of at least 5 characters, shown to the poster |

## 4. Markets

Seeded by migration. `reset_time` is `06:00` for all.

| id | city | country | tz | currency | status |
| --- | --- | --- | --- | --- | --- |
| new-york-city | New York City | US | America/New_York | USD | open |
| boston | Boston | US | America/New_York | USD | open |
| ellsworth-acadia | Ellsworth / Acadia | US | America/New_York | USD | open |
| kyoto | Kyoto | JP | Asia/Tokyo | JPY | preview |
| sigiriya | Sigiriya | LK | Asia/Colombo | LKR | preview |

`GET /v1/markets` returns `{ items: [{ id, city, country, tz, resetTime, currency, status }] }`. A market used by a Drop or event must exist and be `open` or `preview`, else 422 `market.invalid`.

## 5. Drops

**Fields** (API names in camelCase). "Public" means shown in the public view.

| Field | Type and limits | Required | Validation | Shown |
| --- | --- | --- | --- | --- |
| title | text 5–80 | yes | must not contain the exact-place text | public |
| whyNow | text 20–280 | yes | must not contain the exact-place text | public |
| perfectFor | text 2–120 | yes | | public |
| costMinUsd, costMaxUsd | whole numbers 0–1000 | yes | max ≥ min | public |
| timeMinutes | 15–720 in steps of 15 | yes | | public |
| bestTime | text 2–60 | no | no contact details | public |
| watchOut | text 5–200 | yes | must not contain the exact-place text | public |
| photoMediaId | media id | yes | media is `ready` and owned by the caller | public |
| photoIsStandIn | boolean, default false | no | | public |
| marketId | market id | yes | open or preview | public |
| fuzzyArea | text 2–80 | yes | must not repeat the exact place | public |
| exactPlace | text 5–160 | yes | | owner, reviewer |
| meetDetail | text 5–280 | no | no contact details | owner, reviewer |
| windowHours | one of 3, 6, 12, 24, 48, 72 | yes | | public (as `expiresAt`) |
| unlocksPerDay | whole number 1–20 | yes | | public |
| unlockPriceCredits | whole number 1–3 | yes | stored as `unlock_price_minor = credits × 100` (USD) | public |

**"Exact place text" rule.** Normalize (lower case, punctuation removed, spaces collapsed). Split the exact place on commas. A public field breaks the rule if it contains any segment of 6 or more characters. The fuzzy area breaks its rule if, normalized, it equals a segment or the whole exact place.

**States.** `draft`, `pending`, `live`, `paused`, `gone`, `rejected`, `removed`. "Resting" does not exist until Phase 2.

| From | Action | To |
| --- | --- | --- |
| draft | submit | pending |
| pending | approve | live |
| pending | reject | rejected |
| live | pause | paused |
| paused | resume | live |
| live, paused | end | gone |
| live, paused | expire | gone |
| live, paused | edit_text | pending |
| draft | edit | draft |
| rejected | edit | draft |
| pending, live, paused, gone, rejected | remove | removed |

Any other combination is 409 `drop.invalid_transition`.

**Rules**

- Window: `approved_at = now()` and `expires_at = approved_at + windowHours hours` at approval. Pausing does not stop the clock.
- Expiry is enforced on read: a live Drop with `expires_at ≤ now()` is never returned publicly, whether or not the sweeper has run.
- Only text fields (`title`, `whyNow`, `perfectFor`, `bestTime`, `watchOut`, `meetDetail`) can be edited while `live` or `paused`, and doing so returns the Drop to `pending`. Any other edit is 409 `drop.field_locked`.
- Raise cap: `unlocksPerDay` can only go up, to at most 20. Otherwise 422 `drop.cap_lower` or `unlocksPerDay.range`.
- At most 5 Drops per local in `pending`, `live` or `paused`. Checked on submit. Over: 409 `drop.limit_live`.
- Only a verified local creates Drops (403 `drop.local_required`). A Drop visible to its owner is 404 to everyone else unless it is `live` and unexpired.
- Duplicate: copies every field, including private ones, into a new `draft`.

## 6. Events

| Field | Type and limits | Required | Validation | Shown |
| --- | --- | --- | --- | --- |
| name | text 5–80 | yes | no contact details | public |
| category | `tasting`, `walk`, `market`, `class`, `gathering` | yes | | public |
| marketId | market id | yes | open or preview. Locked after creation | public |
| description | text 20–600 | yes | | public |
| startsLocal | `YYYY-MM-DDTHH:mm` | yes | 30 minutes to 180 days ahead | public |
| endsLocal | `YYYY-MM-DDTHH:mm` | no | after start, within 24 hours of it | public |
| dateNote | text 2–60 | no | | public |
| area | text 2–80 | yes | | public |
| exactAddress | text 5–160 | no | | public if visibility is `public`; else owner, reviewer |
| addressVisibility | `public` or `after_rsvp` | yes if an address is given | | owner |
| capacity | whole number 1–500 | no | | public as `spotsLeft` |
| photoMediaId | media id | no | ready and owned by the caller | public |
| link | URL | no | https, not a shortener | public |
| hostName | text 2–60 | guests only | no contact details | public |
| hostEmail | email | guests only | valid format | never shown |

**Host badge.** `verified_local` if the account has a verified `locals` row, else `community_host`. Stored on the event as `host_name` and `host_badge` so public queries never read `users`.

**States.** `pending`, `upcoming`, `past`, `cancelled`, `rejected`, `removed`.

- A host with no earlier `upcoming` or `past` event (by user id, or by guest email) creates a `pending` event and a review item. A returning host creates an `upcoming` event and an `event.approved` outbox event.
- An event is public only when `upcoming` and `COALESCE(ends_at, starts_at) + 3 hours > now()`. The sweeper marks the rest `past`.
- Duplicate: same owner (user id or guest email), same `name` (case-insensitive), same `marketId`, start within one hour of another non-cancelled event. 409 `event.duplicate`.
- Public list: sorted by `starts_at` then id. `from` and `to` are `YYYY-MM-DD` dates in the market's zone and require `market` (422 `market.required`).
- Owner actions: edit (status must be `pending` or `upcoming`, else 409 `event.not_editable`) and cancel.

## 7. Guests

- A guest post needs `hostName`, `hostEmail` and `X-Device-Id`. Limits: 2 guest posts a day per device hash and 5 a day per IP hash (429 `rate_limited`).
- Claim code: 12 characters of Crockford base32 (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`), from a secure random source. Stored as HMAC-SHA256 (hex) with `CLAIM_CODE_SECRET`. Shown once and emailed.
- `POST /v1/claims/recover { email }` always answers 202 `{ status: "ok" }`. For each event owned by a guest identity with that email, it rotates the code and emails the new codes. Limits: 3 an hour per email hash, 10 an hour per IP hash.
- `POST /v1/claims/exchange { code }` returns `{ manageToken, expiresIn: 900 }` (HS256 JWT signed with `MANAGE_TOKEN_SECRET`, claims `sub` = guest identity id, `evt` = event id). Five failures an hour per device hash or IP hash locks it: 429 `claim.locked`. A wrong code is 401 `claim.invalid`.

## 8. Review

- `GET /v1/admin/review-queue?kind=drop|event` (reviewer): pending items oldest first, with private fields.
- `POST /v1/admin/items/{kind}/{id}/approve | reject | remove` (reviewer). Reject and remove need `{ reason }` of at least 5 characters (422 `review.reason_required`).
- Approve a Drop: `live`, `approved_at`, `expires_at`. Approve an event: `upcoming`. Acting on an item that is not `pending` is 409 `review.not_pending`. Two simultaneous approvals produce exactly one success.
- Every decision writes an `audit_log` row and an outbox event: `drop.approved`, `drop.rejected`, `drop.removed`, `event.approved`, `event.rejected`, `event.removed`.

## 9. Data model (Phase 1)

Ids are UUIDv7 except markets. Times are `timestamptz`.

| Table | Columns | Constraints |
| --- | --- | --- |
| users | id, firebase_uid, email, first_name, email_verified, tz, socials jsonb, created_at | unique firebase_uid; unique lower(email) |
| locals | id, user_id, display_name, role_title, bio, booking_label, booking_price_minor, verified_at, created_at | unique user_id |
| markets | id text, city, country, tz, reset_time time, currency, status | status in (preview, open) |
| media | id, owner_user_id, owner_device_hash, content_type, s3_key, width, height, status, reject_code, created_at | status in (pending, ready, rejected); one of the two owners set |
| drops | id, local_id, market_id, title, why_now, perfect_for, cost_min_usd, cost_max_usd, time_minutes, best_time, watch_out, photo_media_id, photo_is_stand_in, fuzzy_area, unlock_price_minor, unlock_cap, window_hours, status, approved_at, expires_at, unlocks_used default 0, window_date, created_at, updated_at | cost 0–1000 and max ≥ min; time_minutes 15–720 and divisible by 15; window_hours in (3,6,12,24,48,72); unlock_cap 1–20; unlock_price_minor in (100,200,300); status in the seven states; index (market_id, status, expires_at) and (local_id, status) |
| drop_private | drop_id, exact_place, meet_detail | PK drop_id |
| events | id, owner_user_id, guest_identity_id, market_id, name, category, description, starts_at, ends_at, date_note, area, address_visibility, photo_media_id, link, capacity, host_name, host_badge, status, created_at, updated_at | exactly one of owner_user_id and guest_identity_id; ends_at null or within (starts_at, starts_at + 24 hours]; capacity 1–500; index (market_id, status, starts_at) |
| event_private | event_id, exact_address | PK event_id |
| guest_identities | id, email, claim_hash, created_at | unique claim_hash |
| review_items | id, kind, ref_id, state, reason, flags text[], submitted_at, decided_at, reviewer_id | one pending row per (kind, ref_id); index (state, submitted_at) |
| outbox | id, type, subject_kind, subject_id, payload jsonb, created_at, published_at | partial index where published_at is null |
| rate_events | id bigserial, kind, key_hash, created_at | index (kind, key_hash, created_at) |
| audit_log | id, actor_id, action, target_kind, target_id, diff jsonb, created_at | |

**Database roles.** The migration creates a group role `raahi_public_read` (no login). Public list and detail queries run on a separate connection as a login role that belongs to it. It gets SELECT only on: `markets`; `media` (id, content_type, s3_key, width, height, status); `locals` (id, display_name, role_title, bio, booking_label, booking_price_minor, verified_at); `drops`; `events` (all columns except `owner_user_id` and `guest_identity_id`). It gets nothing on `users`, `drop_private`, `event_private`, `guest_identities`, `review_items`, `outbox`, `rate_events`, `audit_log`.

## 10. Messages

Verbatim from the product spec unless marked (plan).

| Code | Message |
| --- | --- |
| `<field>.exact_place` (title, whyNow, watchOut) | This mentions the exact spot. Keep it for the hidden field so travelers unlock it. |
| `watchOut.required` | Add a watch-out so travelers know what to expect. |
| `windowHours.invalid` | Choose how long this Drop stays live. |
| `whyNow.too_short` | Add at least 20 characters so travelers know why this is worth doing today. |
| `image.too_small` | This photo is a little small. Use one at least 800 px on its shortest side. |
| `drop.submitted` | Thanks. We'll review your Drop and start the clock when it goes live. |
| `start.too_soon` | Pick a start at least 30 minutes from now. |
| `end.before_start` | The end needs to be after the start. |
| `event.duplicate` | You already have this event at about that time. Edit it instead? |
| `link.shortened` | Use the full link instead of a shortened one. |
| `event.guest_submitted` | Thanks! We'll take a quick look before it goes up, and email you at {email}. |
| `<field>.too_short` / `.too_long` (plan) | Add at least {min} characters. / Use at most {max} characters. |
| `<field>.required` (plan) | This is needed. |
| `<field>.range` (plan) | Use a number from {min} to {max}. |
| `text.contact_details` (plan) | Keep phone numbers, emails and links out of this field. |
| `text.control_chars` (plan) | Remove the special characters from this field. |
| `link.not_https` (plan) | Use a link that starts with https://. |
| `socials.<platform>.invalid` (plan) | Enter the handle without spaces or symbols. |
| `tz.invalid` (plan) | Choose a valid time zone. |
| `market.invalid`, `market.required` (plan) | Choose one of the listed markets. |
| `start.too_far` (plan) | Pick a start within the next 180 days. |
| `end.too_long` (plan) | The end must be within 24 hours of the start. |
| `start.nonexistent_time`, `start.ambiguous_time` (plan) | That time doesn't exist, or happens twice, at the daylight-saving change. Pick another time. |
| `image.type`, `image.too_large` (plan) | Use a JPEG, PNG or WebP photo. / Use a photo up to 5 MB. |
| `photo.not_ready` (plan) | Wait for the photo to finish uploading, then try again. |
| `drop.limit_live` (plan) | You can have 5 live Drops at a time. End one to submit another. |
| `drop.invalid_transition` (plan) | That can't be done to this Drop right now. |
| `drop.field_locked` (plan) | This can't be changed while the Drop is live. End it and create a new one. |
| `drop.cap_lower` (plan) | The daily limit can only go up while a Drop is live. |
| `drop.local_required` (plan) | Only verified locals can post Drops. |
| `event.not_editable` (plan) | This event can't be changed any more. |
| `review.reason_required` (plan) | Add a reason of at least 5 characters so the poster knows why. |
| `review.not_pending` (plan) | This item has already been reviewed. |
| `rate_limited` (plan) | You've reached today's limit. Try again later. |
| `claim.invalid` (plan) | That claim code doesn't match. |
| `claim.locked` (plan) | Too many tries. Try again in an hour. |
| `auth.required` (plan) | Log in to continue. |
| `auth.invalid_token` (plan) | Your session has expired. Log in again. |
| `limit.range`, `cursor.invalid` (plan) | Use a limit from 1 to 50. / That page link isn't valid. |
| `internal_error` | Something went wrong on our side. Try again. |
