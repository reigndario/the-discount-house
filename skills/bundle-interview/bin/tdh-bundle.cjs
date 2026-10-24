"use strict";

// src/skill/cli.ts
var import_node_fs = require("node:fs");

// src/intent/types.ts
var ASKED_FIELDS = ["principal", "collateralAmount", "interestPercent", "durationDays"];
var BUNDLE_FIELDS = [...ASKED_FIELDS, "gracePeriodDays"];
function emptyDraft() {
  return { slots: {}, unresolved: [] };
}
function fieldSlot(field, bound) {
  return `${field}.${bound}`;
}
function splitFieldSlot(key) {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  return { field: key.slice(0, dot), bound: key.slice(dot + 1) };
}

// src/intent/parser.ts
var NUMBER_RE = "(\\$)?(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?(?:(k|m)\\b|\\s+(thousand|million)\\b)?(?:\\s*(%|(?:percent|pct|apr|usdc|cusdc|usd|dollars?|days?|weeks?|months?|years?|yrs?|tokens?)\\b))?";
var DAY_FACTORS = [
  [/^days?$/, 1],
  [/^weeks?$/, 7],
  [/^months?$/, 30],
  [/^(years?|yrs?)$/, 365]
];
var round = (n2) => Math.round(n2 * 1e6) / 1e6;
function buildQuantity(m, offset) {
  const [text, dollar, whole, fraction, suffix, word, unitWord] = m;
  let raw = Number(whole.replace(/,/g, "") + (fraction ?? ""));
  const mult = (suffix ?? word ?? "").toLowerCase();
  if (mult === "k" || mult === "thousand") raw *= 1e3;
  if (mult === "m" || mult === "million") raw *= 1e6;
  raw = round(raw);
  let unit = null;
  let unitFactor = 1;
  const u = (unitWord ?? "").toLowerCase();
  if (u === "%" || /^(percent|pct|apr)$/.test(u)) unit = "percent";
  else if (/^(usdc|cusdc|usd|dollars?)$/.test(u)) unit = "currency";
  else if (/^tokens?$/.test(u)) unit = "tokens";
  else if (u) {
    unit = "days";
    unitFactor = DAY_FACTORS.find(([re]) => re.test(u))?.[1] ?? 1;
  }
  if (dollar && unit === null) unit = "currency";
  const start = (m.index ?? 0) + offset;
  return { raw, value: round(raw * unitFactor), unitFactor, unit, span: { start, end: start + text.length, text } };
}
function parseQuantity(text) {
  const m = new RegExp(NUMBER_RE, "i").exec(text);
  return m ? buildQuantity(m, 0) : null;
}
function findQuantities(text) {
  const out = [];
  for (const m of text.matchAll(new RegExp(NUMBER_RE, "gi"))) out.push(buildQuantity(m, 0));
  return out;
}
var BOUND_WORDS = [
  ["max", /\b(?:at most|up to|no more than|not more than|less than|under|below|maximum|max|capped at)\b/gi],
  ["min", /\b(?:at least|no less than|not less than|more than|over|above|minimum|min)\b/gi],
  ["target", /\b(?:about|around|roughly|approximately|approx|near|ideally|targeting|target|aim(?:ing)? for)\b|~/gi]
];
function boundBefore(prefix) {
  let best = null;
  for (const [bound, re] of BOUND_WORDS) {
    for (const m of prefix.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length;
      const gap = prefix.slice(end);
      if (gap.length <= 20 && !/[\d.,;!?]/.test(gap) && (!best || end > best.end)) best = { bound, end };
    }
  }
  return best?.bound ?? null;
}
var UNIT_FIELD = {
  percent: "interestPercent",
  currency: "principal",
  tokens: "collateralAmount",
  days: "durationDays"
};
var RANGE_JOINER = /^\s*(?:-|–|—|to|and|through)\s*$/i;
function groupQuantities(text, quantities) {
  const groups = [];
  for (let i = 0; i < quantities.length; i++) {
    const a = quantities[i];
    const b2 = quantities[i + 1];
    if (b2 && RANGE_JOINER.test(text.slice(a.span.end, b2.span.start)) && (!a.unit || !b2.unit || a.unit === b2.unit)) {
      groups.push({ quantities: [a, b2] });
      i++;
    } else {
      groups.push({ quantities: [a] });
    }
  }
  return groups;
}
function parseSide(text) {
  const hits = [];
  const add = (re, side) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      hits.push({
        slot: "side",
        value: side,
        span: { start, end: start + m[0].length, text: m[0] },
        unitFactor: 1
      });
    }
  };
  add(/\b(?:borrow(?:er|ing|s)?|loan against|pledge)\b/gi, "borrower");
  add(/\b(?:lend(?:er|ing|s)?|earn yield)\b/gi, "lender");
  return hits;
}
var SIDE_WORDS = {
  borrower: /^(?:borrow(?:er|ing|s)?|loan against|pledge)$/i,
  lender: /^(?:lend(?:er|ing|s)?|earn yield)$/i
};
var INTENT_WORDS = {
  atp_deposit: /^deposit$/i,
  atp_withdraw: /^withdraw(?:al)?$/i
};
function parseIntent(text) {
  const hits = [];
  const add = (re, value) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      hits.push({ slot: "intent", value, span: { start, end: start + m[0].length, text: m[0] }, unitFactor: 1 });
    }
  };
  add(/\bdeposit\b/gi, "atp_deposit");
  add(/\bwithdraw(?:al)?\b/gi, "atp_withdraw");
  return hits;
}
function settleSingle(hits, reason) {
  if (new Set(hits.map((h) => h.value)).size > 1) return hits.map((h) => ({ ...h, slot: null, reason }));
  return hits.slice(0, 1);
}
function extract(text, context = {}) {
  const out = [];
  out.push(...settleSingle(parseSide(text), "ambiguous_side"));
  const intentHits = settleSingle(parseIntent(text), "ambiguous_intent");
  out.push(...intentHits);
  const intent = intentHits.length === 1 && intentHits[0].slot === "intent" ? intentHits[0].value : context.intent;
  const atp = intent === "atp_deposit" || intent === "atp_withdraw";
  const expect = context.expecting ? splitFieldSlot(context.expecting) : null;
  const quantities = findQuantities(text);
  let prevEnd = 0;
  for (const group of groupQuantities(text, quantities)) {
    const first = group.quantities[0];
    const last = group.quantities[group.quantities.length - 1];
    const prefix = text.slice(Math.max(prevEnd, first.span.start - 30), first.span.start);
    prevEnd = last.span.end;
    const unit = group.quantities.find((q) => q.unit)?.unit ?? null;
    const factor = group.quantities.find((q) => q.unit)?.unitFactor ?? 1;
    const keyword = boundBefore(prefix);
    let field = unit ? UNIT_FIELD[unit] : null;
    if (field === "durationDays" && /grace/i.test(text.slice(Math.max(0, first.span.start - 40), last.span.end + 20))) {
      field = "gracePeriodDays";
    }
    if (atp && (unit === null || unit === "currency")) field = "amount";
    if (field === null && expect) field = expect.field;
    if (field === null && context.expecting === "amount") field = "amount";
    const bounds = group.quantities.length === 2 ? ["min", "max"] : [keyword ?? (expect && field === expect.field ? expect.bound : "target")];
    group.quantities.forEach((q, i) => {
      const value = round(q.raw * factor);
      const base = { value, span: q.span, unitFactor: factor };
      if (field === "amount") {
        out.push({ slot: "amount", ...base });
      } else if (field === null) {
        out.push({ slot: null, reason: "unknown_field", bound: bounds[i], ...base });
      } else {
        out.push({ slot: fieldSlot(field, bounds[i]), ...base });
      }
    });
  }
  return markConflicts(out);
}
function markConflicts(candidates) {
  const bySlot = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    if (c.slot) bySlot.set(c.slot, (bySlot.get(c.slot) ?? /* @__PURE__ */ new Set()).add(c.value));
  }
  const seen = /* @__PURE__ */ new Set();
  return candidates.flatMap((c) => {
    if (!c.slot) return [c];
    if ((bySlot.get(c.slot)?.size ?? 0) > 1) return [{ ...c, slot: null, reason: "conflict" }];
    if (seen.has(c.slot)) return [];
    seen.add(c.slot);
    return [c];
  });
}

// src/intent/verify.ts
var FACTOR_WORDS = {
  7: /^\s*weeks?\b/i,
  30: /^\s*months?\b/i,
  365: /^\s*(?:years?|yrs?)\b/i
};
function verifySpan(text, candidate) {
  const { span } = candidate;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > text.length) {
    return { ok: false, reason: "span is outside the text" };
  }
  if (text.slice(span.start, span.end) !== span.text) return { ok: false, reason: "span does not match the text" };
  if (candidate.slot === "side" || candidate.reason === "ambiguous_side") {
    return SIDE_WORDS[candidate.value]?.test(span.text) ? { ok: true } : { ok: false, reason: "span is not a side keyword" };
  }
  if (candidate.slot === "intent" || candidate.reason === "ambiguous_intent") {
    const re = INTENT_WORDS[candidate.value];
    return re?.test(span.text) ? { ok: true } : { ok: false, reason: "span is not an intent keyword" };
  }
  if (typeof candidate.value !== "number") return { ok: false, reason: "expected a number" };
  const quantity = parseQuantity(span.text);
  if (!quantity || quantity.span.text !== span.text) return { ok: false, reason: "span is not a single number" };
  const factor = quantity.unit === "days" ? quantity.unitFactor : candidate.unitFactor;
  if (factor !== 1) {
    const tail = text.slice(span.end, span.end + 12);
    const unitInSpan = quantity.unit === "days" && quantity.unitFactor === factor;
    if (!unitInSpan && !FACTOR_WORDS[factor]?.test(tail) && !/^\s*(?:-|–|to|and)\s*\d/.test(tail)) {
      return { ok: false, reason: "no unit word in the text justifies the conversion" };
    }
  }
  if (Math.abs(quantity.raw * factor - candidate.value) > 1e-6) {
    return { ok: false, reason: "value does not match the cited text" };
  }
  if (candidate.slot && candidate.slot !== "amount") {
    const parts = splitFieldSlot(candidate.slot);
    if (!parts) return { ok: false, reason: "unknown slot" };
  }
  return { ok: true };
}
function verifyAll(text, candidates) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    const check = verifySpan(text, candidate);
    if (check.ok) accepted.push(candidate);
    else rejected.push({ candidate, reason: check.reason });
  }
  return { accepted, rejected };
}

// node_modules/ethers/lib.esm/_version.js
var version = "6.16.0";

// node_modules/ethers/lib.esm/utils/properties.js
function checkType(value, type, name) {
  const types = type.split("|").map((t) => t.trim());
  for (let i = 0; i < types.length; i++) {
    switch (type) {
      case "any":
        return;
      case "bigint":
      case "boolean":
      case "number":
      case "string":
        if (typeof value === type) {
          return;
        }
    }
  }
  const error = new Error(`invalid value for type ${type}`);
  error.code = "INVALID_ARGUMENT";
  error.argument = `value.${name}`;
  error.value = value;
  throw error;
}
function defineProperties(target, values, types) {
  for (let key in values) {
    let value = values[key];
    const type = types ? types[key] : null;
    if (type) {
      checkType(value, type, key);
    }
    Object.defineProperty(target, key, { enumerable: true, value, writable: false });
  }
}

// node_modules/ethers/lib.esm/utils/errors.js
function stringify(value, seen) {
  if (value == null) {
    return "null";
  }
  if (seen == null) {
    seen = /* @__PURE__ */ new Set();
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
  }
  if (Array.isArray(value)) {
    return "[ " + value.map((v) => stringify(v, seen)).join(", ") + " ]";
  }
  if (value instanceof Uint8Array) {
    const HEX = "0123456789abcdef";
    let result = "0x";
    for (let i = 0; i < value.length; i++) {
      result += HEX[value[i] >> 4];
      result += HEX[value[i] & 15];
    }
    return result;
  }
  if (typeof value === "object" && typeof value.toJSON === "function") {
    return stringify(value.toJSON(), seen);
  }
  switch (typeof value) {
    case "boolean":
    case "number":
    case "symbol":
      return value.toString();
    case "bigint":
      return BigInt(value).toString();
    case "string":
      return JSON.stringify(value);
    case "object": {
      const keys = Object.keys(value);
      keys.sort();
      return "{ " + keys.map((k) => `${stringify(k, seen)}: ${stringify(value[k], seen)}`).join(", ") + " }";
    }
  }
  return `[ COULD NOT SERIALIZE ]`;
}
function isError(error, code2) {
  return error && error.code === code2;
}
function makeError(message, code2, info) {
  let shortMessage = message;
  {
    const details = [];
    if (info) {
      if ("message" in info || "code" in info || "name" in info) {
        throw new Error(`value will overwrite populated values: ${stringify(info)}`);
      }
      for (const key in info) {
        if (key === "shortMessage") {
          continue;
        }
        const value = info[key];
        details.push(key + "=" + stringify(value));
      }
    }
    details.push(`code=${code2}`);
    details.push(`version=${version}`);
    if (details.length) {
      message += " (" + details.join(", ") + ")";
    }
  }
  let error;
  switch (code2) {
    case "INVALID_ARGUMENT":
      error = new TypeError(message);
      break;
    case "NUMERIC_FAULT":
    case "BUFFER_OVERRUN":
      error = new RangeError(message);
      break;
    default:
      error = new Error(message);
  }
  defineProperties(error, { code: code2 });
  if (info) {
    Object.assign(error, info);
  }
  if (error.shortMessage == null) {
    defineProperties(error, { shortMessage });
  }
  return error;
}
function assert(check, message, code2, info) {
  if (!check) {
    throw makeError(message, code2, info);
  }
}
function assertArgument(check, message, name, value) {
  assert(check, message, "INVALID_ARGUMENT", { argument: name, value });
}
function assertArgumentCount(count, expectedCount, message) {
  if (message == null) {
    message = "";
  }
  if (message) {
    message = ": " + message;
  }
  assert(count >= expectedCount, "missing argument" + message, "MISSING_ARGUMENT", {
    count,
    expectedCount
  });
  assert(count <= expectedCount, "too many arguments" + message, "UNEXPECTED_ARGUMENT", {
    count,
    expectedCount
  });
}
var _normalizeForms = ["NFD", "NFC", "NFKD", "NFKC"].reduce((accum, form) => {
  try {
    if ("test".normalize(form) !== "test") {
      throw new Error("bad");
    }
    ;
    if (form === "NFD") {
      const check = String.fromCharCode(233).normalize("NFD");
      const expected = String.fromCharCode(101, 769);
      if (check !== expected) {
        throw new Error("broken");
      }
    }
    accum.push(form);
  } catch (error) {
  }
  return accum;
}, []);
function assertNormalize(form) {
  assert(_normalizeForms.indexOf(form) >= 0, "platform missing String.prototype.normalize", "UNSUPPORTED_OPERATION", {
    operation: "String.prototype.normalize",
    info: { form }
  });
}
function assertPrivate(givenGuard, guard, className) {
  if (className == null) {
    className = "";
  }
  if (givenGuard !== guard) {
    let method = className, operation = "new";
    if (className) {
      method += ".";
      operation += " " + className;
    }
    assert(false, `private constructor; use ${method}from* methods`, "UNSUPPORTED_OPERATION", {
      operation
    });
  }
}

// node_modules/ethers/lib.esm/utils/data.js
function _getBytes(value, name, copy) {
  if (value instanceof Uint8Array) {
    if (copy) {
      return new Uint8Array(value);
    }
    return value;
  }
  if (typeof value === "string" && value.length % 2 === 0 && value.match(/^0x[0-9a-f]*$/i)) {
    const result = new Uint8Array((value.length - 2) / 2);
    let offset = 2;
    for (let i = 0; i < result.length; i++) {
      result[i] = parseInt(value.substring(offset, offset + 2), 16);
      offset += 2;
    }
    return result;
  }
  assertArgument(false, "invalid BytesLike value", name || "value", value);
}
function getBytes(value, name) {
  return _getBytes(value, name, false);
}
function getBytesCopy(value, name) {
  return _getBytes(value, name, true);
}
function isHexString(value, length) {
  if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
    return false;
  }
  if (typeof length === "number" && value.length !== 2 + 2 * length) {
    return false;
  }
  if (length === true && value.length % 2 !== 0) {
    return false;
  }
  return true;
}
var HexCharacters = "0123456789abcdef";
function hexlify(data) {
  const bytes2 = getBytes(data);
  let result = "0x";
  for (let i = 0; i < bytes2.length; i++) {
    const v = bytes2[i];
    result += HexCharacters[(v & 240) >> 4] + HexCharacters[v & 15];
  }
  return result;
}
function concat(datas) {
  return "0x" + datas.map((d) => hexlify(d).substring(2)).join("");
}

// node_modules/ethers/lib.esm/utils/maths.js
var BN_0 = BigInt(0);
var BN_1 = BigInt(1);
var maxValue = 9007199254740991;
function fromTwos(_value, _width) {
  const value = getUint(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  assert(value >> width === BN_0, "overflow", "NUMERIC_FAULT", {
    operation: "fromTwos",
    fault: "overflow",
    value: _value
  });
  if (value >> width - BN_1) {
    const mask2 = (BN_1 << width) - BN_1;
    return -((~value & mask2) + BN_1);
  }
  return value;
}
function toTwos(_value, _width) {
  let value = getBigInt(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  const limit = BN_1 << width - BN_1;
  if (value < BN_0) {
    value = -value;
    assert(value <= limit, "too low", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
    const mask2 = (BN_1 << width) - BN_1;
    return (~value & mask2) + BN_1;
  } else {
    assert(value < limit, "too high", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
  }
  return value;
}
function mask(_value, _bits) {
  const value = getUint(_value, "value");
  const bits = BigInt(getNumber(_bits, "bits"));
  return value & (BN_1 << bits) - BN_1;
}
function getBigInt(value, name) {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return BigInt(value);
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        if (value[0] === "-" && value[1] !== "-") {
          return -BigInt(value.substring(1));
        }
        return BigInt(value);
      } catch (e) {
        assertArgument(false, `invalid BigNumberish string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid BigNumberish value", name || "value", value);
}
function getUint(value, name) {
  const result = getBigInt(value, name);
  assert(result >= BN_0, "unsigned value cannot be negative", "NUMERIC_FAULT", {
    fault: "overflow",
    operation: "getUint",
    value
  });
  return result;
}
var Nibbles = "0123456789abcdef";
function toBigInt(value) {
  if (value instanceof Uint8Array) {
    let result = "0x0";
    for (const v of value) {
      result += Nibbles[v >> 4];
      result += Nibbles[v & 15];
    }
    return BigInt(result);
  }
  return getBigInt(value);
}
function getNumber(value, name) {
  switch (typeof value) {
    case "bigint":
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return Number(value);
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return value;
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        return getNumber(BigInt(value), name);
      } catch (e) {
        assertArgument(false, `invalid numeric string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid numeric value", name || "value", value);
}
function toNumber(value) {
  return getNumber(toBigInt(value));
}
function toBeHex(_value, _width) {
  const value = getUint(_value, "value");
  let result = value.toString(16);
  if (_width == null) {
    if (result.length % 2) {
      result = "0" + result;
    }
  } else {
    const width = getNumber(_width, "width");
    if (width === 0 && value === BN_0) {
      return "0x";
    }
    assert(width * 2 >= result.length, `value exceeds width (${width} bytes)`, "NUMERIC_FAULT", {
      operation: "toBeHex",
      fault: "overflow",
      value: _value
    });
    while (result.length < width * 2) {
      result = "0" + result;
    }
  }
  return "0x" + result;
}
function toBeArray(_value, _width) {
  const value = getUint(_value, "value");
  if (value === BN_0) {
    const width = _width != null ? getNumber(_width, "width") : 0;
    return new Uint8Array(width);
  }
  let hex = value.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  if (_width != null) {
    const width = getNumber(_width, "width");
    while (hex.length < width * 2) {
      hex = "00" + hex;
    }
    assert(width * 2 === hex.length, `value exceeds width (${width} bytes)`, "NUMERIC_FAULT", {
      operation: "toBeArray",
      fault: "overflow",
      value: _value
    });
  }
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < result.length; i++) {
    const offset = i * 2;
    result[i] = parseInt(hex.substring(offset, offset + 2), 16);
  }
  return result;
}

// node_modules/ethers/lib.esm/utils/utf8.js
function errorFunc(reason, offset, bytes2, output3, badCodepoint) {
  assertArgument(false, `invalid codepoint at offset ${offset}; ${reason}`, "bytes", bytes2);
}
function ignoreFunc(reason, offset, bytes2, output3, badCodepoint) {
  if (reason === "BAD_PREFIX" || reason === "UNEXPECTED_CONTINUE") {
    let i = 0;
    for (let o = offset + 1; o < bytes2.length; o++) {
      if (bytes2[o] >> 6 !== 2) {
        break;
      }
      i++;
    }
    return i;
  }
  if (reason === "OVERRUN") {
    return bytes2.length - offset - 1;
  }
  return 0;
}
function replaceFunc(reason, offset, bytes2, output3, badCodepoint) {
  if (reason === "OVERLONG") {
    assertArgument(typeof badCodepoint === "number", "invalid bad code point for replacement", "badCodepoint", badCodepoint);
    output3.push(badCodepoint);
    return 0;
  }
  output3.push(65533);
  return ignoreFunc(reason, offset, bytes2, output3, badCodepoint);
}
var Utf8ErrorFuncs = Object.freeze({
  error: errorFunc,
  ignore: ignoreFunc,
  replace: replaceFunc
});
function getUtf8CodePoints(_bytes, onError) {
  if (onError == null) {
    onError = Utf8ErrorFuncs.error;
  }
  const bytes2 = getBytes(_bytes, "bytes");
  const result = [];
  let i = 0;
  while (i < bytes2.length) {
    const c = bytes2[i++];
    if (c >> 7 === 0) {
      result.push(c);
      continue;
    }
    let extraLength = null;
    let overlongMask = null;
    if ((c & 224) === 192) {
      extraLength = 1;
      overlongMask = 127;
    } else if ((c & 240) === 224) {
      extraLength = 2;
      overlongMask = 2047;
    } else if ((c & 248) === 240) {
      extraLength = 3;
      overlongMask = 65535;
    } else {
      if ((c & 192) === 128) {
        i += onError("UNEXPECTED_CONTINUE", i - 1, bytes2, result);
      } else {
        i += onError("BAD_PREFIX", i - 1, bytes2, result);
      }
      continue;
    }
    if (i - 1 + extraLength >= bytes2.length) {
      i += onError("OVERRUN", i - 1, bytes2, result);
      continue;
    }
    let res = c & (1 << 8 - extraLength - 1) - 1;
    for (let j = 0; j < extraLength; j++) {
      let nextChar = bytes2[i];
      if ((nextChar & 192) != 128) {
        i += onError("MISSING_CONTINUE", i, bytes2, result);
        res = null;
        break;
      }
      ;
      res = res << 6 | nextChar & 63;
      i++;
    }
    if (res === null) {
      continue;
    }
    if (res > 1114111) {
      i += onError("OUT_OF_RANGE", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    if (res >= 55296 && res <= 57343) {
      i += onError("UTF16_SURROGATE", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    if (res <= overlongMask) {
      i += onError("OVERLONG", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    result.push(res);
  }
  return result;
}
function toUtf8Bytes(str, form) {
  assertArgument(typeof str === "string", "invalid string value", "str", str);
  if (form != null) {
    assertNormalize(form);
    str = str.normalize(form);
  }
  let result = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      result.push(c);
    } else if (c < 2048) {
      result.push(c >> 6 | 192);
      result.push(c & 63 | 128);
    } else if ((c & 64512) == 55296) {
      i++;
      const c2 = str.charCodeAt(i);
      assertArgument(i < str.length && (c2 & 64512) === 56320, "invalid surrogate pair", "str", str);
      const pair = 65536 + ((c & 1023) << 10) + (c2 & 1023);
      result.push(pair >> 18 | 240);
      result.push(pair >> 12 & 63 | 128);
      result.push(pair >> 6 & 63 | 128);
      result.push(pair & 63 | 128);
    } else {
      result.push(c >> 12 | 224);
      result.push(c >> 6 & 63 | 128);
      result.push(c & 63 | 128);
    }
  }
  return new Uint8Array(result);
}
function _toUtf8String(codePoints) {
  return codePoints.map((codePoint) => {
    if (codePoint <= 65535) {
      return String.fromCharCode(codePoint);
    }
    codePoint -= 65536;
    return String.fromCharCode((codePoint >> 10 & 1023) + 55296, (codePoint & 1023) + 56320);
  }).join("");
}
function toUtf8String(bytes2, onError) {
  return _toUtf8String(getUtf8CodePoints(bytes2, onError));
}

// node_modules/ethers/lib.esm/abi/coders/abstract-coder.js
var WordSize = 32;
var Padding = new Uint8Array(WordSize);
var passProperties = ["then"];
var _guard = {};
var resultNames = /* @__PURE__ */ new WeakMap();
function getNames(result) {
  return resultNames.get(result);
}
function setNames(result, names) {
  resultNames.set(result, names);
}
function throwError(name, error) {
  const wrapped = new Error(`deferred error during ABI decoding triggered accessing ${name}`);
  wrapped.error = error;
  throw wrapped;
}
function toObject(names, items, deep) {
  if (names.indexOf(null) >= 0) {
    return items.map((item, index) => {
      if (item instanceof Result) {
        return toObject(getNames(item), item, deep);
      }
      return item;
    });
  }
  return names.reduce((accum, name, index) => {
    let item = items.getValue(name);
    if (!(name in accum)) {
      if (deep && item instanceof Result) {
        item = toObject(getNames(item), item, deep);
      }
      accum[name] = item;
    }
    return accum;
  }, {});
}
var Result = class _Result extends Array {
  // No longer used; but cannot be removed as it will remove the
  // #private field from the .d.ts which may break backwards
  // compatibility
  #names;
  /**
   *  @private
   */
  constructor(...args) {
    const guard = args[0];
    let items = args[1];
    let names = (args[2] || []).slice();
    let wrap = true;
    if (guard !== _guard) {
      items = args;
      names = [];
      wrap = false;
    }
    super(items.length);
    items.forEach((item, index) => {
      this[index] = item;
    });
    const nameCounts = names.reduce((accum, name) => {
      if (typeof name === "string") {
        accum.set(name, (accum.get(name) || 0) + 1);
      }
      return accum;
    }, /* @__PURE__ */ new Map());
    setNames(this, Object.freeze(items.map((item, index) => {
      const name = names[index];
      if (name != null && nameCounts.get(name) === 1) {
        return name;
      }
      return null;
    })));
    this.#names = [];
    if (this.#names == null) {
      void this.#names;
    }
    if (!wrap) {
      return;
    }
    Object.freeze(this);
    const proxy = new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string") {
          if (prop.match(/^[0-9]+$/)) {
            const index = getNumber(prop, "%index");
            if (index < 0 || index >= this.length) {
              throw new RangeError("out of result range");
            }
            const item = target[index];
            if (item instanceof Error) {
              throwError(`index ${index}`, item);
            }
            return item;
          }
          if (passProperties.indexOf(prop) >= 0) {
            return Reflect.get(target, prop, receiver);
          }
          const value = target[prop];
          if (value instanceof Function) {
            return function(...args2) {
              return value.apply(this === receiver ? target : this, args2);
            };
          } else if (!(prop in target)) {
            return target.getValue.apply(this === receiver ? target : this, [prop]);
          }
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    setNames(proxy, getNames(this));
    return proxy;
  }
  /**
   *  Returns the Result as a normal Array. If %%deep%%, any children
   *  which are Result objects are also converted to a normal Array.
   *
   *  This will throw if there are any outstanding deferred
   *  errors.
   */
  toArray(deep) {
    const result = [];
    this.forEach((item, index) => {
      if (item instanceof Error) {
        throwError(`index ${index}`, item);
      }
      if (deep && item instanceof _Result) {
        item = item.toArray(deep);
      }
      result.push(item);
    });
    return result;
  }
  /**
   *  Returns the Result as an Object with each name-value pair. If
   *  %%deep%%, any children which are Result objects are also
   *  converted to an Object.
   *
   *  This will throw if any value is unnamed, or if there are
   *  any outstanding deferred errors.
   */
  toObject(deep) {
    const names = getNames(this);
    return names.reduce((accum, name, index) => {
      assert(name != null, `value at index ${index} unnamed`, "UNSUPPORTED_OPERATION", {
        operation: "toObject()"
      });
      return toObject(names, this, deep);
    }, {});
  }
  /**
   *  @_ignore
   */
  slice(start, end) {
    if (start == null) {
      start = 0;
    }
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end == null) {
      end = this.length;
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    const _names = getNames(this);
    const result = [], names = [];
    for (let i = start; i < end; i++) {
      result.push(this[i]);
      names.push(_names[i]);
    }
    return new _Result(_guard, result, names);
  }
  /**
   *  @_ignore
   */
  filter(callback, thisArg) {
    const _names = getNames(this);
    const result = [], names = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      if (callback.call(thisArg, item, i, this)) {
        result.push(item);
        names.push(_names[i]);
      }
    }
    return new _Result(_guard, result, names);
  }
  /**
   *  @_ignore
   */
  map(callback, thisArg) {
    const result = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      result.push(callback.call(thisArg, item, i, this));
    }
    return result;
  }
  /**
   *  Returns the value for %%name%%.
   *
   *  Since it is possible to have a key whose name conflicts with
   *  a method on a [[Result]] or its superclass Array, or any
   *  JavaScript keyword, this ensures all named values are still
   *  accessible by name.
   */
  getValue(name) {
    const index = getNames(this).indexOf(name);
    if (index === -1) {
      return void 0;
    }
    const value = this[index];
    if (value instanceof Error) {
      throwError(`property ${JSON.stringify(name)}`, value.error);
    }
    return value;
  }
  /**
   *  Creates a new [[Result]] for %%items%% with each entry
   *  also accessible by its corresponding name in %%keys%%.
   */
  static fromItems(items, keys) {
    return new _Result(_guard, items, keys);
  }
};
function getValue(value) {
  let bytes2 = toBeArray(value);
  assert(bytes2.length <= WordSize, "value out-of-bounds", "BUFFER_OVERRUN", { buffer: bytes2, length: WordSize, offset: bytes2.length });
  if (bytes2.length !== WordSize) {
    bytes2 = getBytesCopy(concat([Padding.slice(bytes2.length % WordSize), bytes2]));
  }
  return bytes2;
}
var Coder = class {
  // The coder name:
  //   - address, uint256, tuple, array, etc.
  name;
  // The fully expanded type, including composite types:
  //   - address, uint256, tuple(address,bytes), uint256[3][4][],  etc.
  type;
  // The localName bound in the signature, in this example it is "baz":
  //   - tuple(address foo, uint bar) baz
  localName;
  // Whether this type is dynamic:
  //  - Dynamic: bytes, string, address[], tuple(boolean[]), etc.
  //  - Not Dynamic: address, uint256, boolean[3], tuple(address, uint8)
  dynamic;
  constructor(name, type, localName, dynamic) {
    defineProperties(this, { name, type, localName, dynamic }, {
      name: "string",
      type: "string",
      localName: "string",
      dynamic: "boolean"
    });
  }
  _throwError(message, value) {
    assertArgument(false, message, this.localName, value);
  }
};
var Writer = class {
  // An array of WordSize lengthed objects to concatenation
  #data;
  #dataLength;
  constructor() {
    this.#data = [];
    this.#dataLength = 0;
  }
  get data() {
    return concat(this.#data);
  }
  get length() {
    return this.#dataLength;
  }
  #writeData(data) {
    this.#data.push(data);
    this.#dataLength += data.length;
    return data.length;
  }
  appendWriter(writer) {
    return this.#writeData(getBytesCopy(writer.data));
  }
  // Arrayish item; pad on the right to *nearest* WordSize
  writeBytes(value) {
    let bytes2 = getBytesCopy(value);
    const paddingOffset = bytes2.length % WordSize;
    if (paddingOffset) {
      bytes2 = getBytesCopy(concat([bytes2, Padding.slice(paddingOffset)]));
    }
    return this.#writeData(bytes2);
  }
  // Numeric item; pad on the left *to* WordSize
  writeValue(value) {
    return this.#writeData(getValue(value));
  }
  // Inserts a numeric place-holder, returning a callback that can
  // be used to asjust the value later
  writeUpdatableValue() {
    const offset = this.#data.length;
    this.#data.push(Padding);
    this.#dataLength += WordSize;
    return (value) => {
      this.#data[offset] = getValue(value);
    };
  }
};
var Reader = class _Reader {
  // Allows incomplete unpadded data to be read; otherwise an error
  // is raised if attempting to overrun the buffer. This is required
  // to deal with an old Solidity bug, in which event data for
  // external (not public thoguh) was tightly packed.
  allowLoose;
  #data;
  #offset;
  #bytesRead;
  #parent;
  #maxInflation;
  constructor(data, allowLoose, maxInflation) {
    defineProperties(this, { allowLoose: !!allowLoose });
    this.#data = getBytesCopy(data);
    this.#bytesRead = 0;
    this.#parent = null;
    this.#maxInflation = maxInflation != null ? maxInflation : 1024;
    this.#offset = 0;
  }
  get data() {
    return hexlify(this.#data);
  }
  get dataLength() {
    return this.#data.length;
  }
  get consumed() {
    return this.#offset;
  }
  get bytes() {
    return new Uint8Array(this.#data);
  }
  #incrementBytesRead(count) {
    if (this.#parent) {
      return this.#parent.#incrementBytesRead(count);
    }
    this.#bytesRead += count;
    assert(this.#maxInflation < 1 || this.#bytesRead <= this.#maxInflation * this.dataLength, `compressed ABI data exceeds inflation ratio of ${this.#maxInflation} ( see: https://github.com/ethers-io/ethers.js/issues/4537 )`, "BUFFER_OVERRUN", {
      buffer: getBytesCopy(this.#data),
      offset: this.#offset,
      length: count,
      info: {
        bytesRead: this.#bytesRead,
        dataLength: this.dataLength
      }
    });
  }
  #peekBytes(offset, length, loose) {
    let alignedLength = Math.ceil(length / WordSize) * WordSize;
    if (this.#offset + alignedLength > this.#data.length) {
      if (this.allowLoose && loose && this.#offset + length <= this.#data.length) {
        alignedLength = length;
      } else {
        assert(false, "data out-of-bounds", "BUFFER_OVERRUN", {
          buffer: getBytesCopy(this.#data),
          length: this.#data.length,
          offset: this.#offset + alignedLength
        });
      }
    }
    return this.#data.slice(this.#offset, this.#offset + alignedLength);
  }
  // Create a sub-reader with the same underlying data, but offset
  subReader(offset) {
    const reader = new _Reader(this.#data.slice(this.#offset + offset), this.allowLoose, this.#maxInflation);
    reader.#parent = this;
    return reader;
  }
  // Read bytes
  readBytes(length, loose) {
    let bytes2 = this.#peekBytes(0, length, !!loose);
    this.#incrementBytesRead(length);
    this.#offset += bytes2.length;
    return bytes2.slice(0, length);
  }
  // Read a numeric values
  readValue() {
    return toBigInt(this.readBytes(WordSize));
  }
  readIndex() {
    return toNumber(this.readBytes(WordSize));
  }
};

// node_modules/@noble/hashes/esm/_assert.js
function number(n2) {
  if (!Number.isSafeInteger(n2) || n2 < 0)
    throw new Error(`Wrong positive integer: ${n2}`);
}
function bytes(b2, ...lengths) {
  if (!(b2 instanceof Uint8Array))
    throw new Error("Expected Uint8Array");
  if (lengths.length > 0 && !lengths.includes(b2.length))
    throw new Error(`Expected Uint8Array of length ${lengths}, not of length=${b2.length}`);
}
function exists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function output(out, instance) {
  bytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error(`digestInto() expects output buffer of length at least ${min}`);
  }
}

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n2, le = false) {
  if (le)
    return { h: Number(n2 & U32_MASK64), l: Number(n2 >> _32n & U32_MASK64) };
  return { h: Number(n2 >> _32n & U32_MASK64) | 0, l: Number(n2 & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/@noble/hashes/esm/utils.js
var u8a = (a) => a instanceof Uint8Array;
var u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
if (!isLE)
  throw new Error("Non little-endian hardware is not supported");
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error(`utf8ToBytes expected string, got ${typeof str}`);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  if (!u8a(data))
    throw new Error(`expected Uint8Array, got ${typeof data}`);
  return data;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
var toStr = {}.toString;
function wrapConstructor(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/@noble/hashes/esm/sha3.js
var [SHA3_PI, SHA3_ROTL, _SHA3_IOTA] = [[], [], []];
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _7n = /* @__PURE__ */ BigInt(7);
var _256n = /* @__PURE__ */ BigInt(256);
var _0x71n = /* @__PURE__ */ BigInt(113);
for (let round2 = 0, R = _1n, x = 1, y = 0; round2 < 24; round2++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round2 + 1) * (round2 + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n)
      t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var [SHA3_IOTA_H, SHA3_IOTA_L] = /* @__PURE__ */ split(_SHA3_IOTA, true);
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round2 = 24 - rounds; round2 < 24; round2++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round2];
    s[1] ^= SHA3_IOTA_L[round2];
  }
  B.fill(0);
}
var Keccak = class _Keccak extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    number(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  keccak() {
    keccakP(this.state32, this.rounds);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    exists(this);
    const { blockLen, state } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    exists(this, false);
    bytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes2) {
    number(bytes2);
    return this.xofInto(new Uint8Array(bytes2));
  }
  digestInto(out) {
    output(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => wrapConstructor(() => new Keccak(blockLen, suffix, outputLen));
var sha3_224 = /* @__PURE__ */ gen(6, 144, 224 / 8);
var sha3_256 = /* @__PURE__ */ gen(6, 136, 256 / 8);
var sha3_384 = /* @__PURE__ */ gen(6, 104, 384 / 8);
var sha3_512 = /* @__PURE__ */ gen(6, 72, 512 / 8);
var keccak_224 = /* @__PURE__ */ gen(1, 144, 224 / 8);
var keccak_256 = /* @__PURE__ */ gen(1, 136, 256 / 8);
var keccak_384 = /* @__PURE__ */ gen(1, 104, 384 / 8);
var keccak_512 = /* @__PURE__ */ gen(1, 72, 512 / 8);
var genShake = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake128 = /* @__PURE__ */ genShake(31, 168, 128 / 8);
var shake256 = /* @__PURE__ */ genShake(31, 136, 256 / 8);

// node_modules/ethers/lib.esm/crypto/keccak.js
var locked = false;
var _keccak256 = function(data) {
  return keccak_256(data);
};
var __keccak256 = _keccak256;
function keccak256(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__keccak256(data));
}
keccak256._ = _keccak256;
keccak256.lock = function() {
  locked = true;
};
keccak256.register = function(func) {
  if (locked) {
    throw new TypeError("keccak256 is locked");
  }
  __keccak256 = func;
};
Object.freeze(keccak256);

// node_modules/ethers/lib.esm/address/address.js
var BN_02 = BigInt(0);
var BN_36 = BigInt(36);
function getChecksumAddress(address) {
  address = address.toLowerCase();
  const chars = address.substring(2).split("");
  const expanded = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    expanded[i] = chars[i].charCodeAt(0);
  }
  const hashed = getBytes(keccak256(expanded));
  for (let i = 0; i < 40; i += 2) {
    if (hashed[i >> 1] >> 4 >= 8) {
      chars[i] = chars[i].toUpperCase();
    }
    if ((hashed[i >> 1] & 15) >= 8) {
      chars[i + 1] = chars[i + 1].toUpperCase();
    }
  }
  return "0x" + chars.join("");
}
var ibanLookup = {};
for (let i = 0; i < 10; i++) {
  ibanLookup[String(i)] = String(i);
}
for (let i = 0; i < 26; i++) {
  ibanLookup[String.fromCharCode(65 + i)] = String(10 + i);
}
var safeDigits = 15;
function ibanChecksum(address) {
  address = address.toUpperCase();
  address = address.substring(4) + address.substring(0, 2) + "00";
  let expanded = address.split("").map((c) => {
    return ibanLookup[c];
  }).join("");
  while (expanded.length >= safeDigits) {
    let block = expanded.substring(0, safeDigits);
    expanded = parseInt(block, 10) % 97 + expanded.substring(block.length);
  }
  let checksum = String(98 - parseInt(expanded, 10) % 97);
  while (checksum.length < 2) {
    checksum = "0" + checksum;
  }
  return checksum;
}
var Base36 = (function() {
  ;
  const result = {};
  for (let i = 0; i < 36; i++) {
    const key = "0123456789abcdefghijklmnopqrstuvwxyz"[i];
    result[key] = BigInt(i);
  }
  return result;
})();
function fromBase36(value) {
  value = value.toLowerCase();
  let result = BN_02;
  for (let i = 0; i < value.length; i++) {
    result = result * BN_36 + Base36[value[i]];
  }
  return result;
}
function getAddress(address) {
  assertArgument(typeof address === "string", "invalid address", "address", address);
  if (address.match(/^(0x)?[0-9a-fA-F]{40}$/)) {
    if (!address.startsWith("0x")) {
      address = "0x" + address;
    }
    const result = getChecksumAddress(address);
    assertArgument(!address.match(/([A-F].*[a-f])|([a-f].*[A-F])/) || result === address, "bad address checksum", "address", address);
    return result;
  }
  if (address.match(/^XE[0-9]{2}[0-9A-Za-z]{30,31}$/)) {
    assertArgument(address.substring(2, 4) === ibanChecksum(address), "bad icap checksum", "address", address);
    let result = fromBase36(address.substring(4)).toString(16);
    while (result.length < 40) {
      result = "0" + result;
    }
    return getChecksumAddress("0x" + result);
  }
  assertArgument(false, "invalid address", "address", address);
}

// node_modules/ethers/lib.esm/abi/typed.js
var _gaurd = {};
function n(value, width) {
  let signed = false;
  if (width < 0) {
    signed = true;
    width *= -1;
  }
  return new Typed(_gaurd, `${signed ? "" : "u"}int${width}`, value, { signed, width });
}
function b(value, size) {
  return new Typed(_gaurd, `bytes${size ? size : ""}`, value, { size });
}
var _typedSymbol = /* @__PURE__ */ Symbol.for("_ethers_typed");
var Typed = class _Typed {
  /**
   *  The type, as a Solidity-compatible type.
   */
  type;
  /**
   *  The actual value.
   */
  value;
  #options;
  /**
   *  @_ignore:
   */
  _typedSymbol;
  /**
   *  @_ignore:
   */
  constructor(gaurd, type, value, options) {
    if (options == null) {
      options = null;
    }
    assertPrivate(_gaurd, gaurd, "Typed");
    defineProperties(this, { _typedSymbol, type, value });
    this.#options = options;
    this.format();
  }
  /**
   *  Format the type as a Human-Readable type.
   */
  format() {
    if (this.type === "array") {
      throw new Error("");
    } else if (this.type === "dynamicArray") {
      throw new Error("");
    } else if (this.type === "tuple") {
      return `tuple(${this.value.map((v) => v.format()).join(",")})`;
    }
    return this.type;
  }
  /**
   *  The default value returned by this type.
   */
  defaultValue() {
    return 0;
  }
  /**
   *  The minimum value for numeric types.
   */
  minValue() {
    return 0;
  }
  /**
   *  The maximum value for numeric types.
   */
  maxValue() {
    return 0;
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedBigInt]].
   */
  isBigInt() {
    return !!this.type.match(/^u?int[0-9]+$/);
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedData]].
   */
  isData() {
    return this.type.startsWith("bytes");
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedString]].
   */
  isString() {
    return this.type === "string";
  }
  /**
   *  Returns the tuple name, if this is a tuple. Throws otherwise.
   */
  get tupleName() {
    if (this.type !== "tuple") {
      throw TypeError("not a tuple");
    }
    return this.#options;
  }
  // Returns the length of this type as an array
  // - `null` indicates the length is unforced, it could be dynamic
  // - `-1` indicates the length is dynamic
  // - any other value indicates it is a static array and is its length
  /**
   *  Returns the length of the array type or ``-1`` if it is dynamic.
   *
   *  Throws if the type is not an array.
   */
  get arrayLength() {
    if (this.type !== "array") {
      throw TypeError("not an array");
    }
    if (this.#options === true) {
      return -1;
    }
    if (this.#options === false) {
      return this.value.length;
    }
    return null;
  }
  /**
   *  Returns a new **Typed** of %%type%% with the %%value%%.
   */
  static from(type, value) {
    return new _Typed(_gaurd, type, value);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static uint8(v) {
    return n(v, 8);
  }
  /**
   *  Return a new ``uint16`` type for %%v%%.
   */
  static uint16(v) {
    return n(v, 16);
  }
  /**
   *  Return a new ``uint24`` type for %%v%%.
   */
  static uint24(v) {
    return n(v, 24);
  }
  /**
   *  Return a new ``uint32`` type for %%v%%.
   */
  static uint32(v) {
    return n(v, 32);
  }
  /**
   *  Return a new ``uint40`` type for %%v%%.
   */
  static uint40(v) {
    return n(v, 40);
  }
  /**
   *  Return a new ``uint48`` type for %%v%%.
   */
  static uint48(v) {
    return n(v, 48);
  }
  /**
   *  Return a new ``uint56`` type for %%v%%.
   */
  static uint56(v) {
    return n(v, 56);
  }
  /**
   *  Return a new ``uint64`` type for %%v%%.
   */
  static uint64(v) {
    return n(v, 64);
  }
  /**
   *  Return a new ``uint72`` type for %%v%%.
   */
  static uint72(v) {
    return n(v, 72);
  }
  /**
   *  Return a new ``uint80`` type for %%v%%.
   */
  static uint80(v) {
    return n(v, 80);
  }
  /**
   *  Return a new ``uint88`` type for %%v%%.
   */
  static uint88(v) {
    return n(v, 88);
  }
  /**
   *  Return a new ``uint96`` type for %%v%%.
   */
  static uint96(v) {
    return n(v, 96);
  }
  /**
   *  Return a new ``uint104`` type for %%v%%.
   */
  static uint104(v) {
    return n(v, 104);
  }
  /**
   *  Return a new ``uint112`` type for %%v%%.
   */
  static uint112(v) {
    return n(v, 112);
  }
  /**
   *  Return a new ``uint120`` type for %%v%%.
   */
  static uint120(v) {
    return n(v, 120);
  }
  /**
   *  Return a new ``uint128`` type for %%v%%.
   */
  static uint128(v) {
    return n(v, 128);
  }
  /**
   *  Return a new ``uint136`` type for %%v%%.
   */
  static uint136(v) {
    return n(v, 136);
  }
  /**
   *  Return a new ``uint144`` type for %%v%%.
   */
  static uint144(v) {
    return n(v, 144);
  }
  /**
   *  Return a new ``uint152`` type for %%v%%.
   */
  static uint152(v) {
    return n(v, 152);
  }
  /**
   *  Return a new ``uint160`` type for %%v%%.
   */
  static uint160(v) {
    return n(v, 160);
  }
  /**
   *  Return a new ``uint168`` type for %%v%%.
   */
  static uint168(v) {
    return n(v, 168);
  }
  /**
   *  Return a new ``uint176`` type for %%v%%.
   */
  static uint176(v) {
    return n(v, 176);
  }
  /**
   *  Return a new ``uint184`` type for %%v%%.
   */
  static uint184(v) {
    return n(v, 184);
  }
  /**
   *  Return a new ``uint192`` type for %%v%%.
   */
  static uint192(v) {
    return n(v, 192);
  }
  /**
   *  Return a new ``uint200`` type for %%v%%.
   */
  static uint200(v) {
    return n(v, 200);
  }
  /**
   *  Return a new ``uint208`` type for %%v%%.
   */
  static uint208(v) {
    return n(v, 208);
  }
  /**
   *  Return a new ``uint216`` type for %%v%%.
   */
  static uint216(v) {
    return n(v, 216);
  }
  /**
   *  Return a new ``uint224`` type for %%v%%.
   */
  static uint224(v) {
    return n(v, 224);
  }
  /**
   *  Return a new ``uint232`` type for %%v%%.
   */
  static uint232(v) {
    return n(v, 232);
  }
  /**
   *  Return a new ``uint240`` type for %%v%%.
   */
  static uint240(v) {
    return n(v, 240);
  }
  /**
   *  Return a new ``uint248`` type for %%v%%.
   */
  static uint248(v) {
    return n(v, 248);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint256(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``int8`` type for %%v%%.
   */
  static int8(v) {
    return n(v, -8);
  }
  /**
   *  Return a new ``int16`` type for %%v%%.
   */
  static int16(v) {
    return n(v, -16);
  }
  /**
   *  Return a new ``int24`` type for %%v%%.
   */
  static int24(v) {
    return n(v, -24);
  }
  /**
   *  Return a new ``int32`` type for %%v%%.
   */
  static int32(v) {
    return n(v, -32);
  }
  /**
   *  Return a new ``int40`` type for %%v%%.
   */
  static int40(v) {
    return n(v, -40);
  }
  /**
   *  Return a new ``int48`` type for %%v%%.
   */
  static int48(v) {
    return n(v, -48);
  }
  /**
   *  Return a new ``int56`` type for %%v%%.
   */
  static int56(v) {
    return n(v, -56);
  }
  /**
   *  Return a new ``int64`` type for %%v%%.
   */
  static int64(v) {
    return n(v, -64);
  }
  /**
   *  Return a new ``int72`` type for %%v%%.
   */
  static int72(v) {
    return n(v, -72);
  }
  /**
   *  Return a new ``int80`` type for %%v%%.
   */
  static int80(v) {
    return n(v, -80);
  }
  /**
   *  Return a new ``int88`` type for %%v%%.
   */
  static int88(v) {
    return n(v, -88);
  }
  /**
   *  Return a new ``int96`` type for %%v%%.
   */
  static int96(v) {
    return n(v, -96);
  }
  /**
   *  Return a new ``int104`` type for %%v%%.
   */
  static int104(v) {
    return n(v, -104);
  }
  /**
   *  Return a new ``int112`` type for %%v%%.
   */
  static int112(v) {
    return n(v, -112);
  }
  /**
   *  Return a new ``int120`` type for %%v%%.
   */
  static int120(v) {
    return n(v, -120);
  }
  /**
   *  Return a new ``int128`` type for %%v%%.
   */
  static int128(v) {
    return n(v, -128);
  }
  /**
   *  Return a new ``int136`` type for %%v%%.
   */
  static int136(v) {
    return n(v, -136);
  }
  /**
   *  Return a new ``int144`` type for %%v%%.
   */
  static int144(v) {
    return n(v, -144);
  }
  /**
   *  Return a new ``int52`` type for %%v%%.
   */
  static int152(v) {
    return n(v, -152);
  }
  /**
   *  Return a new ``int160`` type for %%v%%.
   */
  static int160(v) {
    return n(v, -160);
  }
  /**
   *  Return a new ``int168`` type for %%v%%.
   */
  static int168(v) {
    return n(v, -168);
  }
  /**
   *  Return a new ``int176`` type for %%v%%.
   */
  static int176(v) {
    return n(v, -176);
  }
  /**
   *  Return a new ``int184`` type for %%v%%.
   */
  static int184(v) {
    return n(v, -184);
  }
  /**
   *  Return a new ``int92`` type for %%v%%.
   */
  static int192(v) {
    return n(v, -192);
  }
  /**
   *  Return a new ``int200`` type for %%v%%.
   */
  static int200(v) {
    return n(v, -200);
  }
  /**
   *  Return a new ``int208`` type for %%v%%.
   */
  static int208(v) {
    return n(v, -208);
  }
  /**
   *  Return a new ``int216`` type for %%v%%.
   */
  static int216(v) {
    return n(v, -216);
  }
  /**
   *  Return a new ``int224`` type for %%v%%.
   */
  static int224(v) {
    return n(v, -224);
  }
  /**
   *  Return a new ``int232`` type for %%v%%.
   */
  static int232(v) {
    return n(v, -232);
  }
  /**
   *  Return a new ``int240`` type for %%v%%.
   */
  static int240(v) {
    return n(v, -240);
  }
  /**
   *  Return a new ``int248`` type for %%v%%.
   */
  static int248(v) {
    return n(v, -248);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int256(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``bytes1`` type for %%v%%.
   */
  static bytes1(v) {
    return b(v, 1);
  }
  /**
   *  Return a new ``bytes2`` type for %%v%%.
   */
  static bytes2(v) {
    return b(v, 2);
  }
  /**
   *  Return a new ``bytes3`` type for %%v%%.
   */
  static bytes3(v) {
    return b(v, 3);
  }
  /**
   *  Return a new ``bytes4`` type for %%v%%.
   */
  static bytes4(v) {
    return b(v, 4);
  }
  /**
   *  Return a new ``bytes5`` type for %%v%%.
   */
  static bytes5(v) {
    return b(v, 5);
  }
  /**
   *  Return a new ``bytes6`` type for %%v%%.
   */
  static bytes6(v) {
    return b(v, 6);
  }
  /**
   *  Return a new ``bytes7`` type for %%v%%.
   */
  static bytes7(v) {
    return b(v, 7);
  }
  /**
   *  Return a new ``bytes8`` type for %%v%%.
   */
  static bytes8(v) {
    return b(v, 8);
  }
  /**
   *  Return a new ``bytes9`` type for %%v%%.
   */
  static bytes9(v) {
    return b(v, 9);
  }
  /**
   *  Return a new ``bytes10`` type for %%v%%.
   */
  static bytes10(v) {
    return b(v, 10);
  }
  /**
   *  Return a new ``bytes11`` type for %%v%%.
   */
  static bytes11(v) {
    return b(v, 11);
  }
  /**
   *  Return a new ``bytes12`` type for %%v%%.
   */
  static bytes12(v) {
    return b(v, 12);
  }
  /**
   *  Return a new ``bytes13`` type for %%v%%.
   */
  static bytes13(v) {
    return b(v, 13);
  }
  /**
   *  Return a new ``bytes14`` type for %%v%%.
   */
  static bytes14(v) {
    return b(v, 14);
  }
  /**
   *  Return a new ``bytes15`` type for %%v%%.
   */
  static bytes15(v) {
    return b(v, 15);
  }
  /**
   *  Return a new ``bytes16`` type for %%v%%.
   */
  static bytes16(v) {
    return b(v, 16);
  }
  /**
   *  Return a new ``bytes17`` type for %%v%%.
   */
  static bytes17(v) {
    return b(v, 17);
  }
  /**
   *  Return a new ``bytes18`` type for %%v%%.
   */
  static bytes18(v) {
    return b(v, 18);
  }
  /**
   *  Return a new ``bytes19`` type for %%v%%.
   */
  static bytes19(v) {
    return b(v, 19);
  }
  /**
   *  Return a new ``bytes20`` type for %%v%%.
   */
  static bytes20(v) {
    return b(v, 20);
  }
  /**
   *  Return a new ``bytes21`` type for %%v%%.
   */
  static bytes21(v) {
    return b(v, 21);
  }
  /**
   *  Return a new ``bytes22`` type for %%v%%.
   */
  static bytes22(v) {
    return b(v, 22);
  }
  /**
   *  Return a new ``bytes23`` type for %%v%%.
   */
  static bytes23(v) {
    return b(v, 23);
  }
  /**
   *  Return a new ``bytes24`` type for %%v%%.
   */
  static bytes24(v) {
    return b(v, 24);
  }
  /**
   *  Return a new ``bytes25`` type for %%v%%.
   */
  static bytes25(v) {
    return b(v, 25);
  }
  /**
   *  Return a new ``bytes26`` type for %%v%%.
   */
  static bytes26(v) {
    return b(v, 26);
  }
  /**
   *  Return a new ``bytes27`` type for %%v%%.
   */
  static bytes27(v) {
    return b(v, 27);
  }
  /**
   *  Return a new ``bytes28`` type for %%v%%.
   */
  static bytes28(v) {
    return b(v, 28);
  }
  /**
   *  Return a new ``bytes29`` type for %%v%%.
   */
  static bytes29(v) {
    return b(v, 29);
  }
  /**
   *  Return a new ``bytes30`` type for %%v%%.
   */
  static bytes30(v) {
    return b(v, 30);
  }
  /**
   *  Return a new ``bytes31`` type for %%v%%.
   */
  static bytes31(v) {
    return b(v, 31);
  }
  /**
   *  Return a new ``bytes32`` type for %%v%%.
   */
  static bytes32(v) {
    return b(v, 32);
  }
  /**
   *  Return a new ``address`` type for %%v%%.
   */
  static address(v) {
    return new _Typed(_gaurd, "address", v);
  }
  /**
   *  Return a new ``bool`` type for %%v%%.
   */
  static bool(v) {
    return new _Typed(_gaurd, "bool", !!v);
  }
  /**
   *  Return a new ``bytes`` type for %%v%%.
   */
  static bytes(v) {
    return new _Typed(_gaurd, "bytes", v);
  }
  /**
   *  Return a new ``string`` type for %%v%%.
   */
  static string(v) {
    return new _Typed(_gaurd, "string", v);
  }
  /**
   *  Return a new ``array`` type for %%v%%, allowing %%dynamic%% length.
   */
  static array(v, dynamic) {
    throw new Error("not implemented yet");
    return new _Typed(_gaurd, "array", v, dynamic);
  }
  /**
   *  Return a new ``tuple`` type for %%v%%, with the optional %%name%%.
   */
  static tuple(v, name) {
    throw new Error("not implemented yet");
    return new _Typed(_gaurd, "tuple", v, name);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static overrides(v) {
    return new _Typed(_gaurd, "overrides", Object.assign({}, v));
  }
  /**
   *  Returns true only if %%value%% is a [[Typed]] instance.
   */
  static isTyped(value) {
    return value && typeof value === "object" && "_typedSymbol" in value && value._typedSymbol === _typedSymbol;
  }
  /**
   *  If the value is a [[Typed]] instance, validates the underlying value
   *  and returns it, otherwise returns value directly.
   *
   *  This is useful for functions that with to accept either a [[Typed]]
   *  object or values.
   */
  static dereference(value, type) {
    if (_Typed.isTyped(value)) {
      if (value.type !== type) {
        throw new Error(`invalid type: expecetd ${type}, got ${value.type}`);
      }
      return value.value;
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/address.js
var AddressCoder = class extends Coder {
  constructor(localName) {
    super("address", "address", localName, false);
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000";
  }
  encode(writer, _value) {
    let value = Typed.dereference(_value, "string");
    try {
      value = getAddress(value);
    } catch (error) {
      return this._throwError(error.message, _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    return getAddress(toBeHex(reader.readValue(), 20));
  }
};

// node_modules/ethers/lib.esm/abi/coders/anonymous.js
var AnonymousCoder = class extends Coder {
  coder;
  constructor(coder) {
    super(coder.name, coder.type, "_", coder.dynamic);
    this.coder = coder;
  }
  defaultValue() {
    return this.coder.defaultValue();
  }
  encode(writer, value) {
    return this.coder.encode(writer, value);
  }
  decode(reader) {
    return this.coder.decode(reader);
  }
};

// node_modules/ethers/lib.esm/abi/coders/array.js
function pack(writer, coders, values) {
  let arrayValues = [];
  if (Array.isArray(values)) {
    arrayValues = values;
  } else if (values && typeof values === "object") {
    let unique = {};
    arrayValues = coders.map((coder) => {
      const name = coder.localName;
      assert(name, "cannot encode object for signature with missing names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      assert(!unique[name], "cannot encode object for signature with duplicate names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      unique[name] = true;
      return values[name];
    });
  } else {
    assertArgument(false, "invalid tuple value", "tuple", values);
  }
  assertArgument(coders.length === arrayValues.length, "types/value length mismatch", "tuple", values);
  let staticWriter = new Writer();
  let dynamicWriter = new Writer();
  let updateFuncs = [];
  coders.forEach((coder, index) => {
    let value = arrayValues[index];
    if (coder.dynamic) {
      let dynamicOffset = dynamicWriter.length;
      coder.encode(dynamicWriter, value);
      let updateFunc = staticWriter.writeUpdatableValue();
      updateFuncs.push((baseOffset) => {
        updateFunc(baseOffset + dynamicOffset);
      });
    } else {
      coder.encode(staticWriter, value);
    }
  });
  updateFuncs.forEach((func) => {
    func(staticWriter.length);
  });
  let length = writer.appendWriter(staticWriter);
  length += writer.appendWriter(dynamicWriter);
  return length;
}
function unpack(reader, coders) {
  let values = [];
  let keys = [];
  let baseReader = reader.subReader(0);
  coders.forEach((coder) => {
    let value = null;
    if (coder.dynamic) {
      let offset = reader.readIndex();
      let offsetReader = baseReader.subReader(offset);
      try {
        value = coder.decode(offsetReader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    } else {
      try {
        value = coder.decode(reader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    }
    if (value == void 0) {
      throw new Error("investigate");
    }
    values.push(value);
    keys.push(coder.localName || null);
  });
  return Result.fromItems(values, keys);
}
var ArrayCoder = class extends Coder {
  coder;
  length;
  constructor(coder, length, localName) {
    const type = coder.type + "[" + (length >= 0 ? length : "") + "]";
    const dynamic = length === -1 || coder.dynamic;
    super("array", type, localName, dynamic);
    defineProperties(this, { coder, length });
  }
  defaultValue() {
    const defaultChild = this.coder.defaultValue();
    const result = [];
    for (let i = 0; i < this.length; i++) {
      result.push(defaultChild);
    }
    return result;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "array");
    if (!Array.isArray(value)) {
      this._throwError("expected array value", value);
    }
    let count = this.length;
    if (count === -1) {
      count = value.length;
      writer.writeValue(value.length);
    }
    assertArgumentCount(value.length, count, "coder array" + (this.localName ? " " + this.localName : ""));
    let coders = [];
    for (let i = 0; i < value.length; i++) {
      coders.push(this.coder);
    }
    return pack(writer, coders, value);
  }
  decode(reader) {
    let count = this.length;
    if (count === -1) {
      count = reader.readIndex();
      assert(count * WordSize <= reader.dataLength, "insufficient data length", "BUFFER_OVERRUN", { buffer: reader.bytes, offset: count * WordSize, length: reader.dataLength });
    }
    let coders = [];
    for (let i = 0; i < count; i++) {
      coders.push(new AnonymousCoder(this.coder));
    }
    return unpack(reader, coders);
  }
};

// node_modules/ethers/lib.esm/abi/coders/boolean.js
var BooleanCoder = class extends Coder {
  constructor(localName) {
    super("bool", "bool", localName, false);
  }
  defaultValue() {
    return false;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "bool");
    return writer.writeValue(value ? 1 : 0);
  }
  decode(reader) {
    return !!reader.readValue();
  }
};

// node_modules/ethers/lib.esm/abi/coders/bytes.js
var DynamicBytesCoder = class extends Coder {
  constructor(type, localName) {
    super(type, type, localName, true);
  }
  defaultValue() {
    return "0x";
  }
  encode(writer, value) {
    value = getBytesCopy(value);
    let length = writer.writeValue(value.length);
    length += writer.writeBytes(value);
    return length;
  }
  decode(reader) {
    return reader.readBytes(reader.readIndex(), true);
  }
};
var BytesCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("bytes", localName);
  }
  decode(reader) {
    return hexlify(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/fixed-bytes.js
var FixedBytesCoder = class extends Coder {
  size;
  constructor(size, localName) {
    let name = "bytes" + String(size);
    super(name, name, localName, false);
    defineProperties(this, { size }, { size: "number" });
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000000000000000000000000000".substring(0, 2 + this.size * 2);
  }
  encode(writer, _value) {
    let data = getBytesCopy(Typed.dereference(_value, this.type));
    if (data.length !== this.size) {
      this._throwError("incorrect data length", _value);
    }
    return writer.writeBytes(data);
  }
  decode(reader) {
    return hexlify(reader.readBytes(this.size));
  }
};

// node_modules/ethers/lib.esm/abi/coders/null.js
var Empty = new Uint8Array([]);
var NullCoder = class extends Coder {
  constructor(localName) {
    super("null", "", localName, false);
  }
  defaultValue() {
    return null;
  }
  encode(writer, value) {
    if (value != null) {
      this._throwError("not null", value);
    }
    return writer.writeBytes(Empty);
  }
  decode(reader) {
    reader.readBytes(0);
    return null;
  }
};

// node_modules/ethers/lib.esm/abi/coders/number.js
var BN_03 = BigInt(0);
var BN_12 = BigInt(1);
var BN_MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var NumberCoder = class extends Coder {
  size;
  signed;
  constructor(size, signed, localName) {
    const name = (signed ? "int" : "uint") + size * 8;
    super(name, name, localName, false);
    defineProperties(this, { size, signed }, { size: "number", signed: "boolean" });
  }
  defaultValue() {
    return 0;
  }
  encode(writer, _value) {
    let value = getBigInt(Typed.dereference(_value, this.type));
    let maxUintValue = mask(BN_MAX_UINT256, WordSize * 8);
    if (this.signed) {
      let bounds = mask(maxUintValue, this.size * 8 - 1);
      if (value > bounds || value < -(bounds + BN_12)) {
        this._throwError("value out-of-bounds", _value);
      }
      value = toTwos(value, 8 * WordSize);
    } else if (value < BN_03 || value > mask(maxUintValue, this.size * 8)) {
      this._throwError("value out-of-bounds", _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    let value = mask(reader.readValue(), this.size * 8);
    if (this.signed) {
      value = fromTwos(value, this.size * 8);
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/string.js
var StringCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("string", localName);
  }
  defaultValue() {
    return "";
  }
  encode(writer, _value) {
    return super.encode(writer, toUtf8Bytes(Typed.dereference(_value, "string")));
  }
  decode(reader) {
    return toUtf8String(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/tuple.js
var TupleCoder = class extends Coder {
  coders;
  constructor(coders, localName) {
    let dynamic = false;
    const types = [];
    coders.forEach((coder) => {
      if (coder.dynamic) {
        dynamic = true;
      }
      types.push(coder.type);
    });
    const type = "tuple(" + types.join(",") + ")";
    super("tuple", type, localName, dynamic);
    defineProperties(this, { coders: Object.freeze(coders.slice()) });
  }
  defaultValue() {
    const values = [];
    this.coders.forEach((coder) => {
      values.push(coder.defaultValue());
    });
    const uniqueNames = this.coders.reduce((accum, coder) => {
      const name = coder.localName;
      if (name) {
        if (!accum[name]) {
          accum[name] = 0;
        }
        accum[name]++;
      }
      return accum;
    }, {});
    this.coders.forEach((coder, index) => {
      let name = coder.localName;
      if (!name || uniqueNames[name] !== 1) {
        return;
      }
      if (name === "length") {
        name = "_length";
      }
      if (values[name] != null) {
        return;
      }
      values[name] = values[index];
    });
    return Object.freeze(values);
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "tuple");
    return pack(writer, this.coders, value);
  }
  decode(reader) {
    return unpack(reader, this.coders);
  }
};

// node_modules/ethers/lib.esm/abi/fragments.js
function setify(items) {
  const result = /* @__PURE__ */ new Set();
  items.forEach((k) => result.add(k));
  return Object.freeze(result);
}
var _kwVisibDeploy = "external public payable override";
var KwVisibDeploy = setify(_kwVisibDeploy.split(" "));
var _kwVisib = "constant external internal payable private public pure view override";
var KwVisib = setify(_kwVisib.split(" "));
var _kwTypes = "constructor error event fallback function receive struct";
var KwTypes = setify(_kwTypes.split(" "));
var _kwModifiers = "calldata memory storage payable indexed";
var KwModifiers = setify(_kwModifiers.split(" "));
var _kwOther = "tuple returns";
var _keywords = [_kwTypes, _kwModifiers, _kwOther, _kwVisib].join(" ");
var Keywords = setify(_keywords.split(" "));
var SimpleTokens = {
  "(": "OPEN_PAREN",
  ")": "CLOSE_PAREN",
  "[": "OPEN_BRACKET",
  "]": "CLOSE_BRACKET",
  ",": "COMMA",
  "@": "AT"
};
var regexWhitespacePrefix = new RegExp("^(\\s*)");
var regexNumberPrefix = new RegExp("^([0-9]+)");
var regexIdPrefix = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)");
var regexId = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)$");
var regexType = new RegExp("^(address|bool|bytes([0-9]*)|string|u?int([0-9]*))$");
var TokenString = class _TokenString {
  #offset;
  #tokens;
  get offset() {
    return this.#offset;
  }
  get length() {
    return this.#tokens.length - this.#offset;
  }
  constructor(tokens) {
    this.#offset = 0;
    this.#tokens = tokens.slice();
  }
  clone() {
    return new _TokenString(this.#tokens);
  }
  reset() {
    this.#offset = 0;
  }
  #subTokenString(from = 0, to = 0) {
    return new _TokenString(this.#tokens.slice(from, to).map((t) => {
      return Object.freeze(Object.assign({}, t, {
        match: t.match - from,
        linkBack: t.linkBack - from,
        linkNext: t.linkNext - from
      }));
    }));
  }
  // Pops and returns the value of the next token, if it is a keyword in allowed; throws if out of tokens
  popKeyword(allowed) {
    const top = this.peek();
    if (top.type !== "KEYWORD" || !allowed.has(top.text)) {
      throw new Error(`expected keyword ${top.text}`);
    }
    return this.pop().text;
  }
  // Pops and returns the value of the next token if it is `type`; throws if out of tokens
  popType(type) {
    if (this.peek().type !== type) {
      const top = this.peek();
      throw new Error(`expected ${type}; got ${top.type} ${JSON.stringify(top.text)}`);
    }
    return this.pop().text;
  }
  // Pops and returns a "(" TOKENS ")"
  popParen() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result = this.#subTokenString(this.#offset + 1, top.match + 1);
    this.#offset = top.match + 1;
    return result;
  }
  // Pops and returns the items within "(" ITEM1 "," ITEM2 "," ... ")"
  popParams() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result = [];
    while (this.#offset < top.match - 1) {
      const link = this.peek().linkNext;
      result.push(this.#subTokenString(this.#offset + 1, link));
      this.#offset = link;
    }
    this.#offset = top.match + 1;
    return result;
  }
  // Returns the top Token, throwing if out of tokens
  peek() {
    if (this.#offset >= this.#tokens.length) {
      throw new Error("out-of-bounds");
    }
    return this.#tokens[this.#offset];
  }
  // Returns the next value, if it is a keyword in `allowed`
  peekKeyword(allowed) {
    const top = this.peekType("KEYWORD");
    return top != null && allowed.has(top) ? top : null;
  }
  // Returns the value of the next token if it is `type`
  peekType(type) {
    if (this.length === 0) {
      return null;
    }
    const top = this.peek();
    return top.type === type ? top.text : null;
  }
  // Returns the next token; throws if out of tokens
  pop() {
    const result = this.peek();
    this.#offset++;
    return result;
  }
  toString() {
    const tokens = [];
    for (let i = this.#offset; i < this.#tokens.length; i++) {
      const token = this.#tokens[i];
      tokens.push(`${token.type}:${token.text}`);
    }
    return `<TokenString ${tokens.join(" ")}>`;
  }
};
function lex(text) {
  const tokens = [];
  const throwError2 = (message) => {
    const token = offset < text.length ? JSON.stringify(text[offset]) : "$EOI";
    throw new Error(`invalid token ${token} at ${offset}: ${message}`);
  };
  let brackets = [];
  let commas = [];
  let offset = 0;
  while (offset < text.length) {
    let cur = text.substring(offset);
    let match = cur.match(regexWhitespacePrefix);
    if (match) {
      offset += match[1].length;
      cur = text.substring(offset);
    }
    const token = { depth: brackets.length, linkBack: -1, linkNext: -1, match: -1, type: "", text: "", offset, value: -1 };
    tokens.push(token);
    let type = SimpleTokens[cur[0]] || "";
    if (type) {
      token.type = type;
      token.text = cur[0];
      offset++;
      if (type === "OPEN_PAREN") {
        brackets.push(tokens.length - 1);
        commas.push(tokens.length - 1);
      } else if (type == "CLOSE_PAREN") {
        if (brackets.length === 0) {
          throwError2("no matching open bracket");
        }
        token.match = brackets.pop();
        tokens[token.match].match = tokens.length - 1;
        token.depth--;
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
      } else if (type === "COMMA") {
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
        commas.push(tokens.length - 1);
      } else if (type === "OPEN_BRACKET") {
        token.type = "BRACKET";
      } else if (type === "CLOSE_BRACKET") {
        let suffix = tokens.pop().text;
        if (tokens.length > 0 && tokens[tokens.length - 1].type === "NUMBER") {
          const value = tokens.pop().text;
          suffix = value + suffix;
          tokens[tokens.length - 1].value = getNumber(value);
        }
        if (tokens.length === 0 || tokens[tokens.length - 1].type !== "BRACKET") {
          throw new Error("missing opening bracket");
        }
        tokens[tokens.length - 1].text += suffix;
      }
      continue;
    }
    match = cur.match(regexIdPrefix);
    if (match) {
      token.text = match[1];
      offset += token.text.length;
      if (Keywords.has(token.text)) {
        token.type = "KEYWORD";
        continue;
      }
      if (token.text.match(regexType)) {
        token.type = "TYPE";
        continue;
      }
      token.type = "ID";
      continue;
    }
    match = cur.match(regexNumberPrefix);
    if (match) {
      token.text = match[1];
      token.type = "NUMBER";
      offset += token.text.length;
      continue;
    }
    throw new Error(`unexpected token ${JSON.stringify(cur[0])} at position ${offset}`);
  }
  return new TokenString(tokens.map((t) => Object.freeze(t)));
}
function consumeKeywords(tokens, allowed) {
  const keywords = /* @__PURE__ */ new Set();
  while (true) {
    const keyword = tokens.peekType("KEYWORD");
    if (keyword == null || allowed && !allowed.has(keyword)) {
      break;
    }
    tokens.pop();
    if (keywords.has(keyword)) {
      throw new Error(`duplicate keywords: ${JSON.stringify(keyword)}`);
    }
    keywords.add(keyword);
  }
  return Object.freeze(keywords);
}
var regexArrayType = new RegExp(/^(.*)\[([0-9]*)\]$/);
function verifyBasicType(type) {
  const match = type.match(regexType);
  assertArgument(match, "invalid type", "type", type);
  if (type === "uint") {
    return "uint256";
  }
  if (type === "int") {
    return "int256";
  }
  if (match[2]) {
    const length = parseInt(match[2]);
    assertArgument(length !== 0 && length <= 32, "invalid bytes length", "type", type);
  } else if (match[3]) {
    const size = parseInt(match[3]);
    assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid numeric width", "type", type);
  }
  return type;
}
var _guard2 = {};
var internal = /* @__PURE__ */ Symbol.for("_ethers_internal");
var ParamTypeInternal = "_ParamTypeInternal";
var ParamType = class _ParamType {
  /**
   *  The local name of the parameter (or ``""`` if unbound)
   */
  name;
  /**
   *  The fully qualified type (e.g. ``"address"``, ``"tuple(address)"``,
   *  ``"uint256[3][]"``)
   */
  type;
  /**
   *  The base type (e.g. ``"address"``, ``"tuple"``, ``"array"``)
   */
  baseType;
  /**
   *  True if the parameters is indexed.
   *
   *  For non-indexable types this is ``null``.
   */
  indexed;
  /**
   *  The components for the tuple.
   *
   *  For non-tuple types this is ``null``.
   */
  components;
  /**
   *  The array length, or ``-1`` for dynamic-lengthed arrays.
   *
   *  For non-array types this is ``null``.
   */
  arrayLength;
  /**
   *  The type of each child in the array.
   *
   *  For non-array types this is ``null``.
   */
  arrayChildren;
  /**
   *  @private
   */
  constructor(guard, name, type, baseType, indexed, components, arrayLength, arrayChildren) {
    assertPrivate(guard, _guard2, "ParamType");
    Object.defineProperty(this, internal, { value: ParamTypeInternal });
    if (components) {
      components = Object.freeze(components.slice());
    }
    if (baseType === "array") {
      if (arrayLength == null || arrayChildren == null) {
        throw new Error("");
      }
    } else if (arrayLength != null || arrayChildren != null) {
      throw new Error("");
    }
    if (baseType === "tuple") {
      if (components == null) {
        throw new Error("");
      }
    } else if (components != null) {
      throw new Error("");
    }
    defineProperties(this, {
      name,
      type,
      baseType,
      indexed,
      components,
      arrayLength,
      arrayChildren
    });
  }
  /**
   *  Return a string representation of this type.
   *
   *  For example,
   *
   *  ``sighash" => "(uint256,address)"``
   *
   *  ``"minimal" => "tuple(uint256,address) indexed"``
   *
   *  ``"full" => "tuple(uint256 foo, address bar) indexed baz"``
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      const name = this.name || "";
      if (this.isArray()) {
        const result3 = JSON.parse(this.arrayChildren.format("json"));
        result3.name = name;
        result3.type += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
        return JSON.stringify(result3);
      }
      const result2 = {
        type: this.baseType === "tuple" ? "tuple" : this.type,
        name
      };
      if (typeof this.indexed === "boolean") {
        result2.indexed = this.indexed;
      }
      if (this.isTuple()) {
        result2.components = this.components.map((c) => JSON.parse(c.format(format)));
      }
      return JSON.stringify(result2);
    }
    let result = "";
    if (this.isArray()) {
      result += this.arrayChildren.format(format);
      result += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
    } else {
      if (this.isTuple()) {
        result += "(" + this.components.map((comp) => comp.format(format)).join(format === "full" ? ", " : ",") + ")";
      } else {
        result += this.type;
      }
    }
    if (format !== "sighash") {
      if (this.indexed === true) {
        result += " indexed";
      }
      if (format === "full" && this.name) {
        result += " " + this.name;
      }
    }
    return result;
  }
  /**
   *  Returns true if %%this%% is an Array type.
   *
   *  This provides a type gaurd ensuring that [[arrayChildren]]
   *  and [[arrayLength]] are non-null.
   */
  isArray() {
    return this.baseType === "array";
  }
  /**
   *  Returns true if %%this%% is a Tuple type.
   *
   *  This provides a type gaurd ensuring that [[components]]
   *  is non-null.
   */
  isTuple() {
    return this.baseType === "tuple";
  }
  /**
   *  Returns true if %%this%% is an Indexable type.
   *
   *  This provides a type gaurd ensuring that [[indexed]]
   *  is non-null.
   */
  isIndexable() {
    return this.indexed != null;
  }
  /**
   *  Walks the **ParamType** with %%value%%, calling %%process%%
   *  on each type, destructing the %%value%% recursively.
   */
  walk(value, process2) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v) => _this.arrayChildren.walk(v, process2));
    }
    if (this.isTuple()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid tuple value");
      }
      if (value.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v, i) => _this.components[i].walk(v, process2));
    }
    return process2(this.type, value);
  }
  #walkAsync(promises, value, process2, setValue) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const childType = this.arrayChildren;
      const result2 = value.slice();
      result2.forEach((value2, index) => {
        childType.#walkAsync(promises, value2, process2, (value3) => {
          result2[index] = value3;
        });
      });
      setValue(result2);
      return;
    }
    if (this.isTuple()) {
      const components = this.components;
      let result2;
      if (Array.isArray(value)) {
        result2 = value.slice();
      } else {
        if (value == null || typeof value !== "object") {
          throw new Error("invalid tuple value");
        }
        result2 = components.map((param) => {
          if (!param.name) {
            throw new Error("cannot use object value with unnamed components");
          }
          if (!(param.name in value)) {
            throw new Error(`missing value for component ${param.name}`);
          }
          return value[param.name];
        });
      }
      if (result2.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      result2.forEach((value2, index) => {
        components[index].#walkAsync(promises, value2, process2, (value3) => {
          result2[index] = value3;
        });
      });
      setValue(result2);
      return;
    }
    const result = process2(this.type, value);
    if (result.then) {
      promises.push((async function() {
        setValue(await result);
      })());
    } else {
      setValue(result);
    }
  }
  /**
   *  Walks the **ParamType** with %%value%%, asynchronously calling
   *  %%process%% on each type, destructing the %%value%% recursively.
   *
   *  This can be used to resolve ENS names by walking and resolving each
   *  ``"address"`` type.
   */
  async walkAsync(value, process2) {
    const promises = [];
    const result = [value];
    this.#walkAsync(promises, value, process2, (value2) => {
      result[0] = value2;
    });
    if (promises.length) {
      await Promise.all(promises);
    }
    return result[0];
  }
  /**
   *  Creates a new **ParamType** for %%obj%%.
   *
   *  If %%allowIndexed%% then the ``indexed`` keyword is permitted,
   *  otherwise the ``indexed`` keyword will throw an error.
   */
  static from(obj, allowIndexed) {
    if (_ParamType.isParamType(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _ParamType.from(lex(obj), allowIndexed);
      } catch (error) {
        assertArgument(false, "invalid param type", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      let type2 = "", baseType = "";
      let comps = null;
      if (consumeKeywords(obj, setify(["tuple"])).has("tuple") || obj.peekType("OPEN_PAREN")) {
        baseType = "tuple";
        comps = obj.popParams().map((t) => _ParamType.from(t));
        type2 = `tuple(${comps.map((c) => c.format()).join(",")})`;
      } else {
        type2 = verifyBasicType(obj.popType("TYPE"));
        baseType = type2;
      }
      let arrayChildren = null;
      let arrayLength = null;
      while (obj.length && obj.peekType("BRACKET")) {
        const bracket = obj.pop();
        arrayChildren = new _ParamType(_guard2, "", type2, baseType, null, comps, arrayLength, arrayChildren);
        arrayLength = bracket.value;
        type2 += bracket.text;
        baseType = "array";
        comps = null;
      }
      let indexed2 = null;
      const keywords = consumeKeywords(obj, KwModifiers);
      if (keywords.has("indexed")) {
        if (!allowIndexed) {
          throw new Error("");
        }
        indexed2 = true;
      }
      const name2 = obj.peekType("ID") ? obj.pop().text : "";
      if (obj.length) {
        throw new Error("leftover tokens");
      }
      return new _ParamType(_guard2, name2, type2, baseType, indexed2, comps, arrayLength, arrayChildren);
    }
    const name = obj.name;
    assertArgument(!name || typeof name === "string" && name.match(regexId), "invalid name", "obj.name", name);
    let indexed = obj.indexed;
    if (indexed != null) {
      assertArgument(allowIndexed, "parameter cannot be indexed", "obj.indexed", obj.indexed);
      indexed = !!indexed;
    }
    let type = obj.type;
    let arrayMatch = type.match(regexArrayType);
    if (arrayMatch) {
      const arrayLength = parseInt(arrayMatch[2] || "-1");
      const arrayChildren = _ParamType.from({
        type: arrayMatch[1],
        components: obj.components
      });
      return new _ParamType(_guard2, name || "", type, "array", indexed, null, arrayLength, arrayChildren);
    }
    if (type === "tuple" || type.startsWith(
      "tuple("
      /* fix: ) */
    ) || type.startsWith(
      "("
      /* fix: ) */
    )) {
      const comps = obj.components != null ? obj.components.map((c) => _ParamType.from(c)) : null;
      const tuple = new _ParamType(_guard2, name || "", type, "tuple", indexed, comps, null, null);
      return tuple;
    }
    type = verifyBasicType(obj.type);
    return new _ParamType(_guard2, name || "", type, type, indexed, null, null, null);
  }
  /**
   *  Returns true if %%value%% is a **ParamType**.
   */
  static isParamType(value) {
    return value && value[internal] === ParamTypeInternal;
  }
};

// node_modules/ethers/lib.esm/abi/abi-coder.js
var PanicReasons = /* @__PURE__ */ new Map();
PanicReasons.set(0, "GENERIC_PANIC");
PanicReasons.set(1, "ASSERT_FALSE");
PanicReasons.set(17, "OVERFLOW");
PanicReasons.set(18, "DIVIDE_BY_ZERO");
PanicReasons.set(33, "ENUM_RANGE_ERROR");
PanicReasons.set(34, "BAD_STORAGE_DATA");
PanicReasons.set(49, "STACK_UNDERFLOW");
PanicReasons.set(50, "ARRAY_RANGE_ERROR");
PanicReasons.set(65, "OUT_OF_MEMORY");
PanicReasons.set(81, "UNINITIALIZED_FUNCTION_CALL");
var paramTypeBytes = new RegExp(/^bytes([0-9]*)$/);
var paramTypeNumber = new RegExp(/^(u?int)([0-9]*)$/);
var defaultCoder = null;
var defaultMaxInflation = 1024;
function getBuiltinCallException(action, tx, data, abiCoder2) {
  let message = "missing revert data";
  let reason = null;
  const invocation = null;
  let revert = null;
  if (data) {
    message = "execution reverted";
    const bytes2 = getBytes(data);
    data = hexlify(data);
    if (bytes2.length === 0) {
      message += " (no data present; likely require(false) occurred";
      reason = "require(false)";
    } else if (bytes2.length % 32 !== 4) {
      message += " (could not decode reason; invalid data length)";
    } else if (hexlify(bytes2.slice(0, 4)) === "0x08c379a0") {
      try {
        reason = abiCoder2.decode(["string"], bytes2.slice(4))[0];
        revert = {
          signature: "Error(string)",
          name: "Error",
          args: [reason]
        };
        message += `: ${JSON.stringify(reason)}`;
      } catch (error) {
        message += " (could not decode reason; invalid string data)";
      }
    } else if (hexlify(bytes2.slice(0, 4)) === "0x4e487b71") {
      try {
        const code2 = Number(abiCoder2.decode(["uint256"], bytes2.slice(4))[0]);
        revert = {
          signature: "Panic(uint256)",
          name: "Panic",
          args: [code2]
        };
        reason = `Panic due to ${PanicReasons.get(code2) || "UNKNOWN"}(${code2})`;
        message += `: ${reason}`;
      } catch (error) {
        message += " (could not decode panic code)";
      }
    } else {
      message += " (unknown custom error)";
    }
  }
  const transaction = {
    to: tx.to ? getAddress(tx.to) : null,
    data: tx.data || "0x"
  };
  if (tx.from) {
    transaction.from = getAddress(tx.from);
  }
  return makeError(message, "CALL_EXCEPTION", {
    action,
    data,
    reason,
    transaction,
    invocation,
    revert
  });
}
var AbiCoder = class _AbiCoder {
  #getCoder(param) {
    if (param.isArray()) {
      return new ArrayCoder(this.#getCoder(param.arrayChildren), param.arrayLength, param.name);
    }
    if (param.isTuple()) {
      return new TupleCoder(param.components.map((c) => this.#getCoder(c)), param.name);
    }
    switch (param.baseType) {
      case "address":
        return new AddressCoder(param.name);
      case "bool":
        return new BooleanCoder(param.name);
      case "string":
        return new StringCoder(param.name);
      case "bytes":
        return new BytesCoder(param.name);
      case "":
        return new NullCoder(param.name);
    }
    let match = param.type.match(paramTypeNumber);
    if (match) {
      let size = parseInt(match[2] || "256");
      assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid " + match[1] + " bit length", "param", param);
      return new NumberCoder(size / 8, match[1] === "int", param.name);
    }
    match = param.type.match(paramTypeBytes);
    if (match) {
      let size = parseInt(match[1]);
      assertArgument(size !== 0 && size <= 32, "invalid bytes length", "param", param);
      return new FixedBytesCoder(size, param.name);
    }
    assertArgument(false, "invalid type", "type", param.type);
  }
  /**
   *  Get the default values for the given %%types%%.
   *
   *  For example, a ``uint`` is by default ``0`` and ``bool``
   *  is by default ``false``.
   */
  getDefaultValue(types) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.defaultValue();
  }
  /**
   *  Encode the %%values%% as the %%types%% into ABI data.
   *
   *  @returns DataHexstring
   */
  encode(types, values) {
    assertArgumentCount(values.length, types.length, "types/values length mismatch");
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    const writer = new Writer();
    coder.encode(writer, values);
    return writer.data;
  }
  /**
   *  Decode the ABI %%data%% as the %%types%% into values.
   *
   *  If %%loose%% decoding is enabled, then strict padding is
   *  not enforced. Some older versions of Solidity incorrectly
   *  padded event data emitted from ``external`` functions.
   */
  decode(types, data, loose) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.decode(new Reader(data, loose, defaultMaxInflation));
  }
  static _setDefaultMaxInflation(value) {
    assertArgument(typeof value === "number" && Number.isInteger(value), "invalid defaultMaxInflation factor", "value", value);
    defaultMaxInflation = value;
  }
  /**
   *  Returns the shared singleton instance of a default [[AbiCoder]].
   *
   *  On the first call, the instance is created internally.
   */
  static defaultAbiCoder() {
    if (defaultCoder == null) {
      defaultCoder = new _AbiCoder();
    }
    return defaultCoder;
  }
  /**
   *  Returns an ethers-compatible [[CallExceptionError]] Error for the given
   *  result %%data%% for the [[CallExceptionAction]] %%action%% against
   *  the Transaction %%tx%%.
   */
  static getBuiltinCallException(action, tx, data) {
    return getBuiltinCallException(action, tx, data, _AbiCoder.defaultAbiCoder());
  }
};

// src/protocolSdk.ts
var TERM_FIELD_COUNT = 6;
var ALL_TERMS_COMPUTED_MASK = (1 << TERM_FIELD_COUNT) - 1;
var UINT64_MAX = (1n << 64n) - 1n;
var PreferenceDirection = {
  LowerIsBetter: 0,
  HigherIsBetter: 1,
  TargetIsBest: 2,
  Neutral: 3
};
var Priority = {
  VeryLow: 0,
  Low: 1,
  Normal: 2,
  High: 3,
  Critical: 4
};
var TermFieldName = {
  CollateralAmount: "collateralAmount",
  Principal: "principal",
  CollateralTokenPriceE8: "collateralTokenPriceE8",
  InterestBps: "interestBps",
  DurationDays: "durationDays",
  GracePeriodDays: "gracePeriodDays"
};
var TERM_FIELD_NAMES = [
  TermFieldName.CollateralAmount,
  TermFieldName.Principal,
  TermFieldName.CollateralTokenPriceE8,
  TermFieldName.InterestBps,
  TermFieldName.DurationDays,
  TermFieldName.GracePeriodDays
];
var abiCoder = AbiCoder.defaultAbiCoder();
function fieldPreference(input) {
  const min = toUint64(input.range.min, "range.min");
  const max = toUint64(input.range.max, "range.max");
  const target = toUint64(input.range.target, "range.target");
  if (min > max) {
    throw new Error("range.min must be <= range.max");
  }
  if (target < min || target > max) {
    throw new Error("range.target must be inside [min, max]");
  }
  const direction = input.direction ?? PreferenceDirection.Neutral;
  if (!Object.values(PreferenceDirection).includes(direction)) {
    throw new Error("direction must be a valid PreferenceDirection");
  }
  const priority = input.priority ?? Priority.Normal;
  if (!Object.values(Priority).includes(priority)) {
    throw new Error("priority must be a valid Priority");
  }
  return {
    range: { min, max, target },
    direction,
    priority
  };
}
var PRINCIPAL_CEILING_BUCKETS = [
  50,
  150,
  500,
  1e3,
  5e3,
  1e4,
  25e3,
  5e4,
  1e5,
  25e4,
  5e5
];
var DURATION_CEILING_BUCKETS = [180, 720, 1460, 2190, 3650];
var PRINCIPAL_OVERFLOW_STEP = 25e4;
var DURATION_OVERFLOW_STEP = 365;
var PRICE_SCALE_E8 = 1e8;
var INTEREST_PERCENT_TO_BPS = 100;
var DEFAULT_EXPIRY_DAYS = 30;
var PLAIN_DIRECTION_ENUM = {
  lower_is_better: PreferenceDirection.LowerIsBetter,
  higher_is_better: PreferenceDirection.HigherIsBetter,
  target_is_best: PreferenceDirection.TargetIsBest,
  neutral: PreferenceDirection.Neutral
};
function principalBucketLabel(max) {
  return bucketLabel("P", max, PRINCIPAL_CEILING_BUCKETS, PRINCIPAL_OVERFLOW_STEP, "principal max");
}
function durationBucketLabel(max) {
  return bucketLabel("D", max, DURATION_CEILING_BUCKETS, DURATION_OVERFLOW_STEP, "duration max");
}
function impliedCollateralPrice(principal, collateral, side) {
  requirePlainSide(side);
  const min = principal.min / Math.max(1, collateral.max);
  const max = principal.max / Math.max(1, collateral.min);
  const target = principal.target / Math.max(1, collateral.target);
  return {
    range: {
      min: roundPrice(min),
      max: roundPrice(max),
      target: roundPrice(Math.min(max, Math.max(min, target)))
    },
    direction: side === "borrower" ? "higher_is_better" : "lower_is_better"
  };
}
function defaultsForSide(side) {
  requirePlainSide(side);
  const borrower = side === "borrower";
  return {
    directions: {
      collateralAmount: borrower ? "lower_is_better" : "higher_is_better",
      principal: borrower ? "higher_is_better" : "target_is_best",
      interestPercent: borrower ? "lower_is_better" : "higher_is_better",
      durationDays: borrower ? "higher_is_better" : "lower_is_better",
      gracePeriodDays: borrower ? "higher_is_better" : "lower_is_better"
    },
    priorities: { collateralAmount: 4, principal: 5, interestPercent: 5, durationDays: 3, gracePeriodDays: 3 },
    gracePeriodDays: { min: 0, max: 15, target: 7 },
    expiryDays: DEFAULT_EXPIRY_DAYS
  };
}
function toContractFields(plain) {
  requirePlainSide(plain.side);
  const defaults = defaultsForSide(plain.side);
  const resolve = (name, scale) => {
    const field = plain[name];
    return scaledField(
      name,
      field.range,
      scale,
      field.direction ?? defaults.directions[name],
      field.priority ?? defaults.priorities[name]
    );
  };
  const collateralAmount = resolve("collateralAmount", 1);
  const principal = resolve("principal", 1);
  const price = impliedCollateralPrice(plain.principal.range, plain.collateralAmount.range, plain.side);
  return {
    collateralAmount,
    principal,
    collateralTokenPriceE8: scaledField(
      "collateralTokenPriceE8",
      price.range,
      PRICE_SCALE_E8,
      price.direction,
      plain.collateralAmount.priority ?? defaults.priorities.collateralAmount
    ),
    interestBps: resolve("interestPercent", INTEREST_PERCENT_TO_BPS),
    durationDays: resolve("durationDays", 1),
    gracePeriodDays: resolve("gracePeriodDays", 1)
  };
}
function canonicalBundleHash(plain) {
  const fields = toContractFields(plain);
  const expiryDays = plain.expiryDays;
  if (!Number.isSafeInteger(expiryDays) || expiryDays <= 0) {
    throw new Error("expiryDays must be a positive integer");
  }
  requireBytes32(plain.backingId, "backingId");
  const canonical = [
    "cvc:bundle:v1",
    plain.side,
    getAddress(plain.collateralToken),
    getAddress(plain.tokenOpsManager),
    principalBucketLabel(plain.principal.range.max),
    durationBucketLabel(plain.durationDays.range.max),
    String(expiryDays),
    plain.backingId.toLowerCase(),
    ...TERM_FIELD_NAMES.map((name) => {
      const field = fields[name];
      return [
        name,
        field.range.min.toString(),
        field.range.max.toString(),
        field.range.target.toString(),
        field.direction,
        field.priority
      ];
    })
  ];
  return keccak256(toUtf8Bytes(JSON.stringify(canonical)));
}
function bucketLabel(prefix, max, fixed, overflowStep, label) {
  const value = typeof max === "bigint" ? Number(max) : max;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  const ceiling = fixed.find((candidate) => value <= candidate) ?? Math.ceil(value / overflowStep) * overflowStep;
  return `${prefix}<${String(ceiling).padStart(6, "0")}`;
}
function scaledField(label, range2, scale, direction, priority) {
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw new Error(`${label} priority must be an integer 1..5`);
  }
  const directionEnum = PLAIN_DIRECTION_ENUM[direction];
  if (directionEnum === void 0) {
    throw new Error(`${label} direction must be a valid direction`);
  }
  return fieldPreference({
    range: {
      min: scaleToBigInt(range2.min, scale, `${label}.range.min`),
      max: scaleToBigInt(range2.max, scale, `${label}.range.max`),
      target: scaleToBigInt(range2.target, scale, `${label}.range.target`)
    },
    direction: directionEnum,
    priority: priority - 1
  });
}
function scaleToBigInt(value, scale, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return BigInt(Math.round(value * scale));
}
function roundPrice(value) {
  return Math.round(value * 1e4) / 1e4;
}
function requirePlainSide(side) {
  if (side !== "borrower" && side !== "lender") {
    throw new Error("side must be borrower or lender");
  }
}
function requireBytes32(value, label) {
  if (!isHexString(value, 32) || value === "0x" + "00".repeat(32)) {
    throw new Error(`${label} must be a nonzero bytes32`);
  }
}
function toUint64(value, label) {
  const normalized = toNonNegativeBigInt(value, label);
  if (normalized > UINT64_MAX) {
    throw new Error(`${label} must fit uint64`);
  }
  return normalized;
}
function toNonNegativeBigInt(value, label) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

// src/intent/reducer.ts
function validValue(slot, value) {
  if (slot === "side") return value === "borrower" || value === "lender";
  if (slot === "intent") return value === "atp_deposit" || value === "atp_withdraw";
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function normalize(draft) {
  const slots = { ...draft.slots };
  for (const field of BUNDLE_FIELDS) {
    const [min, max, target] = ["min", "max", "target"].map((b2) => slots[fieldSlot(field, b2)]);
    if (min && max && (!target || target.source === "derived")) {
      const mid = Math.round((Number(min.value) + Number(max.value)) / 2 * 1e4) / 1e4;
      slots[fieldSlot(field, "target")] = { value: mid, source: "derived" };
    } else if (target?.source === "derived" && !(min && max)) {
      delete slots[fieldSlot(field, "target")];
    }
  }
  const side = slots.side?.value;
  if (side && !slots.intent) {
    const grace = defaultsForSide(side).gracePeriodDays;
    for (const bound of ["min", "max", "target"]) {
      const key = fieldSlot("gracePeriodDays", bound);
      if (!slots[key] || slots[key]?.source === "default") slots[key] = { value: grace[bound], source: "default" };
    }
  }
  return { ...draft, slots };
}
function reduce(draft, event) {
  switch (event.type) {
    case "reset":
      return emptyDraft();
    case "candidates": {
      const slots = { ...draft.slots };
      const unresolved = [];
      for (const c of event.candidates) {
        if (!c.slot) {
          unresolved.push(c);
        } else if (validValue(c.slot, c.value) && c.span) {
          slots[c.slot] = { value: c.value, source: c.unitFactor !== 1 ? "derived" : "stated", span: c.span };
        }
      }
      return normalize({ slots, unresolved });
    }
    case "set": {
      if (!validValue(event.slot, event.value)) return draft;
      const slots = { ...draft.slots, [event.slot]: { value: event.value, source: event.source ?? "picked" } };
      return normalize({ ...draft, slots });
    }
    case "set_many": {
      const slots = { ...draft.slots };
      for (const { slot, value } of event.entries) {
        if (validValue(slot, value)) slots[slot] = { value, source: "picked" };
      }
      return normalize({ ...draft, slots });
    }
    case "assign_unresolved": {
      const c = draft.unresolved[event.index];
      if (!c || typeof c.value !== "number" || !validValue(event.slot, c.value)) return draft;
      const slots = { ...draft.slots, [event.slot]: { value: c.value, source: "picked", span: c.span } };
      return normalize({ slots, unresolved: draft.unresolved.filter((_, i) => i !== event.index) });
    }
    case "clear": {
      const slots = { ...draft.slots };
      delete slots[event.slot];
      return normalize({ ...draft, slots });
    }
  }
}
function draftIntent(draft) {
  const intent = draft.slots.intent?.value;
  if (intent) return intent;
  return draft.slots.side ? "bundle" : null;
}

// src/intent/policy.ts
var FIELD_LABELS = {
  principal: { label: "loan amount", unit: "USDC" },
  collateralAmount: { label: "collateral amount", unit: "tokens" },
  interestPercent: { label: "interest rate", unit: "%" },
  durationDays: { label: "duration", unit: "days" },
  gracePeriodDays: { label: "grace period", unit: "days" }
};
var fmt = (n2) => n2.toLocaleString("en-US", { maximumFractionDigits: 4 });
var num = (draft, key) => {
  const v = draft.slots[key]?.value;
  return typeof v === "number" ? v : void 0;
};
function validateDraft(draft) {
  const issues = [];
  for (const field of BUNDLE_FIELDS) {
    const min = num(draft, fieldSlot(field, "min"));
    const max = num(draft, fieldSlot(field, "max"));
    const target = num(draft, fieldSlot(field, "target"));
    const { label } = FIELD_LABELS[field];
    if (min !== void 0 && max !== void 0 && min > max) {
      issues.push({
        slot: fieldSlot(field, "min"),
        message: `The minimum ${label} (${fmt(min)}) is above the maximum (${fmt(max)}).`
      });
    } else if (target !== void 0 && (min !== void 0 && target < min || max !== void 0 && target > max)) {
      issues.push({
        slot: fieldSlot(field, "target"),
        message: `The target ${label} (${fmt(target)}) is outside your range.`
      });
    }
  }
  return issues;
}
function verb(side) {
  return side === "lender" ? "lend" : "borrow";
}
function ask(field, draft, side) {
  const { label, unit } = FIELD_LABELS[field];
  const min = fieldSlot(field, "min");
  const max = fieldSlot(field, "max");
  const target = fieldSlot(field, "target");
  const vMin = num(draft, min);
  const vMax = num(draft, max);
  const vTarget = num(draft, target);
  if (vMin !== void 0 && vMax !== void 0) return null;
  const subject = field === "principal" ? `How much do you want to ${verb(side)}` : `What ${label} do you want`;
  if (vMin === void 0 && vMax === void 0 && vTarget === void 0) {
    return { done: false, slot: target, question: `${subject}? (${unit})`, quickReplies: [] };
  }
  if (vMin === void 0 && vMax === void 0 && vTarget !== void 0) {
    return {
      done: false,
      slot: min,
      question: `${label[0].toUpperCase()}${label.slice(1)}: about ${fmt(vTarget)}. Exact, or a range?`,
      quickReplies: [
        {
          label: `Exactly ${fmt(vTarget)}`,
          event: {
            type: "set_many",
            entries: [
              { slot: min, value: vTarget },
              { slot: max, value: vTarget }
            ]
          }
        }
      ]
    };
  }
  if (vMax !== void 0) {
    return {
      done: false,
      slot: min,
      question: `Lowest ${label}? (${unit})`,
      quickReplies: [{ label: `Same as the highest (${fmt(vMax)})`, event: { type: "set", slot: min, value: vMax } }]
    };
  }
  return {
    done: false,
    slot: max,
    question: `Highest ${label}? (${unit})`,
    quickReplies: [
      {
        label: `Same as the lowest (${fmt(vMin)})`,
        event: { type: "set", slot: max, value: vMin }
      }
    ]
  };
}
function describeDraft(draft) {
  const intent = draftIntent(draft);
  const lines = [];
  if (intent === "atp_deposit" || intent === "atp_withdraw") {
    const amount = draft.slots.amount;
    lines.push(
      `${intent === "atp_deposit" ? "Deposit into" : "Withdraw from"} ATP: ${fmt(Number(amount?.value))} USDC (${amount?.source})`
    );
    return lines;
  }
  lines.push(`Side: ${draft.slots.side?.value} (${draft.slots.side?.source})`);
  for (const field of BUNDLE_FIELDS) {
    const min = draft.slots[fieldSlot(field, "min")];
    const max = draft.slots[fieldSlot(field, "max")];
    const target = draft.slots[fieldSlot(field, "target")];
    if (!min || !max || !target) continue;
    const { label, unit } = FIELD_LABELS[field];
    const sources = /* @__PURE__ */ new Set([min.source, max.source, target.source]);
    lines.push(
      `${label}: ${fmt(Number(min.value))} to ${fmt(Number(max.value))} ${unit}, target ${fmt(Number(target.value))} (${[...sources].join(", ")})`
    );
  }
  return lines;
}
function nextTurn(draft) {
  const issue = validateDraft(draft)[0];
  if (issue) {
    return {
      done: false,
      slot: issue.slot,
      question: `${issue.message} Which one should change?`,
      quickReplies: [{ label: "Clear it and re-enter", event: { type: "clear", slot: issue.slot } }]
    };
  }
  const unknown = draft.unresolved.findIndex((c) => c.reason === "unknown_field");
  if (unknown >= 0) {
    const c = draft.unresolved[unknown];
    const bound = c.bound ?? "target";
    return {
      done: false,
      slot: null,
      question: `What is "${c.span.text}"?`,
      quickReplies: BUNDLE_FIELDS.map((field) => ({
        label: FIELD_LABELS[field].label,
        event: { type: "assign_unresolved", index: unknown, slot: fieldSlot(field, bound) }
      }))
    };
  }
  const intent = draftIntent(draft);
  if (intent === null) {
    return {
      done: false,
      slot: "side",
      question: "What would you like to do?",
      quickReplies: [
        { label: "Borrow", event: { type: "set", slot: "side", value: "borrower" } },
        { label: "Lend", event: { type: "set", slot: "side", value: "lender" } },
        { label: "Deposit into ATP", event: { type: "set", slot: "intent", value: "atp_deposit" } },
        { label: "Withdraw from ATP", event: { type: "set", slot: "intent", value: "atp_withdraw" } }
      ]
    };
  }
  if (intent === "atp_deposit" || intent === "atp_withdraw") {
    if (num(draft, "amount") === void 0) {
      return {
        done: false,
        slot: "amount",
        question: `How much do you want to ${intent === "atp_deposit" ? "deposit" : "withdraw"}? (USDC)`,
        quickReplies: []
      };
    }
    return { done: true, summary: describeDraft(draft) };
  }
  const side = draft.slots.side?.value;
  for (const field of ASKED_FIELDS) {
    const turn = ask(field, draft, side);
    if (turn) return turn;
  }
  return { done: true, summary: describeDraft(draft) };
}

// src/intent/bundle.ts
function range(draft, field) {
  const get = (b2) => Number(draft.slots[fieldSlot(field, b2)]?.value);
  return { range: { min: get("min"), max: get("max"), target: get("target") } };
}
function toTerms(draft, expiryDays) {
  if (draftIntent(draft) !== "bundle") throw new Error("draft is not a bundle");
  const turn = nextTurn(draft);
  if (!turn.done) throw new Error(`draft is incomplete: ${turn.question}`);
  const side = draft.slots.side?.value;
  const [principal, collateralAmount, interestPercent, durationDays] = ASKED_FIELDS.map((f) => range(draft, f));
  return {
    side,
    expiryDays: expiryDays ?? defaultsForSide(side).expiryDays,
    collateralAmount,
    principal,
    interestPercent,
    durationDays,
    gracePeriodDays: range(draft, "gracePeriodDays")
  };
}
function toAtpIntent(draft) {
  const kind = draftIntent(draft);
  if (kind !== "atp_deposit" && kind !== "atp_withdraw") throw new Error("draft is not an ATP intent");
  const amount = draft.slots.amount?.value;
  if (typeof amount !== "number" || amount <= 0) throw new Error("ATP amount is missing");
  return { kind, amount };
}

// src/intent/index.ts
function applyMessage(draft, text, context = {}) {
  const { accepted } = verifyAll(text, extract(text, context));
  return reduce(draft, { type: "candidates", candidates: accepted });
}

// src/skill/cli.ts
var BUNDLE_FORMAT = "cvc-bundle/1";
var ATP_FORMAT = "cvc-atp-intent/1";
var USAGE = `tdh-bundle: draft a Discount House bundle one question at a time.

  init   --draft FILE                       start a new draft
  say    --draft FILE --text "..."          apply the user's exact words, then print the next question
  reply  --draft FILE --index N             apply quick reply N (0-based) from the last question
  status --draft FILE                       print the next question or the recap
  emit   --draft FILE --out FILE            write the bundle JSON once the draft is complete
         [--collateral-token 0x.. --manager 0x.. --backing-id 0x..  [--expiry-days N]]

Exit codes: 0 ok, 1 usage or input error, 2 the draft is not complete yet.`;
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument "${arg}"`);
    const value = rest[i + 1];
    if (value === void 0 || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    flags[arg.slice(2)] = value;
    i++;
  }
  return { command, flags };
}
function need(flags, name) {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
function load(path) {
  if (!(0, import_node_fs.existsSync)(path)) throw new Error(`no draft at ${path}; run init first`);
  const state = JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  if (state.version !== 1 || typeof state.draft?.slots !== "object" || !Array.isArray(state.draft.unresolved)) {
    throw new Error(`${path} is not a draft file`);
  }
  return state;
}
function save(path, state) {
  (0, import_node_fs.writeFileSync)(path, JSON.stringify(state, null, 2) + "\n");
}
function turnView(turn) {
  if (turn.done) return { done: true, recap: turn.summary };
  return {
    done: false,
    slot: turn.slot,
    question: turn.question,
    quickReplies: turn.quickReplies.map((r, index) => ({ index, label: r.label }))
  };
}
function provenance(draft) {
  return Object.fromEntries(
    Object.entries(draft.slots).map(([slot, v]) => [
      slot,
      { source: v.source, ...v.span ? { span: v.span.text } : {} }
    ])
  );
}
function run(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    return { code: 1, output: { error: err.message, usage: USAGE } };
  }
  const { command, flags } = parsed;
  try {
    switch (command) {
      case "init": {
        const state = { version: 1, draft: emptyDraft() };
        const turn = nextTurn(state.draft);
        state.expecting = turn.done ? void 0 : turn.slot ?? void 0;
        save(need(flags, "draft"), state);
        return { code: 0, output: { turn: turnView(turn) } };
      }
      case "say": {
        const path = need(flags, "draft");
        const text = need(flags, "text");
        const state = load(path);
        const context = {
          expecting: state.expecting,
          side: state.draft.slots.side?.value,
          intent: state.draft.slots.intent?.value
        };
        const { rejected } = verifyAll(text, extract(text, context));
        state.draft = applyMessage(state.draft, text, context);
        const turn = nextTurn(state.draft);
        state.expecting = turn.done ? void 0 : turn.slot ?? void 0;
        save(path, state);
        return {
          code: 0,
          output: {
            rejected: rejected.map((r) => ({ text: r.candidate.span.text, reason: r.reason })),
            understood: Object.keys(state.draft.slots).length,
            turn: turnView(turn)
          }
        };
      }
      case "reply": {
        const path = need(flags, "draft");
        const index = Number(need(flags, "index"));
        const state = load(path);
        const turn = nextTurn(state.draft);
        const reply = turn.done ? void 0 : turn.quickReplies[index];
        if (!Number.isInteger(index) || !reply)
          throw new Error(`no quick reply ${flags.index} for the current question`);
        state.draft = reduce(state.draft, reply.event);
        const next = nextTurn(state.draft);
        state.expecting = next.done ? void 0 : next.slot ?? void 0;
        save(path, state);
        return { code: 0, output: { applied: reply.label, turn: turnView(next) } };
      }
      case "status": {
        const state = load(need(flags, "draft"));
        return { code: 0, output: { turn: turnView(nextTurn(state.draft)) } };
      }
      case "emit": {
        const state = load(need(flags, "draft"));
        const out = need(flags, "out");
        const turn = nextTurn(state.draft);
        if (!turn.done) return { code: 2, output: { error: "the draft is not complete", turn: turnView(turn) } };
        const kind = draftIntent(state.draft);
        if (kind === "atp_deposit" || kind === "atp_withdraw") {
          const intent = toAtpIntent(state.draft);
          const file2 = {
            format: ATP_FORMAT,
            intent,
            recap: describeDraft(state.draft),
            provenance: provenance(state.draft)
          };
          (0, import_node_fs.writeFileSync)(out, JSON.stringify(file2, null, 2) + "\n");
          return { code: 0, output: { wrote: out, format: ATP_FORMAT, recap: file2.recap } };
        }
        const expiry = flags["expiry-days"] ? Number(flags["expiry-days"]) : void 0;
        const terms = toTerms(state.draft, expiry);
        const given = ["collateral-token", "manager", "backing-id"].filter((f) => flags[f]);
        if (given.length !== 0 && given.length !== 3) {
          throw new Error("give all of --collateral-token, --manager and --backing-id, or none of them");
        }
        const wallet = given.length === 3 ? {
          collateralToken: flags["collateral-token"],
          tokenOpsManager: flags.manager,
          backingId: flags["backing-id"]
        } : null;
        const hash = wallet ? canonicalBundleHash({ ...terms, ...wallet }) : null;
        const file = {
          format: BUNDLE_FORMAT,
          terms,
          wallet,
          hash,
          recap: describeDraft(state.draft),
          provenance: provenance(state.draft)
        };
        (0, import_node_fs.writeFileSync)(out, JSON.stringify(file, null, 2) + "\n");
        return {
          code: 0,
          output: {
            wrote: out,
            format: BUNDLE_FORMAT,
            hash,
            note: wallet ? "Hash covers the wallet fields given. The review page recomputes it before anything is signed." : "No wallet fields given, so there is no hash yet. The review page adds them from the connected wallet and computes it.",
            recap: file.recap
          }
        };
      }
      default:
        return {
          code: command ? 1 : 0,
          output: command ? { error: `unknown command "${command}"`, usage: USAGE } : { usage: USAGE }
        };
    }
  } catch (err) {
    return { code: 1, output: { error: err.message } };
  }
}

// src/skill/cli-main.ts
var { code, output: output2 } = run(process.argv.slice(2));
process.stdout.write(JSON.stringify(output2, null, 2) + "\n");
process.exitCode = code;
