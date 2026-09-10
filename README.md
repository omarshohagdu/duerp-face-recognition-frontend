# duerp-face-recognition-frontend

React client for the DU face-attendance service (`duerp-attendance`, default
`:8083`). Implements the five journeys in the backend's
[`docs/UI_FLOW.md`](../duerp-face-recognition-backend/docs/UI_FLOW.md); the
wire-level contract is in `docs/wow_attendance.md`.

**React 19 · Vite 6 · TypeScript 5.7 · react-router-dom 7 · axios · Tailwind 4**

## Running it

```bash
npm install
cp .env.example .env      # fill in VITE_EXT_APP_ID / VITE_EXT_APP_PASSWORD
npm run dev               # http://localhost:5173
```

`npm run build` type-checks and bundles; `npm run typecheck` does the former alone.

> **Dev must run on `localhost`.** `getUserMedia` and `navigator.geolocation`
> require a secure context — HTTPS *or* localhost. On a plain-HTTP LAN address
> (`http://192.168.x.x:5173`) browsers silently refuse both, so the camera and
> GPS screens cannot work at all. That is browser policy, not a bug. Any
> shared/staging build must be served over HTTPS. The dev server therefore binds
> to `localhost` rather than `0.0.0.0`, and the camera screens detect the
> situation and say so instead of showing a permission prompt that never
> appears.

## Screens

| Route | Journey | Endpoint |
|---|---|---|
| `/login` | Sign in | `POST /login` |
| `/face-setup` | A — Enrollment | `enroll`, `check` |
| `/attendance/mark` | B — Verify & mark attendance | `verify` |
| `/attendance/enrolled` | C — Enrolled list + single-person lookup | `enrolled`, `check` |
| `/attendance/reports` | D — Reports by date range / by person | `reports/by-date`, `reports/by-person` |
| `/attendance/buildings` | E — Geo-fence admin | `mapping-save` |

## The five things that will bite you

Each is enforced somewhere specific in the code; changing that code is how you
reintroduce the bug.

**1 · A `200` does not mean it worked.** `verify` returns `200 OK` with
`success: false` for its two most common outcomes — face not recognized, and
face didn't match the requested person. Branching on HTTP status alone tells
users their attendance was recorded when it was not. `Envelope<T>` in
`src/types/attendance.ts` is a discriminated union on `success`, so narrowing on
it is what makes the payload reachable — the compiler enforces this rather than
discipline. Every call site does `if (body?.success === true)`.

**2 · Never reuse a shared duerp-api axios client** (`src/api/attendance.ts`).
Four separate breakages, documented in the file. The nastiest: a global
`401 → logout` interceptor. This API returns `401` for `token mismatch`,
i.e. "that isn't your face" — a retryable outcome, not session expiry. Reusing
such a client logs the user out whenever a face fails to match, which looks like
a random logout bug in the field. There is also **no default `Content-Type`** on
purpose: axios infers multipart-with-boundary for `FormData` and JSON for a
plain object, which is exactly what enroll/verify and mapping-save respectively
need.

**3 · Always encode captures as JPEG** (`src/lib/image.ts`). Phones capture HEIC
by default. The server accepts HEIC but cannot decode it to shrink it, so an
oversized one is forwarded to the AI platform as-is and fails *there* — a
confusing downstream error rather than a clean "too large". A canvas
`toBlob(..., "image/jpeg")` sidesteps it entirely, so **both** the camera path
and the file-picker path go through the same re-encode. Nothing uploads a file's
original bytes.

**4 · `0, 0` is "no fix", not a location** (`src/hooks/useGeolocation.ts`).
Employee check-ins are geo-fenced and the gate fails closed. A phone that hasn't
acquired GPS commonly reports `0,0` (which is in the Gulf of Guinea), so `0,0`
is skipped, `coords` stays `null`, and that is what keeps the capture button
disabled behind a "Getting your location…" state. Students are recorded without
a location check and are never blocked on GPS.

**5 · `live_image` is a filesystem path, not a URL** (`src/lib/liveImage.ts`).
It takes at least four shapes across environments. Take the substring from
`/uploads/` onward, prefix the service origin, and percent-escape the filename —
uploaded names routinely contain spaces. Records predating the 2026-08-19
uploads move will 404; those render a placeholder, because the attendance record
is still valid and a broken-image icon reads as though it isn't.

## There is no admin authorization

The `X-Admin-Key` that used to guard the geo-fence write, the two log readers
and the attendance reports has been removed from both the SPA and the service.
Those endpoints now take a valid bearer token and nothing else, so **any account
that can sign in** can read every check-in the university has recorded, read the
step logs (usernames, client IPs, GPS coordinates) and move any office's
geo-fence.

`lib/roles.ts` hides those screens from a member, but that is navigation, not
authorization — the token carries no role, and the endpoints answer a hand-made
request regardless. UI_FLOW §8.2 describes the proper fix, a duerp-api-side
proxy holding a real credential; until something like it exists, deploy this
behind a network the whole signed-in population is trusted on.

## Known gaps, all upstream

These are backend limitations the UI works around rather than hides, and each
one is called out on the relevant screen:

- **No search or sort anywhere.** Neither the enrolled list nor the reports
  accept a name/ID search or a sort key, so a search box would filter only the
  current page — worse than none, because it looks like it searched everything.
  The single-person lookup on `/attendance/enrolled` is the workable path.
- **Geo-fence mappings cannot be read back.** `mapping-save` is the only mapping
  endpoint — no list, no read, no delete. The screen is write-only and says so;
  the save response is rendered in full because it is the entire feedback loop.
  A stitched-together table would drift from the database and is worse than
  flying blind knowingly.
- **`matched` is always `true` and `confidence` always `1.0`**, and only
  successful check-ins are ever recorded. Neither is rendered: a "100% match"
  badge on every row is a number users would believe. A "failed attempts" report
  has no data behind it.
