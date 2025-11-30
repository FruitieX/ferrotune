# Testing Guide

This document provides comprehensive guidance for testing in Ferrotune.

## Quick Start

```bash
# Run all backend tests
moon run test

# Run all frontend E2E tests  
moon run client:test

# Full CI (both backend and frontend)
moon run ci
```

---

## Test-Driven Development Workflow

**Every implementation should follow this cycle:**

1. **Implement the feature** - Write the code
2. **Write tests** - Add hurl tests (backend) or Playwright tests (frontend)
3. **Run tests** - Execute and verify they pass
4. **Fix failures** - Debug and iterate until green
5. **Commit** - Only commit when tests pass

This feedback loop is critical. Don't skip steps 3-4.

---

## Backend Testing (Rust + Hurl)

### Test Architecture

The test harness in `tests/common/mod.rs` manages isolated test servers:

1. **Port Allocation** - Finds available ports automatically
2. **Temp Directory** - Creates isolated environment with database, config, music folder
3. **Fixture Copying** - Copies test audio from `tests/fixtures/music/`
4. **Server Lifecycle** - Starts server, polls until ready, stops on drop
5. **Cleanup** - Removes temp files when test completes

```rust
let server = TestServer::new()?;
server.scan_library()?;  // Populate database
// Server accessible at server.base_url
// Cleaned up automatically when dropped
```

### Running Backend Tests

```bash
# All tests
cargo test

# Specific test suite
cargo test test_browse_endpoints
cargo test test_starring_endpoints

# With server output (for debugging)
cargo test test_browse_endpoints -- --nocapture

# Full integration (all scripts sequentially)
cargo test test_full_integration -- --ignored
```

### Hurl Test Scripts

Tests live in `tests/hurl/` using the [Hurl](https://hurl.dev/) format:

| Script | Coverage |
|--------|----------|
| `01_system.hurl` | ping, getLicense, extensions, music folders |
| `02_auth.hurl` | Authentication methods, error cases |
| `03_browse.hurl` | Artists, albums, songs, genres |
| `04_streaming.hurl` | stream, download, cover art |
| `05_search.hurl` | search3 with various queries |
| `06_starring.hurl` | star, unstar, setRating, getStarred |
| `07_playlists.hurl` | Playlist CRUD operations |
| `08_lists.hurl` | Album lists, random songs, scrobble |
| `09_playqueue.hurl` | Play queue save/retrieve |

### Writing Hurl Tests

Basic structure:
```hurl
# Comment describing the test
GET {{base_url}}/rest/endpoint?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&param=value
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
[Captures]
captured_value: jsonpath "$.subsonic-response.data.id"
```

Available variables:
- `{{base_url}}` - Server URL (e.g., `http://127.0.0.1:31518`)
- `{{username}}` - Admin username
- `{{password}}` - Admin password
- `{{password_hex}}` - Hex-encoded password (for token auth)

### Hurl Best Practices

1. **Test both formats** - JSON and XML where applicable
2. **Use captures** - Extract IDs for subsequent requests
3. **Verify required fields** - Check all OpenSubsonic-required fields exist
4. **Test error cases** - Invalid input, not found, unauthorized
5. **Test idempotency** - Star/unstar should be repeatable
6. **Verify state changes** - Confirm operations actually modify data

### Adding a New Hurl Test

1. Create `tests/hurl/NN_feature.hurl`
2. Add test function in `tests/integration.rs`:
   ```rust
   #[test]
   fn test_feature_endpoints() {
       if !hurl_available() { return; }
       if !fixtures_exist() { return; }
       
       let server = TestServer::new().expect("Failed to start test server");
       server.scan_library().expect("Failed to scan library");
       
       run_hurl_script(&server, &hurl_script("NN_feature.hurl"))
           .expect("Feature endpoint tests failed");
   }
   ```

---

## Frontend Testing (Playwright)

### Test Architecture

E2E tests live in `client/e2e/` and use Playwright:

- **Global Setup** (`global-setup.ts`) - Starts Ferrotune backend + Next.js dev server
- **Fixtures** (`fixtures.ts`) - Test helpers and known test data
- **Global Teardown** (`global-teardown.ts`) - Stops servers

### Running Frontend Tests

```bash
cd client

# Run all E2E tests
npm run test:e2e

# Run with UI (for debugging)
npx playwright test --ui

# Run specific test file
npx playwright test auth.spec.ts

# Run headed (see browser)
npx playwright test --headed
```

### Test Fixtures

The `fixtures.ts` file provides:

**Test configuration:**
```typescript
testConfig.serverUrl  // Ferrotune server URL
testConfig.username   // Test username
testConfig.password   // Test password
```

**Known test data (matches `generate-test-fixtures.sh`):**
```typescript
testData.artists  // 3 artists: "Test Artist", "Another Artist", "Various Artists"
testData.albums   // 3 albums with year, genre, track count
testData.tracks   // 7 tracks with title, artist, album
testData.genres   // ["Rock", "Electronic", "Pop"]
```

**Helper functions:**
```typescript
login(page)                    // Authenticate to server
waitForToast(page, text)       // Wait for toast notification
searchFor(page, query)         // Navigate to search and search
goToLibrary(page, section)     // Navigate to library tab
playFirstSong(page)            // Play first track from Test Album
waitForPlayerReady(page)       // Wait for player to be interactive
```

### Pre-authenticated Page Fixture

```typescript
import { test, expect } from "./fixtures";

test("my test", async ({ authenticatedPage }) => {
  // Page is already logged in
  await authenticatedPage.goto("/library");
});
```

### Writing Playwright Tests

```typescript
import { test, expect, testData, login, waitForToast } from "./fixtures";

test.describe("Feature Name", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should do something", async ({ page }) => {
    await page.goto("/library");
    
    // Use known test data
    const album = page.locator("article").filter({ hasText: testData.albums[0].name });
    await expect(album).toBeVisible();
    
    // Interact
    await album.click();
    
    // Verify
    await waitForToast(page, "Added to queue");
  });
});
```

### Mobile Testing

Tests run on both desktop and mobile viewports. Handle differences:

```typescript
test("sidebar navigation", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chrome") {
    // Mobile: direct navigation (no sidebar)
    await page.goto("/favorites");
    return;
  }
  // Desktop: use sidebar
  await page.click('[data-testid="sidebar-favorites"]');
});
```

---

## Test Fixtures (Audio Files)

Generate test audio files with:
```bash
./scripts/generate-test-fixtures.sh
```

This creates files in `tests/fixtures/music/`:

```
Test Artist/
  Test Album/
    01 - First Song.mp3
    02 - Second Song.mp3
    03 - Third Song.mp3
Another Artist/
  Another Album/
    01 - FLAC Track One.flac
    02 - FLAC Track Two.flac
Various Artists/
  Compilation Album/
    01 - Compilation Track.mp3
    02 - Another Compilation.mp3
```

Each file has:
- Unique frequency tones (for stream verification)
- Embedded cover art
- Complete ID3/Vorbis tags

---

## Debugging Test Failures

### Backend

1. Run with `--nocapture` to see server output
2. Check the hurl script line number in error message
3. Test endpoint manually with curl:
   ```bash
   curl "http://localhost:4040/rest/endpoint?u=admin&p=admin&v=1.16.1&c=test&f=json"
   ```

### Frontend

1. Run with `--ui` for interactive debugging
2. Run with `--headed` to see the browser
3. Use `page.pause()` to pause execution
4. Check `playwright-report/` for traces and screenshots
5. Look at `test-results/` for failure artifacts

---

## CI/CD

The full CI pipeline runs:
```bash
moon run ci
```

This executes:
1. Rust formatting check (`cargo fmt --check`)
2. Rust linting (`cargo clippy`)
3. Backend tests (all hurl scripts)
4. Frontend build
5. Frontend E2E tests
