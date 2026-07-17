/**
 * hub/wire.mjs — one place for the hub's "is this thing enabled?" wire parse.
 *
 * The Hearth downlink is deliberately forgiving about how on/off is expressed: the cloud device
 * shadow sends booleans, the LAN-direct `POST /camera` body may carry a boolean, a number, or a
 * string, and desiredForNode() serialises actuator state to the 'on'/'off' strings the ESP
 * firmware's own parser understands. Two hub call sites — `POST /camera` in hub.mjs and
 * camera.mjs's setPower() — both need to collapse those encodings to a boolean, and they used to
 * do it with two slightly different expressions, so a value like 0 or 'off' meant "off" in one and
 * "on" in the other. This is the single shared rule so they can't drift again.
 *
 * Wire protocol (kept in step with the firmware's actuator parser, which is owned separately):
 *   off  ← false, 0, '0', 'off', 'false', 'no', ''  (strings matched case-insensitively, trimmed)
 *   on   ← everything else, INCLUDING null/undefined (uncommanded ⇒ default on, least surprise)
 *
 * @param {unknown} value  the raw enabled/on value off the wire (or from the device shadow)
 * @returns {boolean}
 */
export function parseEnabled(value) {
  if (value == null) return true; // omitted / uncommanded ⇒ on
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return !(v === '' || v === '0' || v === 'off' || v === 'false' || v === 'no');
  }
  return true; // objects/arrays/etc. — a present, non-nullish command ⇒ on
}
