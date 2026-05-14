# SCTE-35 Parser — Online Binary Decoder & Analyzer

A zero-dependency, browser-based tool for parsing and analyzing SCTE-35 splice_info_section messages per **ANSI/SCTE 35 2024**.

## Live Demo
https://alsameema.github.io/SCTE-35-Parser-Online-Binary-Decoder-Analyzer/

![SCTE-35 Parser Screenshot](https://img.shields.io/badge/SCTE--35-Parser-e91e63?style=for-the-badge)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)
![Pure HTML/CSS/JS](https://img.shields.io/badge/stack-HTML%2FCSS%2FJS-blue?style=for-the-badge)

---

## Features

### Input Formats
- **Base64** — Standard SCTE-35 binary encoding
- **Hexadecimal** — Raw hex with optional `0x` prefix
- **HLS `#EXT-X-SCTE35`** — `CUE="..."` attribute extraction
- **HLS `#EXT-X-DATERANGE`** — `SCTE35-OUT`, `SCTE35-IN`, `SCTE35-CMD` hex attributes
- **DASH `EventStream`** — XML element with base64/hex payloads
- **URL parameter** — `?data=<base64>` or `?scte35=<base64>`

### Splice Commands
| Command | Type ID |
|---------|---------|
| splice_null | 0x00 |
| splice_schedule | 0x04 |
| splice_insert | 0x05 |
| time_signal | 0x06 |
| bandwidth_reservation | 0x07 |
| private_command | 0xFF |

### Parsed Fields
- Full `splice_info_section` header (table_id, section_length, protocol_version, encrypted_packet, pts_adjustment, cw_index, tier)
- `splice_insert` — splice_event_id, out_of_network_indicator, splice_time, break_duration, auto_return, unique_program_id, avail_num/avails_expected
- `time_signal` — splice_time PTS with formatted HH:MM:SS.mmm
- `segmentation_descriptor` — segmentation_event_id, segmentation_type_id, segmentation_upid (with type names), segmentation_duration (40-bit), segment_num/segments_expected, sub_segment fields (§10.3.3.1)
- `avail_descriptor` — provider_avail_id
- `dtmf_descriptor` — preroll, dtmf_chars
- All hex fields display both hex and decimal: `0xFC (252)`

### Validation
- **CRC-32/MPEG-2** — Computed and validated against the message CRC

### Viewers
- **Hex Viewer** — Color-coded byte dump with ASCII column and region legend
- **Binary Bit Viewer** — Bit-level breakdown of the splice_info_section header fields

### Manifest SCTE-35 Scanner
- Paste or fetch an **HLS** or **DASH** manifest
- Automatically finds and parses all SCTE-35 markers
- Supports `#EXT-X-SCTE35`, `#EXT-X-DATERANGE`, `#EXT-X-CUE-OUT/IN`, vendor tags, DASH `EventStream`
- CORS proxy fallback (allorigins.win, corsproxy.io) for cross-origin fetches

### UI
- Dark / Light theme toggle
- Parse history (localStorage, max 20 entries)
- Sample inputs for quick testing
- Copy individual fields, sections, or all fields
- Export parsed result as JSON (copy or download)
- Responsive layout (desktop, tablet, mobile)

---

## Usage

1. Open [the live tool](https://alsameema.github.io/SCTE-35-Parser-Online-Binary-Decoder-Analyzer/) or serve locally
2. Paste SCTE-35 data in any supported format
3. Click **Parse** (or press `Ctrl+Enter`)
4. View decoded fields, hex dump, and binary breakdown

### Run Locally

No build step required. Open `index.html` in any modern browser:

```bash
git clone https://github.com/ALSAMEEMA/SCTE-35-Parser-Online-Binary-Decoder-Analyzer.git
cd SCTE-35-Parser-Online-Binary-Decoder-Analyzer
# Open index.html in your browser
```

---

## Specification Compliance

Implemented per **ANSI/SCTE 35 2024**:

- `segmentation_duration` — 40 bits (§10.3.3)
- `sub_segment_num` / `sub_segments_expected` — Only for type_id 0x34 and 0x36 (§10.3.3.1)
- `segmentation_event_id_compliance_indicator` — 1-bit field after cancel indicator
- All reserved bits properly skipped
- PTS values — 33-bit unsigned (avoids JS signed integer issues)
- CRC-32 — MPEG-2 polynomial (0x04C11DB7)

---

## Project Structure

```
├── index.html    — UI layout and structure
├── script.js     — Parser engine, manifest scanner, rendering, and UI logic
├── style.css     — Styles, themes, responsive breakpoints
└── README.md
```

---

## Other Streaming Tools

| Tool | Link |
|------|------|
| HLS Manifest Viewer | [GitHub](https://github.com/ALSAMEEMA/HLS-Manifest-Viewer-Online-m3u8-Parser-Analyzer) |
| DASH MPD Analyser | [GitHub](https://github.com/ALSAMEEMA/DASH-MPD-Analyzer-Online-Parser-Viewer) |
| DRM PSSH Decoder | [GitHub](https://github.com/ALSAMEEMA/DRM-PSSH-Decoder-Online-Widevine-PlayReady-FairPlay-Parser) |
| Codec String Parser | [GitHub](https://github.com/ALSAMEEMA/Codec_String_Parser) |
| CMAF Inspector | [GitHub](https://github.com/ALSAMEEMA/CMAF-Inspector-Online-fMP4-CMAF-Atom-Parser-Analyzer) |

---

## License

MIT
