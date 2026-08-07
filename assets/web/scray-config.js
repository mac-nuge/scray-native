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