"use client";
import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCw,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_HEADLINE_FONT_SIZE_RATIO,
  DEFAULT_LABEL_FONT_SIZE_RATIO,
  FONT_OPTIONS,
  LAYOUT_HINT,
  LAYOUT_LABEL,
  fontById,
} from "@/lib/constants";
import { nid } from "@/lib/defaults";
import {
  isBuiltInElementId,
  isTextElementId,
  textElementKey,
  toTextElementId,
} from "@/lib/elements";
import { pickText, writeLocalized } from "@/lib/locale";
import type {
  BuiltInElementId,
  CaptionTypography,
  Device,
  ElementId,
  ElementTransform,
  Orientation,
  Slide,
  SlideBackground,
  SlideLayout,
  SlideTypography,
  TextElement,
} from "@/lib/types";
import { ScreenshotPicker } from "./screenshot-picker";
import { getCanvas, getElementTransform } from "./slide-canvas";

type Props = {
  slide: Slide;
  device: Device;
  orientation: Orientation;
  locale: string;
  selectedElementId: ElementId | null;
  onChange: (patch: Partial<Slide>) => void;
  onSelectElement: (id: ElementId | null) => void;
};

const ELEMENT_LABEL: Record<BuiltInElementId, string> = {
  caption: "Headline",
  device: "Device",
  deviceSecondary: "Back device",
};

export function Inspector({
  slide,
  device,
  orientation,
  locale,
  selectedElementId,
  onChange,
  onSelectElement,
}: Props) {
  const isFeatureGraphic = device === "feature-graphic" || slide.layout === "feature-graphic";
  const isNoDevice = slide.layout === "no-device";
  const layoutValue = device === "feature-graphic" ? "feature-graphic" : slide.layout;
  const layoutOptions = Object.entries(LAYOUT_LABEL).filter(([layout]) =>
    device === "feature-graphic" ? layout === "feature-graphic" : layout !== "feature-graphic",
  );
  const localeLabel = slide.label?.[locale] ?? "";
  const localeHeadline = slide.headline?.[locale] ?? "";
  // When the active locale is empty, surface the fallback (typically en) as
  // the placeholder so the user sees what they're translating from.
  const headlineDefault = isFeatureGraphic ? "Your tagline." : "One idea\nper slide.";
  const labelPlaceholder = localeLabel ? "FEATURE 01" : pickText(slide.label, locale) || "FEATURE 01";
  const headlinePlaceholder = localeHeadline
    ? headlineDefault
    : pickText(slide.headline, locale) || headlineDefault;

  function setLocaleField(key: "label" | "headline", value: string) {
    onChange({ [key]: writeLocalized(slide[key], locale, value) } as Partial<Slide>);
  }

  React.useEffect(() => {
    if (device === "feature-graphic" && slide.layout !== "feature-graphic") {
      onChange({ layout: "feature-graphic", transforms: undefined, screenshotSecondary: undefined });
    }
  }, [device, onChange, slide.layout]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Screen settings</h2>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            editing · {locale.toUpperCase()}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{LAYOUT_HINT[layoutValue]}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Layout</Label>
          <Select
            value={layoutValue}
            onValueChange={(layout) => {
              const next = layout as SlideLayout;
              onChange({
                layout: next,
                transforms: undefined,
                screenshotSecondary:
                  next === "two-devices" ? slide.screenshotSecondary || slide.screenshot : undefined,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {layoutOptions.map(([layout, label]) => (
                <SelectItem key={layout} value={layout}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AppearancePanel
          slide={slide}
          device={device}
          orientation={orientation}
          locale={locale}
          onChange={onChange}
        />

        {!isFeatureGraphic && (
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              value={localeLabel}
              onChange={(e) => setLocaleField("label", e.target.value)}
              placeholder={labelPlaceholder}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs">{isFeatureGraphic ? "Tagline" : "Headline"}</Label>
            <span className="text-[10px] text-muted-foreground">newline = break</span>
          </div>
          <Textarea
            value={localeHeadline}
            onChange={(e) => setLocaleField("headline", e.target.value)}
            rows={3}
            placeholder={headlinePlaceholder}
          />
        </div>

        {!isFeatureGraphic && !isNoDevice && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              {slide.layout === "two-devices" ? "Front device screenshot" : "Screenshot"}
            </Label>
            <ScreenshotPicker
              label="Primary"
              value={slide.screenshot}
              locale={locale}
              onChange={(v) => onChange({ screenshot: v })}
            />
          </div>
        )}

        {slide.layout === "two-devices" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Back device screenshot</Label>
            <ScreenshotPicker
              label="Secondary (back layer)"
              value={slide.screenshotSecondary || ""}
              locale={locale}
              onChange={(v) => onChange({ screenshotSecondary: v })}
            />
          </div>
        )}

        {!isFeatureGraphic && (
          <ElementTransformControls
            slide={slide}
            device={device}
            orientation={orientation}
            locale={locale}
            selectedElementId={selectedElementId}
            onChange={onChange}
            onSelectElement={onSelectElement}
          />
        )}

        {isFeatureGraphic && (
          <p className="rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            Shows app icon + name + tagline. Drop an icon at <span className="rounded bg-background px-1 py-0.5 font-mono text-[10px] text-foreground">/public/app-icon.png</span> (or leave blank — the app initial will be used). Name is set in the toolbar.
          </p>
        )}
      </div>
    </div>
  );
}

function AppearancePanel({
  slide,
  device,
  orientation,
  locale,
  onChange,
}: {
  slide: Slide;
  device: Device;
  orientation: Orientation;
  locale: string;
  onChange: (patch: Partial<Slide>) => void;
}) {
  const background: SlideBackground = slide.background || { mode: "theme", decorations: true };
  const mode = background.mode || "theme";
  const { cW, cH } = getCanvas(device, orientation);
  const unit = Math.min(cW, cH);
  const fallbackLabelSize = Math.round(unit * DEFAULT_LABEL_FONT_SIZE_RATIO);
  const fallbackHeadlineSize = Math.round(unit * DEFAULT_HEADLINE_FONT_SIZE_RATIO);
  const typography = slide.typography || {};
  const localeTypography = typography.locales?.[locale] || {};
  const defaultLabelFont = typography.labelFontFamily || slide.fontFamily || "system";
  const defaultHeadlineFont = typography.headlineFontFamily || slide.fontFamily || "system";
  const defaultLabelSize = typography.labelFontSize ?? fallbackLabelSize;
  const defaultHeadlineSize = typography.headlineFontSize ?? fallbackHeadlineSize;
  const localeLabelFont = localeTypography.labelFontFamily || defaultLabelFont;
  const localeHeadlineFont = localeTypography.headlineFontFamily || defaultHeadlineFont;
  const localeLabelSize = localeTypography.labelFontSize ?? defaultLabelSize;
  const localeHeadlineSize = localeTypography.headlineFontSize ?? defaultHeadlineSize;
  const sample =
    pickText(slide.headline, locale).replace(/\s+/g, " ").trim() ||
    pickText(slide.label, locale).trim() ||
    "교대근무 한눈에";

  function cleanCaptionTypography(value: CaptionTypography): CaptionTypography | undefined {
    const next: CaptionTypography = {
      ...(value.labelFontFamily ? { labelFontFamily: value.labelFontFamily } : {}),
      ...(value.headlineFontFamily ? { headlineFontFamily: value.headlineFontFamily } : {}),
      ...(typeof value.labelFontSize === "number" ? { labelFontSize: value.labelFontSize } : {}),
      ...(typeof value.headlineFontSize === "number" ? { headlineFontSize: value.headlineFontSize } : {}),
    };
    return Object.keys(next).length ? next : undefined;
  }

  function cleanTypography(value: SlideTypography): SlideTypography | undefined {
    const locales =
      value.locales && Object.keys(value.locales).length
        ? Object.fromEntries(
            Object.entries(value.locales)
              .map(([code, config]) => [code, config ? cleanCaptionTypography(config) : undefined])
              .filter((entry): entry is [string, CaptionTypography] => !!entry[1]),
          )
        : undefined;
    const base = cleanCaptionTypography(value);
    const next: SlideTypography = {
      ...(base || {}),
      ...(locales && Object.keys(locales).length ? { locales } : {}),
    };
    return Object.keys(next).length ? next : undefined;
  }

  function patchDefaultTypography(patch: CaptionTypography) {
    onChange({
      fontFamily: undefined,
      typography: cleanTypography({ ...typography, ...patch }),
    });
  }

  function patchLocaleTypography(patch: CaptionTypography) {
    const locales = { ...(typography.locales || {}) };
    const current = locales[locale] || {};
    const next = cleanCaptionTypography({ ...current, ...patch });
    if (next) locales[locale] = next;
    else delete locales[locale];
    onChange({
      fontFamily: undefined,
      typography: cleanTypography({ ...typography, locales }),
    });
  }

  function setBackgroundMode(nextMode: SlideBackground["mode"]) {
    if (nextMode === "theme") {
      onChange({
        background: {
          mode: "theme",
          decorations: background.decorations ?? true,
        },
      });
      return;
    }
    if (nextMode === "solid") {
      onChange({
        background: {
          mode: "solid",
          color: background.color || "#F8FAFC",
          decorations: background.decorations ?? true,
        },
      });
      return;
    }
    onChange({
      background: {
        mode: "gradient",
        color: background.color || "#F8FAFC",
        color2: background.color2 || "#DBEAFE",
        angle: background.angle ?? 160,
        decorations: background.decorations ?? true,
      },
    });
  }

  function patchBackground(patch: Partial<SlideBackground>) {
    onChange({
      background: {
        ...background,
        mode,
        ...patch,
      },
    });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div>
        <Label className="text-xs font-semibold">Appearance</Label>
        <p className="text-[11px] text-muted-foreground">Preview fonts and tune this screen's background.</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <FontSelect
            label="Label font"
            value={defaultLabelFont}
            onChange={(value) =>
              patchDefaultTypography({ labelFontFamily: value === "system" ? undefined : value })
            }
          />
          <FontSelect
            label="Headline font"
            value={defaultHeadlineFont}
            onChange={(value) =>
              patchDefaultTypography({ headlineFontFamily: value === "system" ? undefined : value })
            }
          />
        </div>
        <SizeSlider
          label="Label size"
          value={defaultLabelSize}
          min={Math.round(unit * 0.024)}
          max={Math.round(unit * 0.14)}
          step={1}
          onChange={(value) => patchDefaultTypography({ labelFontSize: value })}
          onReset={() => patchDefaultTypography({ labelFontSize: undefined })}
        />
        <SizeSlider
          label="Headline size"
          value={defaultHeadlineSize}
          min={Math.round(unit * 0.055)}
          max={Math.round(unit * 0.17)}
          step={1}
          onChange={(value) => patchDefaultTypography({ headlineFontSize: value })}
          onReset={() => patchDefaultTypography({ headlineFontSize: undefined })}
        />
        <div
          className="rounded border bg-background px-3 py-2 text-lg font-semibold leading-tight"
          style={{ fontFamily: fontById(defaultHeadlineFont).stack }}
        >
          {sample}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold">{locale.toUpperCase()} type</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => patchLocaleTypography({
              labelFontFamily: undefined,
              headlineFontFamily: undefined,
              labelFontSize: undefined,
              headlineFontSize: undefined,
            })}
          >
            Use default
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FontSelect
            label="Label font"
            value={localeLabelFont}
            onChange={(value) =>
              patchLocaleTypography({
                labelFontFamily: value === defaultLabelFont ? undefined : value,
              })
            }
          />
          <FontSelect
            label="Headline font"
            value={localeHeadlineFont}
            onChange={(value) =>
              patchLocaleTypography({
                headlineFontFamily: value === defaultHeadlineFont ? undefined : value,
              })
            }
          />
        </div>
        <SizeSlider
          label="Label size"
          value={localeLabelSize}
          min={Math.round(unit * 0.024)}
          max={Math.round(unit * 0.14)}
          step={1}
          onChange={(value) =>
            patchLocaleTypography({
              labelFontSize: value === defaultLabelSize ? undefined : value,
            })
          }
        />
        <SizeSlider
          label="Headline size"
          value={localeHeadlineSize}
          min={Math.round(unit * 0.055)}
          max={Math.round(unit * 0.17)}
          step={1}
          onChange={(value) =>
            patchLocaleTypography({
              headlineFontSize: value === defaultHeadlineSize ? undefined : value,
            })
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Background</Label>
        <Select value={mode} onValueChange={(value) => setBackgroundMode(value as SlideBackground["mode"])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="theme">Theme</SelectItem>
            <SelectItem value="solid">Solid color</SelectItem>
            <SelectItem value="gradient">Gradient</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode !== "theme" && (
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label={mode === "solid" ? "Color" : "Start"}
            value={background.color || "#F8FAFC"}
            onChange={(color) => patchBackground({ color })}
          />
          {mode === "gradient" && (
            <ColorField
              label="End"
              value={background.color2 || "#DBEAFE"}
              onChange={(color) => patchBackground({ color2: color })}
            />
          )}
        </div>
      )}

      {mode === "gradient" && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-muted-foreground">Angle</Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">{background.angle ?? 160}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={background.angle ?? 160}
            onChange={(event) => patchBackground({ angle: Number(event.target.value) })}
            className="w-full"
            aria-label="Gradient angle"
          />
        </div>
      )}

      <label className="flex items-center justify-between gap-3 rounded border bg-background/50 px-2 py-2 text-xs">
        <span>Use dark variant text</span>
        <input
          type="checkbox"
          checked={!!slide.inverted}
          onChange={(event) => onChange({ inverted: event.target.checked || undefined })}
        />
      </label>

      <label className="flex items-center justify-between gap-3 rounded border bg-background/50 px-2 py-2 text-xs">
        <span>Accent shapes</span>
        <input
          type="checkbox"
          checked={background.decorations !== false}
          onChange={(event) => patchBackground({ decorations: event.target.checked })}
        />
      </label>
    </div>
  );
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value || "system"} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_OPTIONS.map((font) => (
            <SelectItem key={font.id} value={font.id}>
              <span style={{ fontFamily: font.stack }}>{font.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SizeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onReset?: () => void;
}) {
  const clamped = Math.max(min, Math.min(max, Math.round(value)));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={clamped}
            onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
            className="h-7 w-16 px-2 text-right text-[11px]"
          />
          {onReset && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onReset}>
              Reset
            </Button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
        aria-label={label}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colorValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-[36px_1fr] gap-1">
        <Input
          type="color"
          value={colorValue}
          className="h-9 p-1"
          onChange={(event) => onChange(event.target.value)}
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

function ElementTransformControls({
  slide,
  device,
  orientation,
  locale,
  selectedElementId,
  onChange,
  onSelectElement,
}: {
  slide: Slide;
  device: Device;
  orientation: Orientation;
  locale: string;
  selectedElementId: ElementId | null;
  onChange: (patch: Partial<Slide>) => void;
  onSelectElement: (id: ElementId | null) => void;
}) {
  const present: ElementId[] = ["caption"];
  if (slide.layout !== "no-device") present.push("device");
  if (slide.layout === "two-devices") present.push("deviceSecondary");
  for (const element of slide.textElements || []) present.push(toTextElementId(element.id));

  const transforms = slide.transforms || {};
  const activeId =
    selectedElementId && present.includes(selectedElementId) ? selectedElementId : null;
  const activeTransform = activeId
    ? getElementTransform(slide, device, orientation, activeId)
    : undefined;
  const activeTextElement =
    activeId && isTextElementId(activeId)
      ? slide.textElements?.find((element) => element.id === textElementKey(activeId))
      : null;

  function getTransform(id: ElementId) {
    return getElementTransform(slide, device, orientation, id);
  }

  function patchElement(id: ElementId, patch: Partial<ElementTransform>) {
    const cur = getTransform(id);
    if (!cur) return;
    if (isTextElementId(id)) {
      const textId = textElementKey(id);
      onChange({
        textElements: (slide.textElements || []).map((element) =>
          element.id === textId
            ? { ...element, transform: { ...element.transform, ...patch } }
            : element,
        ),
      });
      return;
    }
    if (!isBuiltInElementId(id)) return;
    onChange({
      transforms: { ...transforms, [id]: { ...cur, ...patch } },
    });
  }

  function patchTextElement(id: string, patch: Partial<TextElement>) {
    onChange({
      textElements: (slide.textElements || []).map((element) =>
        element.id === id ? { ...element, ...patch } : element,
      ),
    });
  }

  function setTextElementValue(element: TextElement, value: string) {
    patchTextElement(element.id, { text: writeLocalized(element.text, locale, value) });
  }

  function deleteTextElement(element: TextElement) {
    const nextTextElements = (slide.textElements || []).filter((item) => item.id !== element.id);
    onChange({
      textElements: nextTextElements.length > 0 ? nextTextElements : undefined,
    });
    onSelectElement(null);
  }

  function addTextElement() {
    const { cW, cH } = getCanvas(device, orientation);
    const id = nid();
    const zIndex =
      Math.max(
        5,
        ...present.map((elementId) => getTransform(elementId)?.zIndex ?? defaultZ(elementId)),
      ) + 1;
    const element: TextElement = {
      id,
      text: writeLocalized({}, locale, "New text"),
      transform: {
        x: cW * 0.18,
        y: cH * 0.42,
        width: cW * 0.64,
        height: cH * 0.12,
        rotation: 0,
        zIndex,
      },
      fontSize: Math.round(Math.min(cW, cH) * 0.065),
      fontWeight: 800,
      align: "center",
    };
    onChange({ textElements: [...(slide.textElements || []), element] });
    onSelectElement(toTextElementId(id));
  }

  // Z-order: re-rank zIndex among present elements so they remain contiguous.
  function reorder(id: ElementId, dir: "front" | "back" | "up" | "down") {
    const ranked = [...present].sort((a, b) => {
      const za = getTransform(a)?.zIndex ?? defaultZ(a);
      const zb = getTransform(b)?.zIndex ?? defaultZ(b);
      return za - zb;
    });
    const idx = ranked.indexOf(id);
    if (idx === -1) return;
    let target = idx;
    if (dir === "front") target = ranked.length - 1;
    else if (dir === "back") target = 0;
    else if (dir === "up") target = Math.min(ranked.length - 1, idx + 1);
    else if (dir === "down") target = Math.max(0, idx - 1);
    if (target === idx) return;
    ranked.splice(idx, 1);
    ranked.splice(target, 0, id);
    const nextTransforms = { ...transforms };
    const nextTextElements = (slide.textElements || []).map((element) => ({
      ...element,
      transform: { ...element.transform },
    }));
    ranked.forEach((eid, i) => {
      const cur = getTransform(eid);
      if (!cur) return;
      if (isTextElementId(eid)) {
        const textId = textElementKey(eid);
        const textElement = nextTextElements.find((element) => element.id === textId);
        if (textElement) textElement.transform = { ...textElement.transform, zIndex: i + 1 };
      } else if (isBuiltInElementId(eid)) {
        nextTransforms[eid] = { ...cur, zIndex: i + 1 };
      }
    });
    onChange({ transforms: nextTransforms, textElements: nextTextElements });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="text-xs font-semibold">Elements</Label>
          <p className="text-[11px] text-muted-foreground">
            {activeId
              ? "Fine-tune the selected element's rotation and stacking."
              : "Click an element on the canvas to fine-tune its rotation and stacking."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={addTextElement}
        >
          <Plus className="h-3.5 w-3.5" />
          Text
        </Button>
      </div>

      {activeId ? (
        <ActiveElementPanel
          activeId={activeId}
          transform={activeTransform}
          textElement={activeTextElement || undefined}
          locale={locale}
          onRotate={(rotation) => patchElement(activeId, { rotation })}
          onReorder={(dir) => reorder(activeId, dir)}
          onTextChange={(value) => {
            if (activeTextElement) setTextElementValue(activeTextElement, value);
          }}
          onTextPatch={(patch) => {
            if (activeTextElement) patchTextElement(activeTextElement.id, patch);
          }}
          onDeleteText={() => {
            if (activeTextElement) deleteTextElement(activeTextElement);
          }}
        />
      ) : (
        <div className="rounded border border-dashed bg-background/40 p-4 text-center text-[11px] text-muted-foreground">
          No element selected
        </div>
      )}
    </div>
  );
}

function ActiveElementPanel({
  activeId,
  transform,
  textElement,
  locale,
  onRotate,
  onReorder,
  onTextChange,
  onTextPatch,
  onDeleteText,
}: {
  activeId: ElementId;
  transform: ElementTransform | undefined;
  textElement?: TextElement;
  locale: string;
  onRotate: (rotation: number) => void;
  onReorder: (dir: "front" | "back" | "up" | "down") => void;
  onTextChange: (value: string) => void;
  onTextPatch: (patch: Partial<TextElement>) => void;
  onDeleteText: () => void;
}) {
  const engaged = !!transform;
  const rotation = transform?.rotation ?? 0;
  const label = elementLabel(activeId);
  return (
    <div className="space-y-2 rounded border bg-background/60 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-medium">
          {textElement && <Type className="h-3.5 w-3.5" />}
          {label}
        </span>
        {textElement ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:text-destructive"
            onClick={onDeleteText}
            title="Delete text element"
            aria-label="Delete text element"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : !engaged ? (
          <span className="text-[10px] text-muted-foreground">drag to enable</span>
        ) : null}
      </div>

      {textElement && (
        <TextElementPanel
          element={textElement}
          locale={locale}
          onTextChange={onTextChange}
          onTextPatch={onTextPatch}
        />
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <RotateCw className="h-3 w-3" /> Rotation
          </Label>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {rotation}°
          </span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rotation}
          disabled={!engaged}
          onChange={(e) => onRotate(Number(e.target.value))}
          className="w-full disabled:opacity-50"
          aria-label={`${label} rotation`}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Layer</Label>
        <div className="grid grid-cols-4 gap-1">
          <LayerButton disabled={!engaged} onClick={() => onReorder("back")} label="Send to back">
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton disabled={!engaged} onClick={() => onReorder("down")} label="Send backward">
            <ChevronDown className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton disabled={!engaged} onClick={() => onReorder("up")} label="Bring forward">
            <ChevronUp className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton disabled={!engaged} onClick={() => onReorder("front")} label="Bring to front">
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </LayerButton>
        </div>
      </div>
    </div>
  );
}

function TextElementPanel({
  element,
  locale,
  onTextChange,
  onTextPatch,
}: {
  element: TextElement;
  locale: string;
  onTextChange: (value: string) => void;
  onTextPatch: (patch: Partial<TextElement>) => void;
}) {
  const text = element.text?.[locale] ?? pickText(element.text, locale);
  return (
    <div className="space-y-2 rounded border bg-muted/30 p-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Text</Label>
        <Textarea
          value={text}
          rows={2}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Overlay text"
        />
      </div>
      <div className="grid grid-cols-[1fr_76px] gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Size</Label>
          <Input
            type="number"
            min={12}
            max={400}
            value={Math.round(element.fontSize || 72)}
            onChange={(event) => onTextPatch({ fontSize: Number(event.target.value) || 72 })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Color</Label>
          <Input
            type="color"
            value={element.color || "#171717"}
            className="h-9 p-1"
            onChange={(event) => onTextPatch({ color: event.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Font</Label>
        <Select
          value={element.fontFamily || "inherit"}
          onValueChange={(value) =>
            onTextPatch({ fontFamily: value === "inherit" ? undefined : value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Match screen</SelectItem>
            {FONT_OPTIONS.map((font) => (
              <SelectItem key={font.id} value={font.id}>
                <span style={{ fontFamily: font.stack }}>{font.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <LayerButton
          disabled={false}
          onClick={() => onTextPatch({ align: "left" })}
          label="Align left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </LayerButton>
        <LayerButton
          disabled={false}
          onClick={() => onTextPatch({ align: "center" })}
          label="Align center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </LayerButton>
        <LayerButton
          disabled={false}
          onClick={() => onTextPatch({ align: "right" })}
          label="Align right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </LayerButton>
      </div>
    </div>
  );
}

function LayerButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-0"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}

function elementLabel(id: ElementId): string {
  if (isBuiltInElementId(id)) return ELEMENT_LABEL[id];
  return "Text";
}

function defaultZ(id: ElementId): number {
  if (isTextElementId(id)) return 5;
  if (id === "deviceSecondary") return 2;
  if (id === "device") return 3;
  return 4; // caption on top
}
