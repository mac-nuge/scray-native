/**
 * scray-exclude.js — the default exclude tag list. Same file in Picker and
 * Native, like scray-dbmode.js.
 *
 * Was: a column in an Excel sheet, reachable only after an interactive
 * Microsoft sign-in, and re-triggering a full signInToExcelOnline() after
 * every single write. Native never loaded excel-sheets.js at all, so
 * window.addTagToDefaultExcludeList was undefined there and the tags-modal
 * button silently did nothing.
 *
 * Now: the `exclude_tags` table, reached with the same API key as everything
 * else. No auth dance, works in Native, and both apps see one list.
 *
 * Deliberately outside the sync stream (no seq, no sync_log) — the list is
 * maintained by hand from the tags modal, not merged between devices.
 */

/** Fetch the list. Returns [] on any failure — a dead list must never block filtering. */
async function fetchDefaultExcludeTags() {
    try {
        const res = await window.scrayApiCall("exclude_get");
        return Array.isArray(res.tags) ? res.tags : [];
    } catch (err) {
        console.warn("Failed to load default exclude tags:", err);
        return [];
    }
}

/**
 * Load the list and apply it to the exclude dropdown.
 *
 * MUST run after populateExcludeTagDropdown(): select2 silently discards a
 * val() for which no matching <option> exists, so calling this early looks
 * like it worked and changes nothing.
 */
async function loadDefaultExcludeTags() {
    const tags = await fetchDefaultExcludeTags();
    if (!tags.length) {
        console.log("No default exclude tags in the database");
        return;
    }

    console.log(`Found ${tags.length} default exclude tags:`, tags);

    const $excludeSelect = $('#excludeTagSelect');
    if (!$excludeSelect.length) return;

    // Union, not replace: anything you ticked by hand this session stays.
    const currentExcludes = $excludeSelect.val() || [];
    const updated = [...new Set([...currentExcludes, ...tags])];
    $excludeSelect.val(updated).trigger('change');

    console.log(`✅ Applied ${tags.length} default exclude tags to dropdown`);
}

/**
 * Toggle a tag on the default exclude list. This is the "maintained manually"
 * half: pressing the tags-modal button on a tag that is already listed offers
 * to take it off again, so the list can be pruned from the same place it's
 * filled.
 *
 * @returns {{added?: boolean, removed?: boolean, alreadyExists?: boolean}}
 */
async function addTagToDefaultExcludeList(tag) {
    const clean = String(tag || '').trim();
    if (!clean) throw new Error('Empty tag');

    const existing = await fetchDefaultExcludeTags();
    const isListed = existing.some(t => t.toLowerCase() === clean.toLowerCase());

    if (isListed) {
        if (!confirm(`"${clean}" is already on the default exclude list.\n\nRemove it?`)) {
            return { alreadyExists: true };
        }
        await window.scrayApiCall("exclude_remove", { method: "POST", body: { tag: clean } });

        // loadDefaultExcludeTags only ever adds, so a removal has to be
        // reflected in the live dropdown by hand.
        const $sel = $('#excludeTagSelect');
        if ($sel.length) {
            const kept = ($sel.val() || []).filter(t => t.toLowerCase() !== clean.toLowerCase());
            $sel.val(kept).trigger('change');
        }
        console.log(`✅ Removed "${clean}" from the default exclude list`);
        return { removed: true };
    }

    await window.scrayApiCall("exclude_add", { method: "POST", body: { tag: clean } });
    console.log(`✅ Added "${clean}" to the default exclude list`);
    await loadDefaultExcludeTags();
    return { added: true };
}

/**
 * The whole tags-modal 'default-exclude' action in one call.
 *
 * There were three byte-identical copies of this handler (ui.js twice,
 * player.js once) in each app — six places to keep in step. They're all
 * one-liners into here now.
 */
async function handleDefaultExcludeAction(tagName, displayName) {
    const label = displayName || tagName;
    // Picker defines showScoreConfirmation in excel-sheets.js, Native in
    // local-scores-cache.js. Reaching through window rather than the bare
    // name keeps this file identical in both.
    const say = (msg, colour) => {
        if (typeof window.showScoreConfirmation === 'function') window.showScoreConfirmation(msg, colour);
        else console.log(msg);
    };
    try {
        const result = await addTagToDefaultExcludeList(tagName);
        if (result.removed) {
            say(`🗑️ Removed "${label}" from default exclude list`, '#ffa500');
        } else if (result.added) {
            say(`✅ Added "${label}" to default exclude list`);
        } else {
            say(`"${label}" left on the default exclude list`, '#ffa500');
        }
    } catch (err) {
        console.error('Default exclude list update failed:', err);
        say('❌ Failed to save', '#f44336');
        alert(`Default exclude list update failed: ${err.message || err}`);
    }
}

window.fetchDefaultExcludeTags     = fetchDefaultExcludeTags;
window.loadDefaultExcludeTags      = loadDefaultExcludeTags;
window.addTagToDefaultExcludeList  = addTagToDefaultExcludeList;
window.handleDefaultExcludeAction  = handleDefaultExcludeAction;
