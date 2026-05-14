// ============================
// SCTE-35 PARSER
// Zero-dependency browser tool
// Per ANSI/SCTE-35 2024
// ============================

// ============================
// SAMPLES
// ============================

const SAMPLES = [
  {
    label: "Splice Insert (Out)",
    data: "/DAlAAAAAAAAAP/wFAUAAAABf+/+ANgNkv4AFRogAAEBAQAAN7cP5g=="
  },
  {
    label: "Splice Insert (In)",
    data: "/DAhAAAAAAAAAP/wEAUAAAABf+//ANgNkv4AAUEBAAALKUM0"
  },
  {
    label: "Time Signal + Segmentation",
    data: "/DAvAAAAAAAAAP/wBQb+AAAAAAAnAiVDVUVJAAAAAX//AAApMuAICAAAAAAj6XkIFQAAABsAAACkiwNf"
  },
  {
    label: "Splice Null",
    data: "/DARAAAAAAAAAP/wAAAAAHpPv/8="
  },
  {
    label: "Bandwidth Reservation",
    data: "/DAdAAAAAAAAAP/wCgUAAAABf8AAAAAAAN0VHiQ="
  },
  {
    label: "HLS Tag (EXT-X-SCTE35)",
    data: '#EXT-X-SCTE35:CUE="/DAlAAAAAAAAAP/wFAUAAAABf+/+ANgNkv4AFRogAAEBAQAAN7cP5g=="'
  },
  {
    label: "HLS DATERANGE",
    data: '#EXT-X-DATERANGE:ID="splice-123",SCTE35-OUT=0xFC302500000000000000FFF01405000000017FEFFE00D80D92FE001528200001010100003BB70FE6'
  },
  {
    label: "Hex Input",
    data: "FC302500000000000000FFF01405000000017FEFFE00D80D92FE001528200001010100003BB70FE6"
  },
];

// ============================
// SCTE-35 CONSTANTS
// ============================

const SPLICE_COMMAND_TYPES = {
  0x00: "splice_null",
  0x04: "splice_schedule",
  0x05: "splice_insert",
  0x06: "time_signal",
  0x07: "bandwidth_reservation",
  0xff: "private_command",
};

const SEGMENTATION_TYPE_IDS = {
  0x00: "Not Indicated",
  0x01: "Content Identification",
  0x10: "Program Start",
  0x11: "Program End",
  0x12: "Program Early Termination",
  0x13: "Program Breakaway",
  0x14: "Program Resumption",
  0x15: "Program Runover Planned",
  0x16: "Program Runover Unplanned",
  0x17: "Program Overlap Start",
  0x20: "Chapter Start",
  0x21: "Chapter End",
  0x22: "Break Start",      // Provider Ad Start
  0x23: "Break End",        // Provider Ad End
  0x24: "Provider Ad Start",
  0x25: "Provider Ad End",
  0x26: "Distributor Ad Start",
  0x27: "Distributor Ad End",
  0x30: "Provider Placement Opportunity Start",
  0x31: "Provider Placement Opportunity End",
  0x32: "Distributor Placement Opportunity Start",
  0x33: "Distributor Placement Opportunity End",
  0x34: "Provider Overlay Placement Opportunity Start",
  0x35: "Provider Overlay Placement Opportunity End",
  0x36: "Distributor Overlay Placement Opportunity Start",
  0x37: "Distributor Overlay Placement Opportunity End",
  0x40: "Unscheduled Event Start",
  0x41: "Unscheduled Event End",
  0x42: "Alternate Content Opportunity Start",
  0x43: "Alternate Content Opportunity End",
  0x44: "Provider Ad Block Start",
  0x45: "Provider Ad Block End",
  0x46: "Distributor Ad Block Start",
  0x47: "Distributor Ad Block End",
  0x50: "Network Start",
  0x51: "Network End",
};

const SEGMENTATION_UPID_TYPES = {
  0x00: "Not Used",
  0x01: "User Defined (Deprecated)",
  0x02: "ISCI (Deprecated)",
  0x03: "Ad-ID",
  0x04: "UMID (SMPTE 330M)",
  0x05: "ISAN (Deprecated)",
  0x06: "ISAN",
  0x07: "TID (Tribune)",
  0x08: "TI (Turner Identifier)",
  0x09: "ADI (CableLabs)",
  0x0a: "EIDR",
  0x0b: "ATSC Content Identifier",
  0x0c: "MPU()",
  0x0d: "MID()",
  0x0e: "ADS Information",
  0x0f: "URI",
  0x10: "UUID",
};

// ============================
// BIT READER
// ============================

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bytePos = 0;
    this.bitPos = 0;
  }

  readBits(n) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (this.bytePos >= this.bytes.length) throw new Error("Read past end of data at byte " + this.bytePos);
      const bit = (this.bytes[this.bytePos] >> (7 - this.bitPos)) & 1;
      result = (result << 1) | bit;
      this.bitPos++;
      if (this.bitPos === 8) { this.bitPos = 0; this.bytePos++; }
    }
    return result >>> 0;
  }

  readBool() { return this.readBits(1) === 1; }

  readBytes(n) {
    if (this.bitPos !== 0) throw new Error("readBytes called on non-byte boundary");
    const result = this.bytes.slice(this.bytePos, this.bytePos + n);
    this.bytePos += n;
    return result;
  }

  skip(n) { for (let i = 0; i < n; i++) { this.bitPos++; if (this.bitPos === 8) { this.bitPos = 0; this.bytePos++; } } }

  get position() { return this.bytePos * 8 + this.bitPos; }
  get bytesLeft() { return this.bytes.length - this.bytePos - (this.bitPos > 0 ? 1 : 0); }

  readUint33() {
    // PTS is 33-bit: read as two parts to avoid JS integer issues
    const hi = this.readBits(1);
    const lo = this.readBits(32);
    return hi * 0x100000000 + lo;
  }

  readUint40() {
    // 40-bit unsigned integer (e.g., segmentation_duration)
    const hi = this.readBits(8);
    const lo = this.readBits(32);
    return hi * 0x100000000 + lo;
  }
}

// ============================
// HELPERS
// ============================

function base64ToBytes(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex) {
  hex = hex.replace(/\s/g, "").replace(/^0x/i, "");
  if (hex.length % 2 !== 0) throw new Error("Hex string has odd length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    if (isNaN(b)) throw new Error("Invalid hex at position " + i);
    bytes[i / 2] = b;
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function ptsToSeconds(pts) {
  return pts / 90000;
}

function formatPTS(pts) {
  const secs = ptsToSeconds(pts);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = (secs % 60).toFixed(3);
  return h.toString().padStart(2, "0") + ":" + m.toString().padStart(2, "0") + ":" + s.padStart(6, "0");
}

function formatDuration(ticks90k) {
  const secs = ticks90k / 90000;
  if (secs >= 60) return Math.floor(secs / 60) + "m " + (secs % 60).toFixed(3) + "s";
  return secs.toFixed(3) + "s";
}

function crc32Mpeg2(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 24;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x80000000) crc = ((crc << 1) ^ 0x04C11DB7) >>> 0;
      else crc = (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

// ============================
// INPUT EXTRACTION
// ============================

function extractSCTE35Data(input) {
  input = input.trim();

  // HLS #EXT-X-SCTE35 CUE tag
  const cueMatch = input.match(/CUE="([^"]+)"/i) || input.match(/CUE='([^']+)'/i);
  if (cueMatch) return { type: "base64", data: cueMatch[1], source: "HLS #EXT-X-SCTE35 CUE" };

  // HLS #EXT-X-DATERANGE SCTE35-OUT or SCTE35-IN
  const drMatch = input.match(/SCTE35-(?:OUT|IN|CMD)\s*=\s*0x([0-9a-fA-F]+)/i);
  if (drMatch) return { type: "hex", data: drMatch[1], source: "HLS #EXT-X-DATERANGE" };

  // HLS #EXT-OATCLS-SCTE35 or #EXT-X-CUE-OUT / CUE-IN with inline base64
  const inlineB64 = input.match(/#EXT-[A-Z0-9-]+:(.+)/);
  if (inlineB64) {
    const val = inlineB64[1].trim();
    if (/^[A-Za-z0-9+/=]+$/.test(val) && val.length > 10) {
      return { type: "base64", data: val, source: "HLS inline tag" };
    }
  }

  // DASH EventStream — look for base64 in element text
  const xmlB64 = input.match(/>([A-Za-z0-9+/=]{10,})</);
  if (xmlB64) return { type: "base64", data: xmlB64[1], source: "DASH EventStream XML" };

  // Pure hex (with optional 0x prefix)
  const hexClean = input.replace(/^0x/i, "").replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length >= 10 && hexClean.length % 2 === 0) {
    // Check if it starts with 0xFC (table_id for SCTE-35)
    if (hexClean.substring(0, 2).toUpperCase() === "FC") {
      return { type: "hex", data: hexClean, source: "Hex" };
    }
  }

  // Base64
  const b64Clean = input.replace(/\s/g, "");
  if (/^[A-Za-z0-9+/]+=*$/.test(b64Clean) && b64Clean.length >= 8) {
    try {
      atob(b64Clean);
      return { type: "base64", data: b64Clean, source: "Base64" };
    } catch {}
  }

  // Fallback: try hex without FC check
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length >= 10 && hexClean.length % 2 === 0) {
    return { type: "hex", data: hexClean, source: "Hex" };
  }

  return null;
}

// ============================
// SCTE-35 PARSER
// ============================

function parseSpliceInfoSection(bytes) {
  const reader = new BitReader(bytes);
  const result = { raw: bytesToHex(bytes), length: bytes.length, fields: [], regions: [] };

  // table_id (8 bits) — must be 0xFC
  const tableId = reader.readBits(8);
  result.fields.push({ label: "table_id", value: "0x" + tableId.toString(16).padStart(2, "0") + " (" + tableId + ")", note: tableId === 0xFC ? "SCTE-35" : "INVALID (expected 0xFC)" });
  result.regions.push({ start: 0, end: 1, label: "table_id", color: "#4caf50" });
  if (tableId !== 0xFC) {
    result.error = "Invalid table_id: 0x" + tableId.toString(16) + " (expected 0xFC)";
    return result;
  }

  // section_syntax_indicator (1), private_indicator (1), sap_type (2), section_length (12)
  const ssi = reader.readBool();
  const privateInd = reader.readBool();
  const sapType = reader.readBits(2);
  const sectionLength = reader.readBits(12);
  result.fields.push({ label: "section_syntax_indicator", value: ssi ? "1" : "0", note: ssi ? "⚠ Should be 0" : "" });
  result.fields.push({ label: "private_indicator", value: privateInd ? "1" : "0" });
  result.fields.push({ label: "sap_type", value: sapType.toString() });
  result.fields.push({ label: "section_length", value: sectionLength + " bytes" });
  result.regions.push({ start: 1, end: 3, label: "flags+length", color: "#2196f3" });

  // protocol_version (8)
  const protocolVersion = reader.readBits(8);
  result.fields.push({ label: "protocol_version", value: protocolVersion.toString() });

  // encrypted_packet (1), encryption_algorithm (6), pts_adjustment (33)
  const encrypted = reader.readBool();
  const encAlgorithm = reader.readBits(6);
  const ptsAdjustment = reader.readUint33();
  result.fields.push({ label: "encrypted_packet", value: encrypted ? "Yes" : "No" });
  if (encrypted) result.fields.push({ label: "encryption_algorithm", value: encAlgorithm.toString() });
  result.fields.push({ label: "pts_adjustment", value: "0x" + ptsAdjustment.toString(16).padStart(9, "0") + " (" + ptsAdjustment + ")", note: formatPTS(ptsAdjustment) + " (" + ptsToSeconds(ptsAdjustment).toFixed(6) + "s)" });
  result.regions.push({ start: 3, end: 8, label: "header", color: "#ff9800" });

  // cw_index (8)
  const cwIndex = reader.readBits(8);
  result.fields.push({ label: "cw_index", value: "0x" + cwIndex.toString(16).padStart(2, "0") + " (" + cwIndex + ")" });

  // tier (12)
  const tier = reader.readBits(12);
  result.fields.push({ label: "tier", value: "0x" + tier.toString(16).padStart(3, "0") + " (" + tier + ")", note: tier === 0xFFF ? "No tier restriction" : "" });

  // splice_command_length (12)
  const spliceCommandLength = reader.readBits(12);
  result.fields.push({ label: "splice_command_length", value: spliceCommandLength === 0xFFF ? "0xFFF (unspecified)" : spliceCommandLength.toString() });
  result.regions.push({ start: 8, end: 11, label: "cw+tier+cmd_len", color: "#9c27b0" });

  // splice_command_type (8)
  const spliceCommandType = reader.readBits(8);
  const commandName = SPLICE_COMMAND_TYPES[spliceCommandType] || "unknown (0x" + spliceCommandType.toString(16) + ")";
  result.fields.push({ label: "splice_command_type", value: "0x" + spliceCommandType.toString(16).padStart(2, "0") + " (" + spliceCommandType + ")", note: commandName });
  result.commandType = spliceCommandType;
  result.commandName = commandName;

  const cmdStartByte = reader.bytePos;

  // Parse splice command
  try {
    if (spliceCommandType === 0x00) {
      result.command = { type: "splice_null" };
    } else if (spliceCommandType === 0x05) {
      result.command = parseSpliceInsert(reader);
    } else if (spliceCommandType === 0x06) {
      result.command = parseTimeSignal(reader);
    } else if (spliceCommandType === 0x07) {
      result.command = { type: "bandwidth_reservation" };
    } else if (spliceCommandType === 0xff) {
      result.command = parsePrivateCommand(reader, spliceCommandLength);
    } else if (spliceCommandType === 0x04) {
      if (spliceCommandLength !== 0xFFF) {
        reader.skip(spliceCommandLength * 8);
      }
      result.command = { type: "splice_schedule", note: "Splice schedule parsing — fields skipped" };
    } else {
      if (spliceCommandLength !== 0xFFF && spliceCommandLength > 0) {
        reader.skip(spliceCommandLength * 8);
      }
      result.command = { type: "unknown" };
    }
  } catch (e) {
    result.command = { type: commandName, fields: [{ label: "error", value: "Failed to parse command: " + e.message }] };
    // Try to advance reader to where descriptors start
    if (spliceCommandLength !== 0xFFF && spliceCommandLength > 0) {
      const expectedPos = (cmdStartByte + spliceCommandLength) * 8;
      const currentPos = reader.bytePos * 8 + reader.bitPos;
      if (expectedPos > currentPos) reader.skip(expectedPos - currentPos);
    }
  }

  const cmdEndByte = reader.bytePos;
  result.regions.push({ start: cmdStartByte - 1, end: cmdEndByte, label: "splice_command", color: "#e91e63" });

  // descriptor_loop_length (16)
  let descriptorLoopLength = 0;
  if (reader.bytesLeft >= 2) {
    descriptorLoopLength = reader.readBits(16);
    result.fields.push({ label: "descriptor_loop_length", value: descriptorLoopLength.toString() });
  }

  // Parse descriptors
  result.descriptors = [];
  const descStart = reader.bytePos;
  const descEnd = descStart + descriptorLoopLength;
  while (reader.bytePos < descEnd && reader.bytesLeft > 0) {
    try {
      const desc = parseDescriptor(reader);
      result.descriptors.push(desc);
    } catch (e) {
      result.descriptors.push({ error: "Failed to parse descriptor: " + e.message });
      break;
    }
  }

  if (descriptorLoopLength > 0) {
    result.regions.push({ start: descStart, end: Math.min(descEnd, bytes.length), label: "descriptors", color: "#00bcd4" });
  }

  // CRC_32 (last 4 bytes)
  if (bytes.length >= 4) {
    const crcBytes = bytes.slice(bytes.length - 4);
    const crcValue = (crcBytes[0] << 24 | crcBytes[1] << 16 | crcBytes[2] << 8 | crcBytes[3]) >>> 0;
    const computed = crc32Mpeg2(bytes.slice(0, bytes.length - 4));
    const valid = crcValue === computed;
    result.fields.push({
      label: "CRC_32",
      value: "0x" + crcValue.toString(16).padStart(8, "0") + " (" + crcValue + ")",
      note: valid ? "✓ Valid" : "✗ Invalid (expected 0x" + computed.toString(16).padStart(8, "0") + ")"
    });
    result.crcValid = valid;
    result.regions.push({ start: bytes.length - 4, end: bytes.length, label: "CRC_32", color: "#607d8b" });
  }

  return result;
}

// ============================
// SPLICE INSERT
// ============================

function parseSpliceInsert(reader) {
  const cmd = { type: "splice_insert", fields: [] };

  const spliceEventId = reader.readBits(32);
  cmd.fields.push({ label: "splice_event_id", value: "0x" + spliceEventId.toString(16).padStart(8, "0") + " (" + spliceEventId + ")" });
  cmd.spliceEventId = spliceEventId;

  const cancelIndicator = reader.readBool();
  cmd.fields.push({ label: "splice_event_cancel_indicator", value: cancelIndicator ? "1 (Cancel)" : "0" });
  cmd.cancelIndicator = cancelIndicator;

  reader.skip(7); // reserved

  if (!cancelIndicator) {
    const outOfNetwork = reader.readBool();
    cmd.fields.push({ label: "out_of_network_indicator", value: outOfNetwork ? "1 (Out / Ad Start)" : "0 (In / Ad End)" });
    cmd.outOfNetwork = outOfNetwork;

    const programSpliceFlag = reader.readBool();
    cmd.fields.push({ label: "program_splice_flag", value: programSpliceFlag ? "1 (Program splice)" : "0 (Component splice)" });

    const durationFlag = reader.readBool();
    cmd.fields.push({ label: "duration_flag", value: durationFlag ? "1" : "0" });

    const spliceImmediateFlag = reader.readBool();
    cmd.fields.push({ label: "splice_immediate_flag", value: spliceImmediateFlag ? "1 (Immediate)" : "0 (Timed)" });

    reader.skip(4); // reserved

    if (programSpliceFlag && !spliceImmediateFlag) {
      // splice_time()
      const st = parseSpliceTime(reader);
      cmd.spliceTime = st;
      if (st.specified) {
        cmd.fields.push({ label: "splice_time (PTS)", value: "0x" + st.pts.toString(16) + " (" + st.pts + ")", note: formatPTS(st.pts) + " (" + ptsToSeconds(st.pts).toFixed(6) + "s)" });
      } else {
        cmd.fields.push({ label: "splice_time", value: "Not specified" });
      }
    }

    if (!programSpliceFlag) {
      const componentCount = reader.readBits(8);
      cmd.fields.push({ label: "component_count", value: componentCount.toString() });
      cmd.components = [];
      for (let i = 0; i < componentCount; i++) {
        const tag = reader.readBits(8);
        let compTime = null;
        if (!spliceImmediateFlag) {
          compTime = parseSpliceTime(reader);
        }
        cmd.components.push({ tag, spliceTime: compTime });
      }
    }

    if (durationFlag) {
      const bd = parseBreakDuration(reader);
      cmd.breakDuration = bd;
      cmd.fields.push({ label: "auto_return", value: bd.autoReturn ? "Yes" : "No" });
      cmd.fields.push({ label: "break_duration", value: formatDuration(bd.duration), note: "(" + ptsToSeconds(bd.duration).toFixed(6) + "s / " + bd.duration + " ticks)" });
    }

    const uniqueProgramId = reader.readBits(16);
    cmd.fields.push({ label: "unique_program_id", value: uniqueProgramId.toString() });
    cmd.uniqueProgramId = uniqueProgramId;

    const availNum = reader.readBits(8);
    cmd.fields.push({ label: "avail_num", value: availNum.toString() });
    cmd.availNum = availNum;

    const availsExpected = reader.readBits(8);
    cmd.fields.push({ label: "avails_expected", value: availsExpected.toString() });
    cmd.availsExpected = availsExpected;
  }

  return cmd;
}

// ============================
// TIME SIGNAL
// ============================

function parseTimeSignal(reader) {
  const cmd = { type: "time_signal", fields: [] };
  const st = parseSpliceTime(reader);
  cmd.spliceTime = st;
  if (st.specified) {
    cmd.fields.push({ label: "splice_time (PTS)", value: "0x" + st.pts.toString(16) + " (" + st.pts + ")", note: formatPTS(st.pts) + " (" + ptsToSeconds(st.pts).toFixed(6) + "s)" });
  } else {
    cmd.fields.push({ label: "splice_time", value: "Not specified" });
  }
  return cmd;
}

// ============================
// PRIVATE COMMAND
// ============================

function parsePrivateCommand(reader, length) {
  const cmd = { type: "private_command", fields: [] };
  if (length >= 4) {
    const identifier = reader.readBits(32);
    cmd.fields.push({ label: "identifier", value: "0x" + identifier.toString(16).padStart(8, "0") + " (" + identifier + ")" });
    if (length > 4) {
      const privateBytes = reader.readBytes(length - 4);
      cmd.fields.push({ label: "private_data", value: bytesToHex(privateBytes), note: (length - 4) + " bytes" });
    }
  }
  return cmd;
}

// ============================
// SPLICE TIME
// ============================

function parseSpliceTime(reader) {
  const timeSpecifiedFlag = reader.readBool();
  if (timeSpecifiedFlag) {
    reader.skip(6); // reserved
    const pts = reader.readUint33();
    return { specified: true, pts };
  } else {
    reader.skip(7); // reserved
    return { specified: false, pts: 0 };
  }
}

// ============================
// BREAK DURATION
// ============================

function parseBreakDuration(reader) {
  const autoReturn = reader.readBool();
  reader.skip(6); // reserved
  const duration = reader.readUint33();
  return { autoReturn, duration };
}

// ============================
// SPLICE DESCRIPTOR
// ============================

function parseDescriptor(reader) {
  const tag = reader.readBits(8);
  const length = reader.readBits(8);
  const startPos = reader.bytePos;

  const DESCRIPTOR_TAG_NAMES = { 0x00: "avail_descriptor", 0x01: "DTMF_descriptor", 0x02: "segmentation_descriptor", 0x03: "time_descriptor", 0x04: "audio_descriptor" };
  const desc = { tag, length, fields: [] };
  desc.fields.push({ label: "splice_descriptor_tag", value: "0x" + tag.toString(16).padStart(2, "0") + " (" + tag + ")", note: DESCRIPTOR_TAG_NAMES[tag] || "" });
  desc.fields.push({ label: "descriptor_length", value: length.toString() });

  if (length < 4) {
    // Too short for identifier
    if (length > 0) reader.readBytes(length);
    return desc;
  }

  const identifier = reader.readBits(32);
  const identStr = String.fromCharCode((identifier >> 24) & 0xFF, (identifier >> 16) & 0xFF, (identifier >> 8) & 0xFF, identifier & 0xFF);
  desc.identifier = identStr;
  desc.fields.push({ label: "identifier", value: identStr + " (0x" + identifier.toString(16).padStart(8, "0") + " / " + identifier + ")" });

  if (identStr === "CUEI") {
    if (tag === 0x02) {
      desc.type = "segmentation_descriptor";
      parseSegmentationDescriptor(reader, desc, length - 4);
    } else if (tag === 0x00) {
      desc.type = "avail_descriptor";
      const providerAvailId = reader.readBits(32);
      desc.fields.push({ label: "provider_avail_id", value: "0x" + providerAvailId.toString(16).padStart(8, "0") + " (" + providerAvailId + ")" });
    } else if (tag === 0x01) {
      desc.type = "dtmf_descriptor";
      const preroll = reader.readBits(8);
      const dtmfCount = reader.readBits(3);
      reader.skip(5);
      let dtmfChars = "";
      for (let i = 0; i < dtmfCount; i++) dtmfChars += String.fromCharCode(reader.readBits(8));
      desc.fields.push({ label: "preroll", value: preroll + "ms" });
      desc.fields.push({ label: "dtmf_chars", value: dtmfChars });
    } else {
      // Unknown CUEI descriptor — read remaining
      const remaining = length - 4;
      if (remaining > 0) {
        const data = reader.readBytes(remaining);
        desc.fields.push({ label: "data", value: bytesToHex(data) });
      }
    }
  } else {
    // Non-CUEI descriptor
    const remaining = length - 4;
    if (remaining > 0) {
      const data = reader.readBytes(remaining);
      desc.fields.push({ label: "data", value: bytesToHex(data) });
    }
  }

  // Ensure we've consumed exactly 'length' bytes from the descriptor body
  const consumed = reader.bytePos - startPos;
  if (consumed < length) reader.skip((length - consumed) * 8);

  return desc;
}

// ============================
// SEGMENTATION DESCRIPTOR
// ============================

function parseSegmentationDescriptor(reader, desc, remaining) {
  const segEventId = reader.readBits(32);
  desc.fields.push({ label: "segmentation_event_id", value: "0x" + segEventId.toString(16).padStart(8, "0") + " (" + segEventId + ")" });

  const cancelIndicator = reader.readBool();
  desc.fields.push({ label: "segmentation_event_cancel_indicator", value: cancelIndicator ? "1 (Cancel)" : "0" });
  const complianceIndicator = reader.readBool();
  desc.fields.push({ label: "segmentation_event_id_compliance_indicator", value: complianceIndicator ? "true" : "false" });
  reader.skip(6);

  if (!cancelIndicator) {
    const programSegFlag = reader.readBool();
    const hasDuration = reader.readBool();
    const deliveryNotRestricted = reader.readBool();

    desc.fields.push({ label: "program_segmentation_flag", value: programSegFlag ? "1" : "0" });
    desc.fields.push({ label: "segmentation_duration_flag", value: hasDuration ? "1" : "0" });
    desc.fields.push({ label: "delivery_not_restricted_flag", value: deliveryNotRestricted ? "1" : "0" });

    if (!deliveryNotRestricted) {
      const webDelivery = reader.readBool();
      const noRegional = reader.readBool();
      const archiveAllowed = reader.readBool();
      const deviceRestrictions = reader.readBits(2);
      const DEVICE_RESTRICTIONS = { 0: "Restrict Group 0", 1: "Restrict Group 1", 2: "Restrict Group 2", 3: "None" };
      desc.fields.push({ label: "web_delivery_allowed_flag", value: webDelivery ? "Yes" : "No" });
      desc.fields.push({ label: "no_regional_blackout_flag", value: noRegional ? "Yes" : "No" });
      desc.fields.push({ label: "archive_allowed_flag", value: archiveAllowed ? "Yes" : "No" });
      desc.fields.push({ label: "device_restrictions", value: "0x" + deviceRestrictions.toString(16) + " (" + deviceRestrictions + ")", note: DEVICE_RESTRICTIONS[deviceRestrictions] || "" });
    } else {
      reader.skip(5);
    }

    if (!programSegFlag) {
      const componentCount = reader.readBits(8);
      desc.fields.push({ label: "component_count", value: componentCount.toString() });
      for (let i = 0; i < componentCount; i++) {
        const compTag = reader.readBits(8);
        reader.skip(7);
        const compPts = reader.readUint33();
        desc.fields.push({ label: "component[" + i + "]", value: "tag=" + compTag + " pts_offset=" + compPts });
      }
    }

    if (hasDuration) {
      // segmentation_duration is 40 bits per SCTE-35 spec (not 33)
      const segDuration = reader.readUint40();
      desc.fields.push({ label: "segmentation_duration", value: formatDuration(segDuration), note: segDuration + " ticks" });
      desc.segmentationDuration = segDuration;
    }

    const upidType = reader.readBits(8);
    const upidLength = reader.readBits(8);
    const upidTypeName = SEGMENTATION_UPID_TYPES[upidType] || "Unknown (0x" + upidType.toString(16) + ")";
    desc.fields.push({ label: "segmentation_upid_type", value: "0x" + upidType.toString(16).padStart(2, "0") + " (" + upidType + ")", note: upidTypeName });
    desc.fields.push({ label: "segmentation_upid_length", value: upidLength.toString() });

    if (upidLength > 0) {
      const upidBytes = reader.readBytes(upidLength);
      let upidValue = bytesToHex(upidBytes);
      // Try to show as ASCII if printable
      const ascii = Array.from(upidBytes).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "").join("");
      if (ascii.length === upidLength && upidLength > 0) upidValue = ascii + " (" + bytesToHex(upidBytes) + ")";
      desc.fields.push({ label: "segmentation_upid", value: upidValue });
      desc.upid = upidValue;
    }

    const segTypeId = reader.readBits(8);
    const segTypeName = SEGMENTATION_TYPE_IDS[segTypeId] || "Unknown (0x" + segTypeId.toString(16) + ")";
    desc.fields.push({ label: "segmentation_type_id", value: "0x" + segTypeId.toString(16).padStart(2, "0") + " (" + segTypeId + ")", note: segTypeName });
    desc.segmentationTypeId = segTypeId;
    desc.segmentationTypeName = segTypeName;

    const segNum = reader.readBits(8);
    const segExpected = reader.readBits(8);
    desc.fields.push({ label: "segment_num", value: segNum.toString() });
    desc.fields.push({ label: "segments_expected", value: segExpected.toString() });

    // sub_segment fields if applicable (type_id 0x34, 0x36 per SCTE-35 2024 §10.3.3.1)
    if (segTypeId === 0x34 || segTypeId === 0x36) {
      try {
        const subSegNum = reader.readBits(8);
        const subSegExpected = reader.readBits(8);
        desc.fields.push({ label: "sub_segment_num", value: subSegNum.toString() });
        desc.fields.push({ label: "sub_segments_expected", value: subSegExpected.toString() });
      } catch {}
    }
  }
}

// ============================
// HISTORY
// ============================

const HISTORY_KEY = "scte35_parser_history";
const MAX_HISTORY = 20;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function addToHistory(input) {
  try {
    let history = getHistory();
    history = history.filter(h => h !== input);
    history.unshift(input);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  } catch {}
}

function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById("historyList");
  if (!container) return;
  const history = getHistory();
  const wrapper = document.getElementById("historySection");
  if (history.length === 0) { if (wrapper) wrapper.style.display = "none"; return; }
  if (wrapper) wrapper.style.display = "";
  container.innerHTML = "";
  history.forEach(item => {
    const btn = document.createElement("button");
    btn.className = "history-btn";
    btn.textContent = item.length > 60 ? item.slice(0, 57) + "..." : item;
    btn.title = item;
    btn.addEventListener("click", () => { document.getElementById("scteInput").value = item; parseInput(); });
    container.appendChild(btn);
  });
}

// ============================
// UI HELPERS
// ============================

function showError(msg) {
  const el = document.getElementById("errorMessage");
  el.textContent = msg;
  el.style.display = "block";
}

function clearError() {
  document.getElementById("errorMessage").style.display = "none";
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) { toast = document.createElement("div"); toast.className = "toast"; document.body.appendChild(toast); }
  toast.textContent = message;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

function createCopyButton(text, label) {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.textContent = "\u{1F4CB}";
  btn.title = "Copy " + (label || "value");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = "\u2713";
      setTimeout(() => { btn.textContent = "\u{1F4CB}"; }, 1200);
    });
  });
  return btn;
}

// ============================
// HEX VIEWER
// ============================

function renderHexViewer(bytes, regions) {
  const container = document.getElementById("hexViewer");
  const dumpEl = document.getElementById("hexDump");
  const legendEl = document.getElementById("hexLegend");
  container.style.display = "";
  dumpEl.innerHTML = "";
  legendEl.innerHTML = "";

  // Legend
  regions.forEach(r => {
    const item = document.createElement("span");
    item.className = "hex-legend-item";
    item.innerHTML = '<span class="hex-legend-swatch" style="background:' + r.color + '"></span>' + r.label;
    legendEl.appendChild(item);
  });

  // Hex dump — 16 bytes per row
  const rows = Math.ceil(bytes.length / 16);
  for (let row = 0; row < rows; row++) {
    const line = document.createElement("div");
    line.className = "hex-row";

    // Offset
    const offset = document.createElement("span");
    offset.className = "hex-offset";
    offset.textContent = (row * 16).toString(16).padStart(4, "0");
    line.appendChild(offset);

    // Hex bytes
    const hexPart = document.createElement("span");
    hexPart.className = "hex-bytes";
    for (let col = 0; col < 16; col++) {
      const idx = row * 16 + col;
      if (idx >= bytes.length) { hexPart.appendChild(document.createTextNode("   ")); continue; }
      const span = document.createElement("span");
      span.textContent = bytes[idx].toString(16).padStart(2, "0");
      span.className = "hex-byte";
      // Find region for coloring
      for (const r of regions) {
        if (idx >= r.start && idx < r.end) { span.style.color = r.color; span.title = r.label; break; }
      }
      hexPart.appendChild(span);
      hexPart.appendChild(document.createTextNode(" "));
    }
    line.appendChild(hexPart);

    // ASCII
    const asciiPart = document.createElement("span");
    asciiPart.className = "hex-ascii";
    for (let col = 0; col < 16; col++) {
      const idx = row * 16 + col;
      if (idx >= bytes.length) { asciiPart.appendChild(document.createTextNode(" ")); continue; }
      const b = bytes[idx];
      const ch = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
      const span = document.createElement("span");
      span.textContent = ch;
      for (const r of regions) {
        if (idx >= r.start && idx < r.end) { span.style.color = r.color; break; }
      }
      asciiPart.appendChild(span);
    }
    line.appendChild(asciiPart);
    dumpEl.appendChild(line);
  }
}

// ============================
// BINARY BIT VIEWER
// ============================

function renderBinaryViewer(bytes) {
  const container = document.getElementById("binaryViewer");
  const dumpEl = document.getElementById("binaryDump");
  container.style.display = "";
  dumpEl.innerHTML = "";

  // Show first 20 bytes in binary with bit labels
  const headerFields = [
    { name: "table_id", bits: 8, color: "#4caf50" },
    { name: "section_syntax_indicator", bits: 1, color: "#2196f3" },
    { name: "private_indicator", bits: 1, color: "#2196f3" },
    { name: "sap_type", bits: 2, color: "#2196f3" },
    { name: "section_length", bits: 12, color: "#2196f3" },
    { name: "protocol_version", bits: 8, color: "#ff9800" },
    { name: "encrypted_packet", bits: 1, color: "#ff9800" },
    { name: "encryption_algorithm", bits: 6, color: "#ff9800" },
    { name: "pts_adjustment", bits: 33, color: "#ff9800" },
    { name: "cw_index", bits: 8, color: "#9c27b0" },
    { name: "tier", bits: 12, color: "#9c27b0" },
    { name: "splice_command_length", bits: 12, color: "#9c27b0" },
    { name: "splice_command_type", bits: 8, color: "#e91e63" },
  ];

  let bitOffset = 0;
  headerFields.forEach(field => {
    const row = document.createElement("div");
    row.className = "binary-field-row";

    const label = document.createElement("span");
    label.className = "binary-field-label";
    label.style.color = field.color;
    label.textContent = field.name;
    row.appendChild(label);

    const bits = document.createElement("span");
    bits.className = "binary-field-bits";
    let val = "";
    for (let i = 0; i < field.bits; i++) {
      const byteIdx = Math.floor((bitOffset + i) / 8);
      const bitIdx = 7 - ((bitOffset + i) % 8);
      if (byteIdx < bytes.length) {
        val += (bytes[byteIdx] >> bitIdx) & 1 ? "1" : "0";
      } else {
        val += "?";
      }
      if ((i + 1) % 8 === 0 && i + 1 < field.bits) val += " ";
    }
    bits.textContent = val;
    bits.style.color = field.color;
    row.appendChild(bits);

    const info = document.createElement("span");
    info.className = "binary-field-info";
    info.textContent = field.bits + " bits";
    row.appendChild(info);

    dumpEl.appendChild(row);
    bitOffset += field.bits;
  });
}

// ============================
// RESULT RENDERER
// ============================

let lastParsedResult = null;

function renderResults(parsed, source, inputData) {
  const container = document.getElementById("results");
  container.innerHTML = "";
  lastParsedResult = parsed;

  const card = document.createElement("div");
  card.className = "result-card";

  // Header
  const header = document.createElement("div");
  header.className = "result-header";
  const badge = document.createElement("span");
  badge.className = "codec-badge";
  badge.style.backgroundColor = "#e91e63";
  badge.textContent = "SCTE-35";
  header.appendChild(badge);
  const title = document.createElement("h3");
  title.className = "result-title";
  title.textContent = parsed.commandName || "Unknown Command";
  header.appendChild(title);
  if (source) {
    const srcBadge = document.createElement("span");
    srcBadge.className = "type-badge type-video";
    srcBadge.textContent = source;
    header.appendChild(srcBadge);
  }
  card.appendChild(header);

  // Copy All button
  const copyAllBtn = document.createElement("button");
  copyAllBtn.className = "secondary-btn small-btn copy-all-btn";
  copyAllBtn.textContent = "📋 Copy All Fields";
  copyAllBtn.addEventListener("click", () => {
    const sections = [];
    if (parsed.fields && parsed.fields.length > 0) {
      sections.push("Splice Info Section\n" + parsed.fields.map(f => "  " + f.label + ": " + f.value + (f.note ? "  " + f.note : "")).join("\n"));
    }
    if (parsed.command && parsed.command.fields && parsed.command.fields.length > 0) {
      sections.push((parsed.commandName || "Command") + "\n" + parsed.command.fields.map(f => "  " + f.label + ": " + f.value + (f.note ? "  " + f.note : "")).join("\n"));
    }
    if (parsed.descriptors && parsed.descriptors.length > 0) {
      parsed.descriptors.forEach((desc, i) => {
        if (desc.fields && desc.fields.length > 0) {
          const t = (desc.type || "Descriptor " + (i + 1)) + (desc.segmentationTypeName ? " — " + desc.segmentationTypeName : "");
          sections.push(t + "\n" + desc.fields.map(f => "  " + f.label + ": " + f.value + (f.note ? "  " + f.note : "")).join("\n"));
        }
      });
    }
    navigator.clipboard.writeText(sections.join("\n\n")).then(() => {
      copyAllBtn.textContent = "✓ Copied";
      setTimeout(() => { copyAllBtn.textContent = "📋 Copy All Fields"; }, 1500);
    });
  });
  header.appendChild(copyAllBtn);

  // CRC badge
  if (parsed.crcValid !== undefined) {
    const crcBadge = document.createElement("div");
    crcBadge.className = "crc-badge " + (parsed.crcValid ? "crc-valid" : "crc-invalid");
    crcBadge.textContent = parsed.crcValid ? "✓ CRC Valid" : "✗ CRC Invalid";
    card.appendChild(crcBadge);
  }

  // Error
  if (parsed.error) {
    const errDiv = document.createElement("div");
    errDiv.className = "parse-error";
    errDiv.textContent = parsed.error;
    card.appendChild(errDiv);
  }

  // Summary card for key info
  if (parsed.command && !parsed.error) {
    const summary = document.createElement("div");
    summary.className = "summary-grid";
    const summaryItems = [];

    summaryItems.push({ label: "Command", value: parsed.commandName || "?" });

    if (parsed.command.outOfNetwork !== undefined) {
      summaryItems.push({ label: "Direction", value: parsed.command.outOfNetwork ? "🔴 Out (Ad Start)" : "🟢 In (Ad End)" });
    }
    if (parsed.command.spliceTime && parsed.command.spliceTime.specified) {
      summaryItems.push({ label: "Splice Time", value: formatPTS(parsed.command.spliceTime.pts) });
    }
    if (parsed.command.breakDuration) {
      summaryItems.push({ label: "Break Duration", value: formatDuration(parsed.command.breakDuration.duration) });
      summaryItems.push({ label: "Auto Return", value: parsed.command.breakDuration.autoReturn ? "Yes" : "No" });
    }
    if (parsed.descriptors && parsed.descriptors.length > 0) {
      const segDesc = parsed.descriptors.find(d => d.segmentationTypeName);
      if (segDesc) {
        summaryItems.push({ label: "Segmentation Type", value: segDesc.segmentationTypeName });
        if (segDesc.segmentationDuration) {
          summaryItems.push({ label: "Seg Duration", value: formatDuration(segDesc.segmentationDuration) });
        }
      }
    }

    summaryItems.forEach(item => {
      const cell = document.createElement("div");
      cell.className = "summary-cell";
      const lbl = document.createElement("div");
      lbl.className = "summary-label";
      lbl.textContent = item.label;
      cell.appendChild(lbl);
      const val = document.createElement("div");
      val.className = "summary-value";
      val.textContent = item.value;
      cell.appendChild(val);
      summary.appendChild(cell);
    });
    card.appendChild(summary);
  }

  // Section Header Fields
  renderFieldSection(card, "Splice Info Section", parsed.fields);

  // Command Fields
  try {
    if (parsed.command && parsed.command.fields && parsed.command.fields.length > 0) {
      renderFieldSection(card, parsed.commandName || "Command", parsed.command.fields);
    }
  } catch (e) {
    const errDiv = document.createElement("div");
    errDiv.className = "parse-error";
    errDiv.textContent = "Command render error: " + e.message;
    card.appendChild(errDiv);
  }

  // Descriptors
  try {
    if (parsed.descriptors && parsed.descriptors.length > 0) {
      parsed.descriptors.forEach((desc, i) => {
        if (desc.error) {
          const errDiv = document.createElement("div");
          errDiv.className = "parse-error";
          errDiv.textContent = "Descriptor " + (i + 1) + ": " + desc.error;
          card.appendChild(errDiv);
          return;
        }
        const descTitle = desc.type || ("Descriptor " + (i + 1));
        const subtitle = desc.segmentationTypeName ? " — " + desc.segmentationTypeName : "";
        renderFieldSection(card, descTitle + subtitle, desc.fields || []);
      });
    }
  } catch (e) {
    const errDiv = document.createElement("div");
    errDiv.className = "parse-error";
    errDiv.textContent = "Descriptor render error: " + e.message;
    card.appendChild(errDiv);
  }

  container.appendChild(card);

  // Export area
  const exportArea = document.getElementById("exportArea");
  if (exportArea) exportArea.style.display = "";
}

function renderFieldSection(parent, title, fields) {
  if (!fields || fields.length === 0) return;
  const section = document.createElement("div");
  section.className = "field-section";
  const header = document.createElement("div");
  header.className = "field-section-title";
  const headerText = document.createElement("span");
  headerText.textContent = title;
  header.appendChild(headerText);
  const copySecBtn = document.createElement("button");
  copySecBtn.className = "copy-section-btn";
  copySecBtn.textContent = "📋 Copy Section";
  copySecBtn.addEventListener("click", () => {
    const text = title + "\n" + fields.map(f => f.label + ": " + f.value + (f.note ? "  " + f.note : "")).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      copySecBtn.textContent = "✓ Copied";
      setTimeout(() => { copySecBtn.textContent = "📋 Copy Section"; }, 1500);
    });
  });
  header.appendChild(copySecBtn);
  section.appendChild(header);

  const table = document.createElement("table");
  table.className = "field-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Field", "Value", "Info"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  fields.forEach(field => {
    const tr = document.createElement("tr");

    const tdLabel = document.createElement("td");
    tdLabel.className = "ft-label";
    tdLabel.textContent = field.label;
    tr.appendChild(tdLabel);

    const tdValue = document.createElement("td");
    tdValue.className = "ft-value";
    const code = document.createElement("code");
    code.textContent = field.value;
    if (field.label === "CRC_32" && field.note) {
      if (field.note.startsWith("✓")) code.classList.add("value-valid");
      else if (field.note.startsWith("✗")) code.classList.add("value-invalid");
    }
    tdValue.appendChild(code);
    tdValue.appendChild(createCopyButton(field.value, field.label));
    tr.appendChild(tdValue);

    const tdNote = document.createElement("td");
    tdNote.className = "ft-note";
    tdNote.textContent = field.note || "";
    tr.appendChild(tdNote);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  section.appendChild(table);
  parent.appendChild(section);
}

// ============================
// EXPORT JSON
// ============================

function exportJSON() {
  if (!lastParsedResult) return null;
  return JSON.stringify(lastParsedResult, null, 2);
}

function copyJSON() {
  const json = exportJSON();
  if (!json) return;
  navigator.clipboard.writeText(json).then(() => showToast("JSON copied!"));
}

function downloadJSON() {
  const json = exportJSON();
  if (!json) return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "scte35_parsed.json"; a.click();
  URL.revokeObjectURL(url);
}

// ============================
// THEME
// ============================

function initTheme() {
  try {
    const saved = localStorage.getItem("scte35_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "");
    updateThemeIcon(saved);
  } catch { updateThemeIcon("dark"); }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "light" ? "" : "light";
  document.documentElement.setAttribute("data-theme", next);
  const theme = next === "light" ? "light" : "dark";
  try { localStorage.setItem("scte35_theme", theme); } catch {}
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  document.getElementById("themeToggle").textContent = theme === "light" ? "\uD83C\uDF19" : "\u2600\uFE0F";
}

// ============================
// SAMPLES
// ============================

function renderSamples() {
  const list = document.getElementById("samplesList");
  if (!list) return;
  list.innerHTML = "";
  SAMPLES.forEach(sample => {
    const btn = document.createElement("button");
    btn.className = "sample-btn";
    btn.textContent = sample.label;
    btn.title = sample.data;
    btn.addEventListener("click", () => { document.getElementById("scteInput").value = sample.data; parseInput(); });
    list.appendChild(btn);
  });
}

// ============================
// PARSE INPUT
// ============================

function parseInput() {
  clearError();
  document.getElementById("results").innerHTML = "";
  document.getElementById("hexViewer").style.display = "none";
  document.getElementById("binaryViewer").style.display = "none";
  const exportArea = document.getElementById("exportArea");
  if (exportArea) exportArea.style.display = "none";

  const raw = document.getElementById("scteInput").value.trim();
  if (!raw) { showError("Please enter SCTE-35 data."); return; }

  const extracted = extractSCTE35Data(raw);
  if (!extracted) { showError("Could not detect SCTE-35 data format. Supported: Base64, Hex, HLS tags, DASH XML."); return; }

  let bytes;
  try {
    if (extracted.type === "base64") bytes = base64ToBytes(extracted.data);
    else if (extracted.type === "hex") bytes = hexToBytes(extracted.data);
    else { showError("Unknown data type."); return; }
  } catch (e) {
    showError("Failed to decode input: " + e.message);
    return;
  }

  if (bytes.length < 3) { showError("Data too short — minimum 3 bytes for a valid SCTE-35 section."); return; }

  let parsed;
  try {
    parsed = parseSpliceInfoSection(bytes);
  } catch (e) {
    showError("Parse error: " + e.message);
    return;
  }

  renderResults(parsed, extracted.source, raw);
  renderHexViewer(bytes, parsed.regions || []);
  renderBinaryViewer(bytes);
  addToHistory(raw);
}

// ============================
// MANIFEST SCTE-35 SCANNER
// ============================

function detectManifestType(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("#EXTM3U")) return "hls";
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<MPD") || trimmed.includes("<MPD")) return "dash";
  return null;
}

function scanHLSManifest(text) {
  const lines = text.split(/\r?\n/);
  const markers = [];
  let lineNum = 0;
  let currentTime = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    lineNum = i + 1;

    // Track segment time for context
    const extinfMatch = line.match(/^#EXTINF:([\d.]+)/);
    if (extinfMatch) currentTime = parseFloat(extinfMatch[1]);

    // #EXT-X-SCTE35:CUE="..."
    const cueMatch = line.match(/^#EXT-X-SCTE35.*CUE="([^"]+)"/i) || line.match(/^#EXT-X-SCTE35.*CUE='([^']+)'/i);
    if (cueMatch) {
      markers.push({
        line: lineNum, tag: "#EXT-X-SCTE35", rawLine: line,
        type: "base64", data: cueMatch[1], source: "HLS #EXT-X-SCTE35"
      });
      continue;
    }

    // #EXT-X-DATERANGE with SCTE35-OUT, SCTE35-IN, or SCTE35-CMD
    const drOutMatch = line.match(/SCTE35-OUT\s*=\s*0x([0-9a-fA-F]+)/i);
    const drInMatch = line.match(/SCTE35-IN\s*=\s*0x([0-9a-fA-F]+)/i);
    const drCmdMatch = line.match(/SCTE35-CMD\s*=\s*0x([0-9a-fA-F]+)/i);
    if (drOutMatch || drInMatch || drCmdMatch) {
      const match = drOutMatch || drInMatch || drCmdMatch;
      const attr = drOutMatch ? "SCTE35-OUT" : drInMatch ? "SCTE35-IN" : "SCTE35-CMD";
      let id = "";
      const idMatch = line.match(/ID="([^"]+)"/i);
      if (idMatch) id = idMatch[1];
      let duration = "";
      const durMatch = line.match(/PLANNED-DURATION=([\d.]+)/i) || line.match(/DURATION=([\d.]+)/i);
      if (durMatch) duration = durMatch[1] + "s";
      markers.push({
        line: lineNum, tag: "#EXT-X-DATERANGE (" + attr + ")", rawLine: line,
        type: "hex", data: match[1], source: "HLS DATERANGE",
        meta: { id, duration, attr }
      });
      continue;
    }

    // #EXT-X-CUE-OUT with optional data
    if (line.startsWith("#EXT-X-CUE-OUT")) {
      const b64Match = line.match(/^#EXT-X-CUE-OUT:(.+)/);
      let data = null, type = null;
      if (b64Match) {
        const val = b64Match[1].trim();
        // Check if it's base64 (SCTE-35) or just a duration
        if (/^[A-Za-z0-9+/=]{10,}$/.test(val)) {
          data = val; type = "base64";
        } else {
          // Duration-only CUE-OUT
          markers.push({
            line: lineNum, tag: "#EXT-X-CUE-OUT", rawLine: line,
            source: "HLS CUE-OUT", noParse: true,
            meta: { duration: val.replace(/DURATION=/i, "") }
          });
          continue;
        }
      }
      if (data) {
        markers.push({
          line: lineNum, tag: "#EXT-X-CUE-OUT", rawLine: line,
          type, data, source: "HLS CUE-OUT"
        });
      } else {
        markers.push({
          line: lineNum, tag: "#EXT-X-CUE-OUT", rawLine: line,
          source: "HLS CUE-OUT", noParse: true
        });
      }
      continue;
    }

    // #EXT-X-CUE-IN
    if (line.startsWith("#EXT-X-CUE-IN")) {
      markers.push({
        line: lineNum, tag: "#EXT-X-CUE-IN", rawLine: line,
        source: "HLS CUE-IN", noParse: true
      });
      continue;
    }

    // #EXT-OATCLS-SCTE35 or similar vendor tags with base64
    const vendorMatch = line.match(/^#EXT-[A-Z0-9-]*SCTE35[^:]*:(.+)/i);
    if (vendorMatch && !line.startsWith("#EXT-X-SCTE35") && !line.startsWith("#EXT-X-DATERANGE")) {
      const val = vendorMatch[1].trim();
      if (/^[A-Za-z0-9+/=]{10,}$/.test(val)) {
        markers.push({
          line: lineNum, tag: line.split(":")[0], rawLine: line,
          type: "base64", data: val, source: "HLS vendor SCTE-35 tag"
        });
      }
    }
  }

  return markers;
}

function scanDASHManifest(text) {
  const markers = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) return { error: "Invalid XML: " + parseError.textContent.substring(0, 100) };

  // Find EventStream elements with SCTE-35 scheme
  const scteSchemes = [
    "urn:scte:scte35:2013:bin",
    "urn:scte:scte35:2014:xml+bin",
    "urn:scte:scte35:2013:xml",
    "urn:scte:scte35:2014:bin",
  ];

  const eventStreams = doc.querySelectorAll("EventStream");
  eventStreams.forEach((es, esIdx) => {
    const scheme = es.getAttribute("schemeIdUri") || "";
    if (!scteSchemes.some(s => scheme.includes("scte35"))) return;

    const timescale = parseInt(es.getAttribute("timescale") || "1");
    const periodEl = es.closest("Period");
    const periodId = periodEl ? (periodEl.getAttribute("id") || "Period " + (esIdx + 1)) : "";
    const adaptEl = es.closest("AdaptationSet");
    const adaptId = adaptEl ? (adaptEl.getAttribute("id") || adaptEl.getAttribute("contentType") || "") : "";

    const events = es.querySelectorAll("Event");
    events.forEach((evt, evtIdx) => {
      const presentationTime = evt.getAttribute("presentationTime") || "0";
      const duration = evt.getAttribute("duration") || "";
      const id = evt.getAttribute("id") || "";

      // Get SCTE-35 data — could be in text content or Signal/Binary child
      let data = null, type = null;

      // Check text content directly (base64)
      const textContent = evt.textContent.trim();
      if (/^[A-Za-z0-9+/=]{10,}$/.test(textContent)) {
        data = textContent; type = "base64";
      }

      // Check Signal > Binary element
      if (!data) {
        const binary = evt.querySelector("Binary") || evt.querySelector("*|Binary");
        if (binary && binary.textContent.trim()) {
          data = binary.textContent.trim(); type = "base64";
        }
      }

      // Check for hex in attribute
      if (!data) {
        const msgData = evt.getAttribute("messageData");
        if (msgData) {
          const hexClean = msgData.replace(/^0x/i, "");
          if (/^[0-9a-fA-F]+$/.test(hexClean)) { data = hexClean; type = "hex"; }
          else { data = msgData; type = "base64"; }
        }
      }

      const ptSecs = duration ? (parseInt(duration) / timescale).toFixed(3) + "s" : "";

      markers.push({
        tag: "EventStream Event",
        source: "DASH EventStream",
        type, data,
        noParse: !data,
        meta: {
          scheme, timescale: timescale.toString(),
          presentationTime, duration: ptSecs,
          eventId: id, periodId, adaptationSet: adaptId,
          eventIndex: evtIdx + 1
        },
        rawLine: new XMLSerializer().serializeToString(evt).substring(0, 200)
      });
    });
  });

  return markers;
}

function parseAndRenderManifestMarkers(markers, container) {
  if (markers.length === 0) {
    container.innerHTML = '<div class="card" style="margin-top:16px;"><p style="color:var(--text-muted);text-align:center;margin:0;">No SCTE-35 markers found in this manifest.</p></div>';
    return;
  }

  // Summary card
  const summaryCard = document.createElement("div");
  summaryCard.className = "result-card manifest-summary";
  const summaryHeader = document.createElement("div");
  summaryHeader.className = "result-header";
  const badge = document.createElement("span");
  badge.className = "codec-badge";
  badge.style.backgroundColor = "#ff9800";
  badge.textContent = "SCAN";
  summaryHeader.appendChild(badge);
  const title = document.createElement("h3");
  title.className = "result-title";
  title.textContent = markers.length + " SCTE-35 Marker" + (markers.length !== 1 ? "s" : "") + " Found";
  summaryHeader.appendChild(title);
  summaryCard.appendChild(summaryHeader);

  // Count by type
  const typeCounts = {};
  markers.forEach(m => { typeCounts[m.tag] = (typeCounts[m.tag] || 0) + 1; });
  const countGrid = document.createElement("div");
  countGrid.className = "summary-grid";
  Object.entries(typeCounts).forEach(([tag, count]) => {
    const cell = document.createElement("div");
    cell.className = "summary-cell";
    const lbl = document.createElement("div");
    lbl.className = "summary-label";
    lbl.textContent = tag;
    cell.appendChild(lbl);
    const val = document.createElement("div");
    val.className = "summary-value";
    val.textContent = count.toString();
    cell.appendChild(val);
    countGrid.appendChild(cell);
  });
  summaryCard.appendChild(countGrid);
  container.appendChild(summaryCard);

  // Individual marker cards
  markers.forEach((marker, idx) => {
    const card = document.createElement("div");
    card.className = "result-card manifest-marker-card";

    // Header
    const header = document.createElement("div");
    header.className = "result-header";
    const numBadge = document.createElement("span");
    numBadge.className = "codec-badge";
    numBadge.style.backgroundColor = marker.noParse ? "#607d8b" : "#e91e63";
    numBadge.textContent = "#" + (idx + 1);
    header.appendChild(numBadge);
    const mTitle = document.createElement("h3");
    mTitle.className = "result-title";
    mTitle.textContent = marker.tag;
    header.appendChild(mTitle);
    if (marker.source) {
      const srcBadge = document.createElement("span");
      srcBadge.className = "type-badge type-video";
      srcBadge.textContent = marker.source;
      header.appendChild(srcBadge);
    }
    card.appendChild(header);

    // Raw line
    if (marker.rawLine) {
      const rawDiv = document.createElement("div");
      rawDiv.className = "manifest-raw-line";
      const code = document.createElement("code");
      code.textContent = marker.rawLine;
      rawDiv.appendChild(code);
      rawDiv.appendChild(createCopyButton(marker.rawLine, "tag"));
      card.appendChild(rawDiv);
    }

    // Meta info (line number, DATERANGE ID, duration, etc.)
    const metaFields = [];
    if (marker.line) metaFields.push({ label: "Line", value: marker.line.toString() });
    if (marker.meta) {
      if (marker.meta.id) metaFields.push({ label: "ID", value: marker.meta.id });
      if (marker.meta.attr) metaFields.push({ label: "Attribute", value: marker.meta.attr });
      if (marker.meta.duration) metaFields.push({ label: "Duration", value: marker.meta.duration });
      if (marker.meta.periodId) metaFields.push({ label: "Period", value: marker.meta.periodId });
      if (marker.meta.adaptationSet) metaFields.push({ label: "AdaptationSet", value: marker.meta.adaptationSet });
      if (marker.meta.presentationTime && marker.meta.presentationTime !== "0") metaFields.push({ label: "Presentation Time", value: marker.meta.presentationTime });
      if (marker.meta.timescale) metaFields.push({ label: "Timescale", value: marker.meta.timescale });
      if (marker.meta.scheme) metaFields.push({ label: "Scheme", value: marker.meta.scheme });
    }
    if (metaFields.length > 0) {
      renderFieldSection(card, "Manifest Context", metaFields);
    }

    // Parse SCTE-35 data if available
    if (!marker.noParse && marker.data) {
      let bytes;
      try {
        bytes = marker.type === "base64" ? base64ToBytes(marker.data) : hexToBytes(marker.data);
      } catch (e) {
        const errDiv = document.createElement("div");
        errDiv.className = "parse-error";
        errDiv.textContent = "Failed to decode: " + e.message;
        card.appendChild(errDiv);
        container.appendChild(card);
        return;
      }

      try {
        const parsed = parseSpliceInfoSection(bytes);

        // CRC badge
        if (parsed.crcValid !== undefined) {
          const crcBadge = document.createElement("div");
          crcBadge.className = "crc-badge " + (parsed.crcValid ? "crc-valid" : "crc-invalid");
          crcBadge.textContent = parsed.crcValid ? "✓ CRC Valid" : "✗ CRC Invalid";
          card.appendChild(crcBadge);
        }

        // Summary
        if (parsed.command) {
          const summary = document.createElement("div");
          summary.className = "summary-grid";
          const items = [];
          items.push({ label: "Command", value: parsed.commandName || "?" });
          if (parsed.command.outOfNetwork !== undefined) items.push({ label: "Direction", value: parsed.command.outOfNetwork ? "🔴 Out" : "🟢 In" });
          if (parsed.command.spliceTime && parsed.command.spliceTime.specified) items.push({ label: "Splice PTS", value: formatPTS(parsed.command.spliceTime.pts) });
          if (parsed.command.breakDuration) items.push({ label: "Break", value: formatDuration(parsed.command.breakDuration.duration) });
          const segDesc = (parsed.descriptors || []).find(d => d.segmentationTypeName);
          if (segDesc) items.push({ label: "Seg Type", value: segDesc.segmentationTypeName });
          items.forEach(item => {
            const cell = document.createElement("div");
            cell.className = "summary-cell";
            const lbl = document.createElement("div"); lbl.className = "summary-label"; lbl.textContent = item.label; cell.appendChild(lbl);
            const val = document.createElement("div"); val.className = "summary-value"; val.textContent = item.value; cell.appendChild(val);
            summary.appendChild(cell);
          });
          card.appendChild(summary);
        }

        // Collapsible detail
        const detailToggle = document.createElement("button");
        detailToggle.className = "secondary-btn small-btn detail-toggle";
        detailToggle.textContent = "▶ Show Details";
        const detailDiv = document.createElement("div");
        detailDiv.className = "marker-detail";
        detailDiv.style.display = "none";
        detailToggle.addEventListener("click", () => {
          const open = detailDiv.style.display !== "none";
          detailDiv.style.display = open ? "none" : "";
          detailToggle.textContent = open ? "▶ Show Details" : "▼ Hide Details";
        });
        card.appendChild(detailToggle);

        renderFieldSection(detailDiv, "Splice Info Section", parsed.fields);
        if (parsed.command && parsed.command.fields && parsed.command.fields.length > 0) {
          renderFieldSection(detailDiv, parsed.commandName || "Command", parsed.command.fields);
        }
        if (parsed.descriptors && parsed.descriptors.length > 0) {
          parsed.descriptors.forEach((desc, di) => {
            const descTitle = desc.type || ("Descriptor " + (di + 1));
            const subtitle = desc.segmentationTypeName ? " — " + desc.segmentationTypeName : "";
            renderFieldSection(detailDiv, descTitle + subtitle, desc.fields || []);
          });
        }
        card.appendChild(detailDiv);

        // Quick parse button
        const parseBtn = document.createElement("button");
        parseBtn.className = "secondary-btn small-btn";
        parseBtn.textContent = "🔍 Full Parse";
        parseBtn.style.marginTop = "8px";
        parseBtn.addEventListener("click", () => {
          document.getElementById("scteInput").value = marker.data;
          parseInput();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        card.appendChild(parseBtn);

      } catch (e) {
        const errDiv = document.createElement("div");
        errDiv.className = "parse-error";
        errDiv.textContent = "Parse error: " + e.message;
        card.appendChild(errDiv);
      }
    } else if (marker.noParse) {
      const note = document.createElement("div");
      note.className = "manifest-note";
      note.textContent = "Signal-only marker (no binary SCTE-35 payload)";
      card.appendChild(note);
    }

    container.appendChild(card);
  });
}

function scanManifest() {
  const urlInput = document.getElementById("manifestUrlInput");
  const textInput = document.getElementById("manifestInput");
  const errorEl = document.getElementById("manifestError");
  const resultsEl = document.getElementById("manifestResults");
  errorEl.style.display = "none";
  resultsEl.innerHTML = "";

  const content = textInput.value.trim();
  if (!content) {
    errorEl.textContent = "Please paste manifest content or fetch a URL first.";
    errorEl.style.display = "block";
    return;
  }

  const manifestType = detectManifestType(content);
  if (!manifestType) {
    errorEl.textContent = "Could not detect manifest type. Expected HLS (#EXTM3U) or DASH (<MPD>) format.";
    errorEl.style.display = "block";
    return;
  }

  let markers;
  if (manifestType === "hls") {
    markers = scanHLSManifest(content);
  } else {
    markers = scanDASHManifest(content);
    if (markers.error) {
      errorEl.textContent = markers.error;
      errorEl.style.display = "block";
      return;
    }
  }

  parseAndRenderManifestMarkers(markers, resultsEl);
}

const CORS_PROXIES = [
  url => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
  url => "https://corsproxy.io/?" + encodeURIComponent(url)
];

function fetchManifest() {
  const urlInput = document.getElementById("manifestUrlInput");
  const textInput = document.getElementById("manifestInput");
  const errorEl = document.getElementById("manifestError");
  const useCors = document.getElementById("corsProxyToggle")?.checked;
  errorEl.style.display = "none";

  const url = urlInput.value.trim();
  if (!url) {
    errorEl.textContent = "Please enter a manifest URL.";
    errorEl.style.display = "block";
    return;
  }

  try { new URL(url); } catch {
    errorEl.textContent = "Invalid URL format.";
    errorEl.style.display = "block";
    return;
  }

  const fetchBtn = document.getElementById("fetchManifestBtn");
  fetchBtn.textContent = "Loading...";
  fetchBtn.disabled = true;

  const directFetch = () => fetch(url).then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });

  const proxyFetch = (proxyFn) => fetch(proxyFn(url)).then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });

  const done = (text) => {
    textInput.value = text;
    fetchBtn.textContent = "Fetch";
    fetchBtn.disabled = false;
  };

  const fail = (msg) => {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
    fetchBtn.textContent = "Fetch";
    fetchBtn.disabled = false;
  };

  if (useCors) {
    // Try direct first, then fall back through CORS proxies
    directFetch()
      .then(done)
      .catch(() => proxyFetch(CORS_PROXIES[0]))
      .then(text => { if (text) done(text); })
      .catch(() => proxyFetch(CORS_PROXIES[1]))
      .then(text => { if (text) done(text); })
      .catch(err => fail("Fetch failed through all proxies: " + err.message + ". Try pasting the manifest content directly."));
  } else {
    directFetch()
      .then(done)
      .catch(err => fail("Fetch failed: " + err.message + ". Enable 'Use CORS proxy' or paste the manifest content directly."));
  }
}

// ============================
// INIT
// ============================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("parseBtn").addEventListener("click", parseInput);
  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("scteInput").value = "";
    document.getElementById("results").innerHTML = "";
    document.getElementById("hexViewer").style.display = "none";
    document.getElementById("binaryViewer").style.display = "none";
    const ea = document.getElementById("exportArea"); if (ea) ea.style.display = "none";
    clearError();
  });

  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("scteInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); parseInput(); }
  });

  const copyJsonBtn = document.getElementById("copyJsonBtn");
  if (copyJsonBtn) copyJsonBtn.addEventListener("click", copyJSON);
  const dlJsonBtn = document.getElementById("downloadJsonBtn");
  if (dlJsonBtn) dlJsonBtn.addEventListener("click", downloadJSON);

  const clrHistBtn = document.getElementById("clearHistoryBtn");
  if (clrHistBtn) clrHistBtn.addEventListener("click", clearHistory);

  // Manifest scanner
  const scanBtn = document.getElementById("scanManifestBtn");
  if (scanBtn) scanBtn.addEventListener("click", scanManifest);
  const fetchBtn = document.getElementById("fetchManifestBtn");
  if (fetchBtn) fetchBtn.addEventListener("click", fetchManifest);
  const clrManBtn = document.getElementById("clearManifestBtn");
  if (clrManBtn) clrManBtn.addEventListener("click", () => {
    document.getElementById("manifestUrlInput").value = "";
    document.getElementById("manifestInput").value = "";
    document.getElementById("manifestResults").innerHTML = "";
    document.getElementById("manifestError").style.display = "none";
  });

  initTheme();
  renderSamples();
  renderHistory();

  // URL parameter support
  const params = new URLSearchParams(window.location.search);
  const scteParam = params.get("data") || params.get("scte35");
  if (scteParam) {
    document.getElementById("scteInput").value = scteParam;
    parseInput();
  }
});
