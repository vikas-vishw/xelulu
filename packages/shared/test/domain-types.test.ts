// Requirement 15: domain interface shapes (compile-time checks plus a static scan of the sources).
// The expectTypeOf assertions are enforced by `tsc -p tsconfig.test.json`; the runtime checks run
// against the built entry (design D5).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as ns from "../dist/index.js";
import { contentRowClass, DEFAULT_TRANSCRIPT_RETENTION_DAYS } from "../dist/index.js";
import type {
  AgeStage,
  ChildProfile,
  Consent,
  ConsentPurpose,
  ContentItem,
  ContentItemBase,
  ContentRowClass,
  CryEventMessage,
  Device,
  Event,
  EventDataFor,
  EventKind,
  GlobalContentItem,
  GrandmaAsset,
  Household,
  HouseholdContentItem,
  Report,
  ReportPeriod,
  Session,
  TouchEventMessage,
  TranscriptSpeaker,
  TranscriptTurn,
  User,
  UserRole,
  VerificationMethod,
} from "../dist/index.js";

// ---------------------------------------------------------------------------------------------
// Binary-field detector (Requirement 15.11): true when any field, or any array element of a
// field, is a buffer, typed array or blob.
type BinaryLike = ArrayBufferLike | ArrayBufferView | Blob;
type ElementOf<V> = V extends readonly (infer E)[] ? E : V;
type IsBinary<V> = [Extract<ElementOf<NonNullable<V>>, BinaryLike>] extends [never] ? false : true;
type HasBinaryField<T> = true extends { [K in keyof T]-?: IsBinary<T[K]> }[keyof T] ? true : false;

describe("domain interface types (Requirement 15)", () => {
  it("detects binary fields, so the HasBinaryField check is not vacuous", () => {
    expectTypeOf<HasBinaryField<{ a: Uint8Array }>>().toEqualTypeOf<true>();
    expectTypeOf<HasBinaryField<{ a: string; b?: ArrayBuffer[] }>>().toEqualTypeOf<true>();
    expectTypeOf<HasBinaryField<{ a: Buffer | null }>>().toEqualTypeOf<true>();
    expectTypeOf<HasBinaryField<{ a: string; b: number[] }>>().toEqualTypeOf<false>();
  });

  it("has no binary field in any domain interface (15.11)", () => {
    expectTypeOf<HasBinaryField<Household>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<User>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<ChildProfile>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Device>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Session>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<TranscriptTurn>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Event>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Event["data"]>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<HouseholdContentItem>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<GlobalContentItem>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<GrandmaAsset>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Consent>>().toEqualTypeOf<false>();
    expectTypeOf<HasBinaryField<Report>>().toEqualTypeOf<false>();
  });

  it("requires a household_id string on household-scoped interfaces (15.2)", () => {
    expectTypeOf<Household["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<User["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<ChildProfile["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Device["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Session["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Event["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<HouseholdContentItem["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<GrandmaAsset["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Consent["household_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Report["household_id"]>().toEqualTypeOf<string>();
  });

  it("splits content into exactly two row classes (15.2, 15.13)", () => {
    expectTypeOf<GlobalContentItem["household_id"]>().toEqualTypeOf<null>();
    expectTypeOf<ContentItem>().toEqualTypeOf<HouseholdContentItem | GlobalContentItem>();
    expectTypeOf<ContentRowClass>().toEqualTypeOf<"household" | "global">();
    expectTypeOf<Omit<HouseholdContentItem, "household_id">>().toEqualTypeOf<ContentItemBase>();
    expectTypeOf<Omit<GlobalContentItem, "household_id">>().toEqualTypeOf<ContentItemBase>();
    expectTypeOf<ContentItemBase["age_stages"]>().toEqualTypeOf<AgeStage[]>();
  });

  it("types User role and ChildProfile date and stage (15.3, 15.4)", () => {
    expectTypeOf<User["role"]>().toEqualTypeOf<UserRole>();
    expectTypeOf<UserRole>().toEqualTypeOf<"parent" | "caregiver" | "grandma">();
    expectTypeOf<ChildProfile["date_of_birth"]>().toEqualTypeOf<string>();
    expectTypeOf<ChildProfile["age_stage"]>().toEqualTypeOf<AgeStage>();
    expectTypeOf<AgeStage>().toEqualTypeOf<"tiny" | "little" | "explorer" | "maker">();
    expectTypeOf<ChildProfile["name_pronunciation"]>().toEqualTypeOf<string | null>();
  });

  it("requires a non-nullable consent_record_id on GrandmaAsset (15.5)", () => {
    expectTypeOf<GrandmaAsset["consent_record_id"]>().toEqualTypeOf<string>();
    expectTypeOf<GrandmaAsset["recording_storage_path"]>().toEqualTypeOf<string>();
  });

  it("records who, what, when, version and method on Consent (15.6)", () => {
    expectTypeOf<Consent["user_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Consent["purpose"]>().toEqualTypeOf<ConsentPurpose>();
    expectTypeOf<ConsentPurpose>().toEqualTypeOf<
      "child_data_processing" | "grandma_recording" | "grandma_voice_clone"
    >();
    expectTypeOf<Consent["given_at"]>().toEqualTypeOf<string>();
    expectTypeOf<Consent["version"]>().toEqualTypeOf<string>();
    expectTypeOf<Consent["verification_method"]>().toEqualTypeOf<VerificationMethod>();
    expectTypeOf<Consent["withdrawn_at"]>().toEqualTypeOf<string | null>();
  });

  it("keeps transcript turns text-only with an expiry (15.7)", () => {
    expectTypeOf<keyof TranscriptTurn>().toEqualTypeOf<"speaker" | "text" | "at">();
    expectTypeOf<TranscriptTurn["speaker"]>().toEqualTypeOf<TranscriptSpeaker>();
    expectTypeOf<TranscriptSpeaker>().toEqualTypeOf<"child" | "xelulu">();
    expectTypeOf<TranscriptTurn["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Session["transcript"]>().toEqualTypeOf<TranscriptTurn[]>();
    expectTypeOf<Session["transcript_expires_at"]>().toEqualTypeOf<string>();
  });

  it("requires device_id and household_id on Device (15.9)", () => {
    expectTypeOf<Device["device_id"]>().toEqualTypeOf<string>();
    expectTypeOf<keyof Device>().toEqualTypeOf<
      "device_id" | "household_id" | "display_name" | "fw_ver" | "last_seen_at" | "provisioned_at"
    >();
  });

  it("ties Event data to the contract event data for its kind (15.10)", () => {
    expectTypeOf<Event<"cry">["data"]>().toEqualTypeOf<CryEventMessage["data"]>();
    expectTypeOf<Event<"touch">["data"]>().toEqualTypeOf<TouchEventMessage["data"]>();
    expectTypeOf<Event["data"]>().toEqualTypeOf<EventDataFor<EventKind>>();
    expectTypeOf<Event["event"]>().toEqualTypeOf<EventKind>();
    expectTypeOf<Event["event_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Event["device_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Event["ts"]>().toEqualTypeOf<number>();
    expectTypeOf<Event["received_at"]>().toEqualTypeOf<string>();
    expectTypeOf<Event["time_uncertain"]>().toEqualTypeOf<boolean>();
  });

  it("types Report period, child, start and generation time (15.12)", () => {
    expectTypeOf<Report["period"]>().toEqualTypeOf<ReportPeriod>();
    expectTypeOf<ReportPeriod>().toEqualTypeOf<"daily" | "weekly">();
    expectTypeOf<Report["child_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Report["period_start"]>().toEqualTypeOf<string>();
    expectTypeOf<Report["generated_at"]>().toEqualTypeOf<string>();
  });
});

// ---------------------------------------------------------------------------------------------
// Static scan of src/domain/*.ts. Comments are stripped first, so only code is inspected; field
// names are the identifiers before `:` inside interface bodies.
const DOMAIN_DIR = new URL("../src/domain/", import.meta.url);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const domainSources: ReadonlyMap<string, string> = new Map(
  readdirSync(DOMAIN_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => [name, stripComments(readFileSync(new URL(name, DOMAIN_DIR), "utf8"))]),
);

type ScannedField = { readonly iface: string; readonly field: string; readonly file: string };

const scannedFields: readonly ScannedField[] = [...domainSources].flatMap(([file, code]) =>
  [...code.matchAll(/interface\s+(\w+)[^{]*\{([^}]*)\}/g)].flatMap((m) =>
    [...(m[2] ?? "").matchAll(/^\s*(?:readonly\s+)?(\w+)\??\s*:/gm)].map((f) => ({
      iface: m[1] ?? "",
      field: f[1] ?? "",
      file,
    })),
  ),
);

describe("domain sources (static scan, Requirement 15)", () => {
  it("finds every domain interface, so the scan is not vacuous", () => {
    expect([...new Set(scannedFields.map((f) => f.iface))].sort()).toEqual(
      [
        // Phase 4 adds three: ActivityRecord (Req 14.1) and the ContentStep/ContentChoice pair
        // that carries a Content_Item's spoken steps (Req 1.2).
        "ActivityRecord",
        "ChildProfile",
        "Consent",
        "ContentChoice",
        "ContentItemBase",
        "ContentStep",
        "Device",
        "Event",
        "GlobalContentItem",
        "GrandmaAsset",
        "Household",
        "HouseholdContentItem",
        "Report",
        "Session",
        "TranscriptTurn",
        "User",
      ].sort(),
    );
  });

  it("uses lowercase snake_case for every field name (15.1)", () => {
    const bad = scannedFields.filter((f) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(f.field));
    expect(bad).toEqual([]);
  });

  it("has no secret-like field names (15.9)", () => {
    // Matched per snake_case word, so `time_uncertain` does not count as `cert`.
    const secretWords = new Set([
      "token",
      "secret",
      "password",
      "passwd",
      "auth",
      "authorization",
      "cert",
      "certificate",
      "credential",
      "credentials",
      "key",
      "apikey",
    ]);
    const secretLike = scannedFields.filter((f) =>
      f.field.split("_").some((word) => secretWords.has(word)),
    );
    expect(secretLike).toEqual([]);
  });

  it("names no binary type anywhere in the domain code (15.11)", () => {
    const binary =
      /\b(?:Big)?(?:Ui|I)nt(?:8|16|32|64)(?:Clamped)?Array\b|\bFloat(?:16|32|64)Array\b|\b(?:Shared)?ArrayBuffer\b|\bBuffer\b|\bBlob\b|\bDataView\b/;
    const hits = [...domainSources].filter(([, code]) => binary.test(code)).map(([file]) => file);
    expect(hits).toEqual([]);
  });

  it("references audio only through GrandmaAsset.recording_storage_path (15.5, 15.11)", () => {
    const audioLike = scannedFields.filter((f) => /audio|recording|voice|sound/.test(f.field));
    expect(audioLike.map((f) => `${f.iface}.${f.field}`)).toEqual([
      "GrandmaAsset.recording_storage_path",
    ]);
  });

  it("exports no runtime validator for the domain interfaces (15.1)", () => {
    const names = [
      "Household",
      "User",
      "ChildProfile",
      "Device",
      "Session",
      "Event",
      "ContentItem",
      "HouseholdContentItem",
      "GlobalContentItem",
      "GrandmaAsset",
      "Consent",
      "Report",
    ];
    const keys = Object.keys(ns);
    const validators = keys.filter((k) =>
      names.some((n) => k === n || k === `${n}Schema` || k === `parse${n}`),
    );
    expect(validators).toEqual([]);
  });
});

describe("domain runtime values", () => {
  it("defaults transcript retention to 30 days (15.8)", () => {
    expect(DEFAULT_TRANSCRIPT_RETENTION_DAYS).toBe(30);
  });

  it("classifies content rows by household_id (15.14)", () => {
    const base: ContentItemBase = {
      content_id: "ct_001",
      kind: "story",
      title: "The clever crow",
      languages: ["en-IN"],
      age_stages: ["little", "explorer"],
      categories: ["fables"],
      // Phase 4 (C3): the spoken content, the editorial state and the provenance.
      steps: [],
      status: "draft",
      licence_note: "original retelling",
      source: "panchatantra",
      created_at: "2026-10-08T09:30:00Z",
      updated_at: "2026-10-08T09:30:00Z",
    };
    const householdRow: HouseholdContentItem = { ...base, household_id: "hh_001" };
    const globalRow: GlobalContentItem = { ...base, household_id: null };
    expect(contentRowClass(householdRow)).toBe("household");
    expect(contentRowClass(globalRow)).toBe("global");
    expect(contentRowClass({ ...base, household_id: "" })).toBe("household");
  });
});
