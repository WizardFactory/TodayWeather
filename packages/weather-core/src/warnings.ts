type SourceState = "current" | "unavailable" | "unsupported";

type WarningSource = {
  issuer: string;
  state: SourceState;
  issuerLabel?: string;
  sourceUrl?: string;
  asOf?: string;
  freshUntil?: string;
};

type Warning = {
  id: string;
  issuer: string;
  event: string;
  issuerLabel?: string;
  sourceUrl?: string;
  severity?: string;
  language?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  sentAt?: string;
  onsetAt?: string;
  effectiveAt: string;
  expiresAt: string;
  endsAt?: string;
};

export type CoordinateWarnings = {
  location: { lat: number; lon: number; country?: string | null };
  checkedAt: string;
  sources: WarningSource[];
  warnings: Warning[];
};

const object = (input: unknown): Record<string, unknown> | undefined =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;

const time = (input: unknown): input is string =>
  typeof input === "string" && Number.isFinite(Date.parse(input));

function isSource(input: unknown): input is WarningSource {
  const source = object(input);
  if (!source || typeof source.issuer !== "string") return false;
  return source.state === "unsupported" || source.state === "unavailable" ||
    (source.state === "current" && time(source.asOf) && time(source.freshUntil));
}

function isWarning(input: unknown): input is Warning {
  const row = object(input);
  return !!row && typeof row.id === "string" && typeof row.issuer === "string" &&
    typeof row.event === "string" && time(row.effectiveAt) && time(row.expiresAt) &&
    (row.endsAt === undefined || time(row.endsAt));
}

export function decodeCoordinateWarnings(
  input: unknown,
  point: { lat: number; lon: number },
): CoordinateWarnings | undefined {
  const data = object(input);
  const location = object(data?.location);
  if (!data || !location || location.lat !== point.lat || location.lon !== point.lon ||
      !time(data.checkedAt) || !Array.isArray(data.sources) || !data.sources.length ||
      !data.sources.every(isSource) || !Array.isArray(data.warnings) || !data.warnings.every(isWarning)) return;
  const country = typeof location.country === "string" ? location.country : null;
  return {location: {...point, country}, checkedAt: data.checkedAt, sources: data.sources, warnings: data.warnings};
}

export function warningsAt(response: CoordinateWarnings, now = Date.now()): CoordinateWarnings {
  const sources = response.sources.map(source => source.state === "current" && (!source.freshUntil || Date.parse(source.freshUntil) <= now)
    ? {...source, state: "unavailable" as const} : source);
  const current = new Set(sources.filter(source => source.state === "current").map(source => source.issuer));
  const warnings = response.warnings.filter(row =>
    current.has(row.issuer) && Date.parse(row.effectiveAt) <= now && Date.parse(row.expiresAt) > now &&
    (row.endsAt === undefined || Date.parse(row.endsAt) > now));
  return {...response, sources, warnings};
}
