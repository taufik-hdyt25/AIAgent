# Product Research API (TH Agent)

The product-research endpoints run in the existing Agent web service at `https://ai.thstudio.web.id`. They use the existing server-to-server `TH_ADMIN_AGENT_API_KEY`; never expose this key in a browser or mobile app. Requests are subject to the configured `TH_ADMIN_ALLOWED_IPS` allowlist and a 10-request/minute per-IP limit.

Send `Authorization: Bearer <TH_ADMIN_AGENT_API_KEY>` and `Content-Type: application/json` where applicable.

## Google Play candidates

`GET /api/product-research/candidates?q=budget%20planner&country=us&language=en&limit=10`

Searches Google Play and returns listing metadata when available. Rating and review count are observed listing values. Install counts are only returned when the listing supplies them, and are marked `installsIsEstimate`; the API does not invent popularity metrics. Google Play may rate-limit or block automated search from some networks; in that case use the candidate endpoint with a Play Store URL or package ID.

`GET /api/product-research/candidate?url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.example.app&country=us&language=en`

Alternatively use `?appId=com.example.app`.

## Save and manage research

- `GET /api/product-research` — list saved candidates and plans.
- `POST /api/product-research` — save `{ "candidate": { "id": "com.example.app", "title": "Example" }, "title": "Optional title", "plan": null }`.
- `PATCH /api/product-research/<uuid>` — update `title`, `candidate`, or `plan`.
- `DELETE /api/product-research/<uuid>` — delete a saved item.

Items are stored in `~/.th-agent/data/product-research.json` with restrictive file permissions.

## AI analysis and refinement

`POST /api/product-research/analyze`

```json
{
  "candidate": { "id": "com.example.app", "title": "Example", "description": "Listing details" },
  "country": "US",
  "category": "Productivity",
  "keywords": "planner, budget",
  "researchId": "optional-saved-item-uuid"
}
```

The active primary Pi model produces a structured plan covering target users, problem, market gap, MVP features, differentiators, monetization, risks, phases, and evidence notes. To refine, include `researchId`, `priorPlan`, and `feedback`; the refined plan is saved to that item. If omitting `researchId`, the plan is returned without persistence.

All endpoints return `{ "ok": true, "data": ... }` or a structured `{ "ok": false, "error": { "code": ..., "message": ... } }`. Market-gap statements and popularity beyond the supplied listing facts are AI-generated hypotheses, not official market measurements.
