console.log("settings.js loaded");

// =========================================
// SCRAY SETTINGS
//
// A tiny registry plus one modal. Settings register themselves with
// scraySettings.register(); the modal renders whatever is registered at the
// time it opens, so adding a setting later means one register() call and no
// changes to the modal itself.
//
// Deliberately NOT prompt(): ScrayNativeView sets itself as the WKUIDelegate
// and (unless the Swift text-input panel has been added) answers prompt()
// with a silent null. Everything here is in-page DOM.
// =========================================
(() => {
  const settings = [];

  /**
   * @param {object} def
   * @param {string}   def.id     stable key, used for the DOM id
   * @param {string}   def.label  shown above the control
   * @param {string}  [def.hint]  small grey text under the label
   * @param {string}  [def.type]  "url" | "text" - input type. Default "text".
   * @param {Function} def.get    () => current value as a string
   * @param {Function} def.set    (value) => void. May throw; the message is
   *                              shown inline and the modal stays open.
   * @param {string}  [def.placeholder]
   * @param {string}  [def.emptyMeans] explains what clearing the field does
   */
  function register(def) {
    if (!def || !def.id || typeof def.get !== "function" || typeof def.set !== "function") {
      console.warn("[settings] ignored a malformed definition:", def);
      return;
    }
    if (settings.some(s => s.id === def.id)) {
      console.warn(`[settings] "${def.id}" is already registered - ignoring the duplicate`);
      return;
    }
    settings.push(def);
  }

  function buildRow(def) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-direction:column;gap:4px;"
      + "padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid #333;";

    const label = document.createElement("label");
    label.textContent = def.label;
    label.htmlFor = `scraySetting_${def.id}`;
    label.style.cssText = "font-size:0.9rem;font-weight:600;margin:0;";
    row.appendChild(label);

    if (def.hint) {
      const hint = document.createElement("div");
      hint.textContent = def.hint;
      hint.style.cssText = "font-size:0.75rem;color:#999;word-break:break-all;";
      row.appendChild(hint);
    }

    const input = document.createElement("input");
    input.id = `scraySetting_${def.id}`;
    input.type = def.type || "text";
    input.value = def.get() || "";
    // Placeholder may be a function so it can show a value that isn't known
    // until the modal opens - the built-in default, for instance.
    const ph = typeof def.placeholder === "function" ? def.placeholder() : def.placeholder;
    if (ph) input.placeholder = ph;
    input.autocapitalize = "off";
    input.autocorrect = "off";
    input.spellcheck = false;
    input.style.cssText = "width:100%;box-sizing:border-box;margin:0;padding:10px;"
      + "background:#2a2a2a;color:#fff;border:1px solid #555;border-radius:4px;"
      + "font-size:0.9rem;";
    row.appendChild(input);

    if (def.emptyMeans) {
      const note = document.createElement("div");
      note.textContent = def.emptyMeans;
      note.style.cssText = "font-size:0.7rem;color:#777;";
      row.appendChild(note);
    }

    const error = document.createElement("div");
    error.style.cssText = "font-size:0.75rem;color:#ff6b6b;display:none;";
    row.appendChild(error);

    return { row, input, error, def };
  }

  function open() {
    // Guard against a double-tap stacking two overlays.
    if (document.getElementById("scraySettingsOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "scraySettingsOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);"
      + "display:flex;align-items:center;justify-content:center;padding:20px;"
      + "box-sizing:border-box;z-index:2147483647;";

    const box = document.createElement("div");
    box.style.cssText = "background:#1e1e1e;color:#fff;border-radius:8px;padding:18px;"
      + "width:100%;max-width:480px;max-height:85vh;box-sizing:border-box;"
      + "display:flex;flex-direction:column;gap:12px;overflow:hidden;";

    const title = document.createElement("div");
    title.textContent = "Settings";
    title.style.cssText = "font-size:1.1rem;font-weight:600;flex:0 0 auto;";
    box.appendChild(title);

    const body = document.createElement("div");
    body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;";
    box.appendChild(body);

    const rows = [];
    if (!settings.length) {
      const empty = document.createElement("div");
      empty.textContent = "Nothing to configure yet.";
      empty.style.cssText = "font-size:0.85rem;color:#888;font-style:italic;";
      body.appendChild(empty);
    } else {
      settings.forEach(def => {
        const built = buildRow(def);
        rows.push(built);
        body.appendChild(built.row);
      });
    }

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto;";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = "width:auto;margin:0;padding:8px 14px;background:#444;"
      + "color:#fff;border:none;border-radius:4px;font-size:0.9rem;";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.style.cssText = "width:auto;margin:0;padding:8px 14px;background:#007bff;"
      + "color:#fff;border:none;border-radius:4px;font-size:0.9rem;";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      // Validate everything before writing anything, so a bad value in row 3
      // can't leave rows 1 and 2 half-applied.
      const pending = rows.map(r => [r.def, r.input.value]);
      let firstBad = null;
      rows.forEach(r => { r.error.style.display = "none"; });

      for (const r of rows) {
        try {
          if (typeof r.def.validate === "function") r.def.validate(r.input.value);
        } catch (err) {
          r.error.textContent = err.message;
          r.error.style.display = "block";
          if (!firstBad) firstBad = r;
        }
      }
      if (firstBad) { firstBad.input.focus(); return; }

      for (const [def, value] of pending) {
        try {
          def.set(value);
        } catch (err) {
          // A setter that throws despite validate() passing - surface it
          // rather than closing on a change that didn't take.
          const r = rows.find(x => x.def === def);
          if (r) { r.error.textContent = err.message; r.error.style.display = "block"; r.input.focus(); }
          console.error(`[settings] "${def.id}" failed to save:`, err);
          return;
        }
      }
      close();
    });

    document.body.appendChild(overlay);
    const first = rows[0];
    if (first) { first.input.focus(); first.input.select(); }
  }

  window.scraySettings = { register, open, list: () => settings.map(s => s.id) };
})();

// ---- Setting 1: Picker URL -------------------------------------------------
window.scraySettings.register({
  id: "pickerUrl",
  label: "Picker URL",
  type: "url",
  hint: "Where the Picker buttons and the in-app browser's home button go.",
  get: () => window.scrayPickerUrl(),
  placeholder: () => window.SCRAY_SYNC.PICKER_URL,
  emptyMeans: "Leave blank to reset to the built-in default.",
  // Dry run, so Save can report the problem without half-applying anything.
  validate: (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;                       // blank = clear the override
    const parsed = new URL(trimmed);            // throws on nonsense
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Must be http or https");
  },
  set: (value) => { window.scraySetPickerUrl(value); }
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("settingsLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.scraySettings.open();
  });
});