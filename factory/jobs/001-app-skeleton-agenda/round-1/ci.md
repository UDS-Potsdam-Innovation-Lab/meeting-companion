CI: failure
Run: https://github.com/UDS-Potsdam-Innovation-Lab/meeting-companion/actions/runs/41098841676 (commit 954a8c5)
- ubuntu-latest: success
- windows-latest: success
- macos-latest: failure, step "Test", Playwright e2e/agenda-setup.spec.ts:123 "an item can be edited entirely by keyboard"

    Error: expect(locator).toContainText(expected) failed
    Locator: locator('.agenda-row').first()
    Expected substring: "20 min"
    Received string:    "01Kick-offOutcome: Everyone knows the goaleditDecide210 min"
      > 141 |     await expect(row).toContainText("20 min");

Likely cause: the test selects the minutes field with "Control+A", which is not select-all on macOS (Cmd+A), so "20" is typed into the existing "10". Use "ControlOrMeta+A".
Note: cargo test 27/27 and the other 7 Playwright tests passed on macOS.
