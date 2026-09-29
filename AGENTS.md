# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Scray project instructions

## Code delivery
- When providing code suggestions on the web without connected filesystem access, use find-and-replace instructions. Put the exact find code and replacement code in separate fenced code blocks.
- When connected to the computer, make the requested edits directly and follow the version workflow below.

## Version workflow
- Every edit/change set requires a version bump in each edited repo, including instruction changes. Read the current version first and increment the final numeric component by one; do not reset the major version to the examples below.
- Write the version as: <prefix> - <version> test: <short few-word request summary>.
- After the user tests and confirms it is OK, change test: to stable: with the SAME version number and summary. This status-only promotion does not require another numeric bump.
- If the user already marked that version stable manually, leave it alone.
- Never use double quote characters in version names or summaries; the user uses them as commit comments.

| Repo | Version file | Prefix |
| --- | --- | --- |
| scray-picker | VERSION | staging |
| scray-native | assets/web/VERSION | stg-native |
| scray-browse | VERSION.txt | staging-browse |

## Repositories and shared code
- The connected repos are sibling folders: scray-picker, scray-native, and scray-browse.
- scray-picker is the web app: index.php, ui.js, player.js, randomiser.js, render.js, scray-config.js, style.css.
- scray-native is the Expo/iOS wrapper with a parallel web app under assets/web/.
- scray-browse is browse/admin: api.php, browse.html, stash-manual.html, manage-data.html, and related pages.
- Keep picker and native/assets/web shared UI code in step. Changes to ui.js, player.js, randomiser.js, scray-config.js, and style.css normally apply to both, with a separate version bump in each repo.
- Ask before assuming a shared UI change should be one-sided.
- Native has a catalogue/device path split that picker lacks. Adapt patches to preserve those differences; do not blindly overwrite one copy with the other.

## Changelog
- Every version update, including promotion to stable, must be reflected in that repo's root scray-changelog.md. The browse changelog page merges these three files into the shared changelog.
- Follow the existing convention: newest entry first under Entries, version and summary in the heading, UTC timestamp comment, and a concise explanation of what changed and why.
- For joint changes, follow the existing changelog convention for matching headings across affected repos. Preserve earlier history.
