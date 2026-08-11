/**
 * Scray sync configuration. Same file in Native and Picker.
 * The API key is not a secret from you — it's a secret from the internet.
 * Anyone with the app bundle can read it, which is fine: the threat model
 * is "random person finds the endpoint", not "attacker has your phone".
 */
window.SCRAY_SYNC = {
  API_BASE: "https://macnguyen.com/scray/api.php",
  API_KEY:  "d0ae361fdf8759771caf2c989b1bfec07c3fb24b5c4d11433e01fbeae666d7cb",

  // Distinguishes rows in sync_log and drives conflict messages.
  DEVICE_ID: (() => {
    let d = localStorage.getItem("scray_device_id");
    if (!d) {
      const guess = /iPhone|iPad/.test(navigator.userAgent)
        ? (window.ScrayBridge ? "native-ios" : "safari-ios")
        : "desktop";
      d = `${guess}-${Math.random().toString(36).slice(2, 7)}`;
      localStorage.setItem("scray_device_id", d);
    }
    return d;
  })(),

  PING_TIMEOUT_MS: 4000,
  PUSH_BATCH_SIZE: 200,
  AUTO_SYNC_ON_RECONNECT: true,   // still prompts — this only controls the prompt firing
};

/**
 * The single definition of a video_key. Must match schema_v2 / the server byte
 * for byte.
 *
 * NFC first: iOS stores filenames decomposed (café = c a f e U+0301) while
 * Graph returns them composed (café = c a f é). Without this the same file
 * produces two different keys and Native never joins to the catalogue.
 */
window.scrayVideoKey = function (filename) {
  return String(filename || "").normalize("NFC").trim().toLowerCase();
};

/**
 * Filename-free fingerprint, so it survives a rename.
 *
 * Bitrate is deliberately excluded: Graph frequently returns null and
 * fetchVideoFacet backfills it afterwards, so it is not reliably present at
 * fingerprint time. Duration is rounded to whole seconds because container
 * remuxes drift by a few milliseconds.
 */
window.scrayFingerprint = function (v) {
  const size = v?.sizeBytes ?? v?.file_size_bytes ?? null;
  if (size == null) return null;              // worthless without the size anchor
  const dur = v?.durationMs ?? v?.duration_ms ?? null;
  const d = dur != null ? Math.round(dur / 1000) : "?";
  return `${size}:${d}:${v?.width ?? "?"}x${v?.height ?? "?"}`;
};