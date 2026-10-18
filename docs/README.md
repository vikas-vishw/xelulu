# Xelulu source documents

These are the source documents for the Xelulu product. Document B is a frozen contract: it changes only with a `proto_ver` bump and sign-off from both the software and hardware sides.

| File | What it is | Original filename |
|---|---|---|
| `A-master-build-guide.docx` | Document A: master build guide (roles, stack, ElatoAI reuse, folder layout, `.env` panel, phases 0–7) | `A_Xelulu_Master_Build_Guide.docx` |
| `B-gateway-and-hardware-seam.docx` | Document B: device-to-cloud contract (MQTT topics, message schemas, audio WebSocket, on-device safety). **Frozen, proto_ver 2** (v2.0, 8 Oct 2026; supersedes proto_ver 1). | `B_Xelulu_Gateway_and_Hardware_Seam_v2.docx` |
| `C-pairing-and-device-session.md` | Document C: MQTT pairing and the Device_Session lifecycle, additive to Document B v2. Part 1 (BLE / Wi-Fi provisioning) is reserved; Part 2 is **frozen** and adds no topic, message, field or transport. | written here (ours, markdown) |
| `intern-integration-guide.md` | The hardware engineer's bring-up guide: run the stack, pair a device, walk the console's test matrix, and the firmware-to-Document-B conformance checklist. A guide, not a contract: it adds nothing to Documents B and C and holds no precedence. | written here (ours, markdown) |
| `xelulu-feature-catalogue.docx` | Feature catalogue for the product family (feature IDs V/G/T/M/L/C with P0/P1/P2 priorities) | `xelulu .docx` |
| `hardware-order-review.docx` | Hardware order and design review (ESP32-S3 + body controller, no camera/dock in v1, NFC, age stages, DPDP) | `Xelulu_Order_and_Hardware_Review.docx` |
| `intern-software-spec.pdf` | Intern's software spec (app areas, roles, data models, latency, offline). Where it conflicts with Document B, Document B wins. | `Xelulu_Software_Spec.pdf` |
| `design/parent-app-experience-board.png` | Parent app experience board (screen designs) | `Xelulu Parent App Experience Board.png` |
| `procurement/SO286370-robu-quotation.pdf` | Robu parts quotation (procurement reference only) | `SO286370.pdf` |

## Precedence when documents disagree
1. Document B (wire contract)
2. Document C (pairing and the device session; additive to Document B, which wins on any overlap)
3. Hardware order review (v1 hardware facts)
4. Document A (master build guide)
5. Feature catalogue and intern software spec