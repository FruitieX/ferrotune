# AI Agent Instructions for Ferrotune

## Project Overview

**Ferrotune** is an OpenSubsonic-compatible music server written in Rust with a Next.js web client. It enables users to stream their personal music libraries using any Subsonic-compatible client application.

### Technology Stack
| Component | Technology |
|-----------|------------|
| Backend | Rust, Axum, SQLite (sqlx), Tokio |
| Frontend | Next.js, React, TailwindCSS, Jotai |
| Testing | Hurl (backend), Playwright (frontend) |
| Task Runner | Moon |

### Architecture
- **OpenSubsonic API** (`/rest` port 4040) - Client-facing API for Subsonic ecosystem
- **Admin API** (`/ferrotune` port 4040) - REST API for administration
- **Web Client** (`client/`) - Next.js web interface

---

## Project Structure

```
ferrotune/
├── src/                      # Rust backend
│   ├── main.rs               # CLI entry point
│   ├── api/subsonic/         # OpenSubsonic endpoints
│   ├── api/ferrotune/        # Admin API
│   └── db/                   # Database queries
├── client/                   # Next.js frontend
│   ├── src/app/              # App router pages
│   ├── src/components/       # React components
│   ├── src/lib/              # Utilities, API client, store
│   └── e2e/                  # Playwright tests
├── migrations/               # SQLite migrations
├── tests/                    # Backend integration tests
│   ├── hurl/                 # Hurl HTTP test scripts
│   └── fixtures/             # Test audio files
└── docs/                     # Extended documentation
    ├── API_STATUS.md         # Endpoint implementation status
    └── TESTING.md            # Comprehensive testing guide
```

---

## Development Commands

```bash
# Build
moon run build              # Release build
cargo build                 # Debug build

# Run server
cargo run -- --config config.example.toml serve

# Run tests
moon run test               # Backend tests
moon run client:test        # Frontend E2E tests
moon run ci                 # Full CI pipeline

# Generate test fixtures (requires ffmpeg)
./scripts/generate-test-fixtures.sh
```

---

## Testing Requirements

**Every implementation must include tests. Follow this workflow:**

1. **Implement** the feature
2. **Write tests** - Hurl for backend, Playwright for frontend
3. **Run tests** - Verify they pass
4. **Fix failures** - Iterate until green
5. **Commit** - Only when tests pass

For detailed testing guidance, see [docs/TESTING.md](docs/TESTING.md).

### Quick Test Commands
```bash
# Backend
cargo test test_browse_endpoints -- --nocapture

# Frontend
cd client && npx playwright test --ui
```

---

## Code Conventions

### Backend (Rust)

**Response Format**: Endpoints support both JSON and XML via `FormatResponse`:
```rust
pub async fn endpoint(user: AuthenticatedUser, ...) -> Result<FormatResponse<Response>> {
    Ok(FormatResponse::new(user.format, response))
}
```

**Authentication**: Uses `AuthenticatedUser` extractor. Three methods:
1. API Key: `?k=<token>`
2. Token + Salt: `?t=<hash>&s=<salt>`
3. Plain Password: `?p=<password>` (testing only)

**Error Handling**: Use `Error` enum in `error.rs`:
- `Error::NotFound(msg)` → 404
- `Error::InvalidRequest(msg)` → 400
- `Error::Unauthorized(msg)` → 401

**Query Parameters**: Use custom deserializers in `query.rs` for Subsonic's quirky parameter handling (single values OR arrays).

### Frontend (Next.js)

**State Management**: Jotai atoms in `src/lib/store/`
**API Client**: `src/lib/api/client.ts` wraps OpenSubsonic calls
**Components**: Shadcn/ui components in `src/components/ui/`

---

## Common Tasks

### Adding a New OpenSubsonic Endpoint
1. Add handler in `src/api/subsonic/*.rs`
2. Add route in `src/api/mod.rs`
3. Create request/response structs with serde
4. Implement `ToXml` trait for XML support
5. Add database queries if needed
6. **Write hurl tests** in `tests/hurl/`
7. Run tests: `cargo test`

### Adding a Frontend Feature
1. Implement component/page
2. **Write Playwright tests** in `client/e2e/`
3. Run tests: `cd client && npm run test:e2e`

### Adding a Database Field
1. Create migration in `migrations/NNN_description.sql`
2. Update model in `src/db/models.rs`
3. Update queries in `src/db/queries.rs`
4. Update response structs

---

## Extended Documentation

Read these when working on specific areas:

- **[docs/API_STATUS.md](docs/API_STATUS.md)** - OpenSubsonic endpoint implementation status
- **[docs/TESTING.md](docs/TESTING.md)** - Comprehensive testing guide with examples

---

## Resources

- [OpenSubsonic API Spec](https://opensubsonic.netlify.app/)
- [Hurl Documentation](https://hurl.dev/)
- [Axum Documentation](https://docs.rs/axum/latest/axum/)
- [Playwright Documentation](https://playwright.dev/)

## Further instructions

- After implementing a feature, suggest a conventional commits compliant commit message summarizing the change.