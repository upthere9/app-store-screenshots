import type { Device, LocalizedText, ProjectState, Slide } from "./types";

const DEVICE_KEYS: Device[] = [
  "iphone",
  "ipad",
  "android",
  "android-7",
  "android-10",
  "feature-graphic",
];

export type LocalizationImportSummary = {
  localesAdded: number;
  slidesUpdated: number;
  fieldsUpdated: number;
  ignoredItems: number;
};

export type LocalizationExport = {
  locales: string[];
  slidesByDevice: Partial<
    Record<
      Device,
      Record<
        string,
        {
          label: LocalizedText;
          headline: LocalizedText;
        }
      >
    >
  >;
};

export function normalizeLocaleCode(value: string): string | null {
  const code = value.trim().replace(/_/g, "-");
  if (!code) return null;
  const parts = code.split("-").filter(Boolean);
  if (!parts.length) return null;
  if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) return null;
  const normalized = parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[a-zA-Z]{4}$/.test(part)) {
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    }
    if (/^[a-zA-Z]{2}$/.test(part)) return part.toUpperCase();
    if (/^\d{3}$/.test(part)) return part;
    return part;
  });
  const next = normalized.join("-");
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(next) ? next : null;
}

export function normalizeLocaleList(values: string[] | string): string[] {
  const parts = Array.isArray(values) ? values : values.split(/[\s,]+/);
  const seen = new Set<string>();
  const locales: string[] = [];
  for (const part of parts) {
    const code = normalizeLocaleCode(part);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    locales.push(code);
  }
  return locales;
}

export function mergeLocalizationImport(
  state: ProjectState,
  payload: unknown,
): { state: ProjectState; summary: LocalizationImportSummary } {
  const summary: LocalizationImportSummary = {
    localesAdded: 0,
    slidesUpdated: 0,
    fieldsUpdated: 0,
    ignoredItems: 0,
  };

  if (!payload || typeof payload !== "object") {
    return { state, summary: { ...summary, ignoredItems: 1 } };
  }

  const raw = payload as {
    locales?: unknown;
    slidesByDevice?: unknown;
    slides?: unknown;
  };
  const importLocales = Array.isArray(raw.locales)
    ? normalizeLocaleList(raw.locales.filter((value): value is string => typeof value === "string"))
    : [];
  const allLocales = new Set(state.locales);
  for (const locale of importLocales) allLocales.add(locale);

  let slidesUpdated = 0;
  let fieldsUpdated = 0;
  let ignoredItems = 0;
  const updatedSlideIds = new Set<string>();

  function mergeText(field: LocalizedText, value: unknown): { field: LocalizedText; count: number } {
    if (!value || typeof value !== "object") {
      ignoredItems += value === undefined ? 0 : 1;
      return { field, count: 0 };
    }
    const next: LocalizedText = { ...field };
    let count = 0;
    for (const [rawLocale, rawText] of Object.entries(value)) {
      const locale = normalizeLocaleCode(rawLocale);
      if (!locale || typeof rawText !== "string") {
        ignoredItems += 1;
        continue;
      }
      allLocales.add(locale);
      if (rawText.length === 0) {
        if (locale in next) {
          delete next[locale];
          count += 1;
        }
      } else if (next[locale] !== rawText) {
        next[locale] = rawText;
        count += 1;
      }
    }
    return { field: next, count };
  }

  function mergeSlide(slide: Slide, patch: unknown): Slide {
    if (!patch || typeof patch !== "object") {
      ignoredItems += 1;
      return slide;
    }
    const rawPatch = patch as { label?: unknown; headline?: unknown };
    const label = mergeText(slide.label, rawPatch.label);
    const headline = mergeText(slide.headline, rawPatch.headline);
    const count = label.count + headline.count;
    if (!count) return slide;
    fieldsUpdated += count;
    updatedSlideIds.add(slide.id);
    return {
      ...slide,
      label: label.field,
      headline: headline.field,
    };
  }

  function patchForSlide(collection: unknown, slide: Slide): unknown {
    if (!collection || typeof collection !== "object") return undefined;
    if (Array.isArray(collection)) {
      return collection.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === slide.id);
    }
    return (collection as Record<string, unknown>)[slide.id];
  }

  const slidesByDevice = { ...state.slidesByDevice };
  const rawByDevice = raw.slidesByDevice && typeof raw.slidesByDevice === "object" ? raw.slidesByDevice : {};
  const flatSlides = raw.slides && typeof raw.slides === "object" ? raw.slides : undefined;

  for (const device of DEVICE_KEYS) {
    const slides = slidesByDevice[device] || [];
    const deviceCollection = (rawByDevice as Partial<Record<Device, unknown>>)[device];
    slidesByDevice[device] = slides.map((slide) => {
      const patch = patchForSlide(deviceCollection, slide) ?? patchForSlide(flatSlides, slide);
      return patch ? mergeSlide(slide, patch) : slide;
    });
  }

  slidesUpdated = updatedSlideIds.size;
  const locales = Array.from(allLocales);
  summary.localesAdded = locales.filter((locale) => !state.locales.includes(locale)).length;
  summary.slidesUpdated = slidesUpdated;
  summary.fieldsUpdated = fieldsUpdated;
  summary.ignoredItems = ignoredItems;

  return {
    state: {
      ...state,
      locales,
      locale: locales.includes(state.locale) ? state.locale : locales[0] || "en",
      slidesByDevice,
    },
    summary,
  };
}

export function buildLocalizationExport(state: ProjectState): LocalizationExport {
  const slidesByDevice: LocalizationExport["slidesByDevice"] = {};
  for (const device of DEVICE_KEYS) {
    const slides = state.slidesByDevice[device] || [];
    if (!slides.length) continue;
    slidesByDevice[device] = Object.fromEntries(
      slides.map((slide) => [
        slide.id,
        {
          label: { ...slide.label },
          headline: { ...slide.headline },
        },
      ]),
    );
  }
  return {
    locales: [...state.locales],
    slidesByDevice,
  };
}
