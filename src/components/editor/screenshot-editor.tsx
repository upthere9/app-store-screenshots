"use client";
import * as React from "react";
import JSZip from "jszip";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { Toaster, toast } from "sonner";
import {
  type ExportSize,
  getExportSizes,
  hasTheme,
  supportsLandscape,
  themeById,
} from "@/lib/constants";
import { detectPlatform, nid } from "@/lib/defaults";
import {
  imageElementKey,
  isBuiltInElementId,
  isImageElementId,
  isTextElementId,
  textElementKey,
} from "@/lib/elements";
import { didFail, hasCachedImage, preloadImages } from "@/lib/image-cache";
import {
  buildLocalizationExport,
  mergeLocalizationImport,
  normalizeLocaleList,
} from "@/lib/localization-import";
import { resolveScreenshot, writeLocalized } from "@/lib/locale";
import { useProject } from "@/lib/storage";
import type {
  BuiltInElementId,
  Device,
  ElementId,
  ElementTransform,
  SelectedElement,
  Slide,
} from "@/lib/types";
import { Inspector } from "./inspector";
import { PreviewStage } from "./preview-stage";
import { Sidebar } from "./sidebar";
import { DeckCanvas, getCanvas } from "./slide-canvas";
import { Toolbar } from "./toolbar";

export function ScreenshotEditor() {
  const { state, setState, hydrated, savedAt, saveError, reset, resetDevice, undo, redo } = useProject();
  const [activeSlideId, setActiveSlideId] = React.useState<string | null>(null);
  const [selectedElement, setSelectedElement] = React.useState<SelectedElement | null>(null);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [imageCacheVersion, setImageCacheVersion] = React.useState(0);
  const [exportLocaleOverride, setExportLocaleOverride] = React.useState<string | null>(null);
  const [exportSlideIndex, setExportSlideIndex] = React.useState(0);
  const exportRef = React.useRef<HTMLDivElement | null>(null);
  // html-to-image re-scans every stylesheet and re-fetches every referenced
  // font file on each toPng() call unless given a pre-computed fontEmbedCSS —
  // with this project's multi-language Google Fonts import (hundreds of CJK
  // subset files), that made every single capture redo the same font work.
  // Font family choice can vary per locale, so we cache per locale (computed
  // once when a locale's deck is rendered) rather than once for the whole
  // export, trading a couple of recomputes for correctness.
  const fontEmbedCssByLocale = React.useRef<Map<string, string>>(new Map());

  const currentSlides = state.slidesByDevice[state.device] || [];
  const activeSlide =
    currentSlides.find((s) => s.id === activeSlideId) || currentSlides[0] || null;
  const theme = themeById(state.themeId);

  React.useEffect(() => {
    if (selectedElement && selectedElement.slideId !== activeSlide?.id) {
      setSelectedElement(null);
    }
  }, [activeSlide?.id, selectedElement]);

  React.useEffect(() => {
    if (!hydrated) return;
    if (!activeSlide && currentSlides.length > 0) {
      setActiveSlideId(currentSlides[0].id);
    }
  }, [hydrated, currentSlides, activeSlide]);

  React.useEffect(() => {
    if (!supportsLandscape(state.device) && state.orientation !== "portrait") {
      setState((p) => ({ ...p, orientation: "portrait" }));
    }
  }, [state.device, state.orientation, setState]);

  React.useEffect(() => {
    if (hydrated && state.themeId && !hasTheme(state.themeId)) {
      toast.warning("Using fallback theme", {
        description: `Theme "${state.themeId}" is not defined in src/lib/constants.ts.`,
        duration: 8000,
      });
    }
  }, [hydrated, state.themeId]);

  const assetPaths = React.useMemo(() => {
    const paths = new Set<string>();
    paths.add("/mockup.png");
    if (state.appIcon) paths.add(state.appIcon);
    // Preload every locale variant so bulk export doesn't race image loads.
    const allSlides: Slide[] = Object.values(state.slidesByDevice).flat();
    for (const s of allSlides) {
      const imageSources = (s.imageElements || []).map((element) => element.src);
      for (const raw of [s.screenshot, s.screenshotSecondary, ...imageSources]) {
        if (!raw || raw.startsWith("data:")) continue;
        if (raw.includes("{locale}")) {
          for (const loc of state.locales) paths.add(resolveScreenshot(raw, loc));
        } else {
          paths.add(raw);
        }
      }
    }
    return Array.from(paths).sort();
  }, [state.slidesByDevice, state.appIcon, state.locales]);
  const assetSig = assetPaths.join("|");

  React.useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    preloadImages(assetPaths).finally(() => {
      if (cancelled) return;
      setImageCacheVersion((version) => version + 1);
      setReady(true);
    });
    // assetPaths is derived from assetSig; depending on the string keeps the
    // effect from re-firing when slidesByDevice churns without path changes.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, assetSig]);

  // Surface storage failures (quota exceeded etc.) so the user knows their work isn't safe.
  React.useEffect(() => {
    if (saveError) {
      toast.error("Couldn't load or save project file", {
        description: saveError,
        duration: 8000,
      });
    }
  }, [saveError]);

  // ---------- Mutations ----------

  const patchSlide = React.useCallback(
    (id: string, patch: Partial<Slide>) => {
      setState((prev) => ({
        ...prev,
        slidesByDevice: {
          ...prev.slidesByDevice,
          [prev.device]: (prev.slidesByDevice[prev.device] || []).map((s) =>
            s.id === id ? { ...s, ...patch } : s,
          ),
        },
      }));
    },
    [setState],
  );

  const reorderSlides = React.useCallback(
    (next: Slide[]) => {
      setState((prev) => ({
        ...prev,
        slidesByDevice: { ...prev.slidesByDevice, [prev.device]: next },
      }));
    },
    [setState],
  );

  const deleteSlide = React.useCallback(
    (id: string) => {
      const dev = state.device;
      const slides = state.slidesByDevice[dev] || [];
      const idx = slides.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const snap = slides[idx];
      const fallback = slides[idx + 1] || slides[idx - 1] || null;

      setState((prev) => {
        const cur = prev.slidesByDevice[dev] || [];
        return {
          ...prev,
          slidesByDevice: { ...prev.slidesByDevice, [dev]: cur.filter((s) => s.id !== id) },
        };
      });
      setActiveSlideId((cur) => (cur === id ? fallback?.id || null : cur));

      toast("Screen deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            setState((prev) => {
              const cur = prev.slidesByDevice[dev] || [];
              if (cur.some((s) => s.id === snap.id)) return prev;
              const restored = [...cur.slice(0, idx), snap, ...cur.slice(idx)];
              return {
                ...prev,
                slidesByDevice: { ...prev.slidesByDevice, [dev]: restored },
              };
            });
            setActiveSlideId(snap.id);
          },
        },
        duration: 6000,
      });
    },
    [setState, state.device, state.slidesByDevice],
  );

  const addSlide = React.useCallback(
    (slide: Slide) => {
      setState((prev) => ({
        ...prev,
        slidesByDevice: {
          ...prev.slidesByDevice,
          [prev.device]: [...(prev.slidesByDevice[prev.device] || []), slide],
        },
      }));
      setActiveSlideId(slide.id);
    },
    [setState],
  );

  const patchLocalized = React.useCallback(
    (slide: Slide, key: "label" | "headline", value: string) => {
      patchSlide(slide.id, {
        [key]: writeLocalized(slide[key], state.locale, value),
      } as Partial<Slide>);
    },
    [patchSlide, state.locale],
  );

  const setLocales = React.useCallback(
    (value: string[]) => {
      const locales = normalizeLocaleList(value);
      if (!locales.length) {
        toast.error("Add at least one language code");
        return;
      }
      setState((prev) => ({
        ...prev,
        locales,
        locale: locales.includes(prev.locale) ? prev.locale : locales[0],
      }));
      toast.success(`Languages updated (${locales.length})`);
    },
    [setState],
  );

  const importLocalization = React.useCallback(
    (payload: unknown) => {
      const result = mergeLocalizationImport(state, payload);
      setState(result.state);
      const { localesAdded, slidesUpdated, fieldsUpdated, ignoredItems } = result.summary;
      if (fieldsUpdated === 0 && localesAdded === 0) {
        toast.warning("No localization changes found", {
          description: ignoredItems ? `${ignoredItems} item${ignoredItems === 1 ? "" : "s"} ignored` : undefined,
        });
        return;
      }
      toast.success("Localization imported", {
        description: `${localesAdded} locale${localesAdded === 1 ? "" : "s"} added, ${slidesUpdated} slide${slidesUpdated === 1 ? "" : "s"} updated, ${fieldsUpdated} field${fieldsUpdated === 1 ? "" : "s"} changed`,
      });
    },
    [setState, state],
  );

  const downloadLocalization = React.useCallback(() => {
    const payload = buildLocalizationExport(state);
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(state.appName)}-localization.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [state]);

  const patchElementTransform = React.useCallback(
    (slideId: string, elementId: ElementId, transform: ElementTransform) => {
      setState((prev) => ({
        ...prev,
        slidesByDevice: {
          ...prev.slidesByDevice,
          [prev.device]: (prev.slidesByDevice[prev.device] || []).map((slide) => {
            if (slide.id !== slideId) return slide;
            if (isTextElementId(elementId)) {
              const textId = textElementKey(elementId);
              return {
                ...slide,
                textElements: (slide.textElements || []).map((element) =>
                  element.id === textId ? { ...element, transform } : element,
                ),
              };
            }
            if (isImageElementId(elementId)) {
              const imageId = imageElementKey(elementId);
              return {
                ...slide,
                imageElements: (slide.imageElements || []).map((element) =>
                  element.id === imageId ? { ...element, transform } : element,
                ),
              };
            }
            if (!isBuiltInElementId(elementId)) return slide;
            return {
              ...slide,
              transforms: {
                ...(slide.transforms || {}),
                [elementId]: transform,
              } as Partial<Record<BuiltInElementId, ElementTransform>>,
            };
          }),
        },
      }));
    },
    [setState],
  );

  const patchTextElementText = React.useCallback(
    (slideId: string, textId: string, value: string) => {
      setState((prev) => ({
        ...prev,
        slidesByDevice: {
          ...prev.slidesByDevice,
          [prev.device]: (prev.slidesByDevice[prev.device] || []).map((slide) =>
            slide.id === slideId
              ? {
                  ...slide,
                  textElements: (slide.textElements || []).map((element) =>
                    element.id === textId
                      ? { ...element, text: writeLocalized(element.text, prev.locale, value) }
                      : element,
                  ),
                }
              : slide,
          ),
        },
      }));
    },
    [setState],
  );

  const duplicateSlide = React.useCallback(
    (id: string) => {
      let newId: string | null = null;
      setState((prev) => {
        const slides = prev.slidesByDevice[prev.device] || [];
        const idx = slides.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const src = slides[idx];
        newId = nid();
        const copy: Slide = {
          ...src,
          id: newId,
          label: { ...src.label },
          headline: { ...src.headline },
          transforms: src.transforms
            ? Object.fromEntries(
                Object.entries(src.transforms).map(([key, value]) => [key, { ...value }]),
              )
            : undefined,
          textElements: src.textElements?.map((element) => ({
            ...element,
            id: nid(),
            text: { ...element.text },
            transform: { ...element.transform },
          })),
          imageElements: src.imageElements?.map((element) => ({
            ...element,
            id: nid(),
            transform: { ...element.transform },
          })),
        };
        const next = [...slides.slice(0, idx + 1), copy, ...slides.slice(idx + 1)];
        return {
          ...prev,
          slidesByDevice: { ...prev.slidesByDevice, [prev.device]: next },
        };
      });
      if (newId) setActiveSlideId(newId);
    },
    [setState],
  );

  // ---------- Keyboard shortcuts ----------

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable);
      if (exporting) return;

      if (e.key === "Escape") {
        setSelectedElement(null);
        if (target && "blur" in target && typeof target.blur === "function") target.blur();
        return;
      }

      // Let focused inputs and contenteditable text keep their native undo,
      // redo, selection, and deletion behavior.
      if (inEditable) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (!currentSlides.length) return;
      const idx = activeSlide ? currentSlides.findIndex((s) => s.id === activeSlide.id) : -1;
      if (e.key === "ArrowDown" || (e.key === "j" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const next = currentSlides[Math.min(currentSlides.length - 1, idx + 1)];
        if (next) setActiveSlideId(next.id);
      } else if (e.key === "ArrowUp" || (e.key === "k" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const next = currentSlides[Math.max(0, idx - 1)];
        if (next) setActiveSlideId(next.id);
      } else if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
        if (activeSlide) {
          e.preventDefault();
          duplicateSlide(activeSlide.id);
        }
      } else if ((e.key === "Backspace" || e.key === "Delete") && (e.metaKey || e.ctrlKey)) {
        if (activeSlide) {
          e.preventDefault();
          deleteSlide(activeSlide.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSlide, currentSlides, duplicateSlide, deleteSlide, exporting, undo, redo]);

  // ---------- Export ----------

  // Wait two animation frames so React's render → browser layout/paint of the
  // off-screen container settles before html-to-image snapshots it. One frame
  // is occasionally not enough on slower machines.
  const waitForPaint = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  async function preloadAndRefreshExportImages(
    paths: string[],
    options: { retryFailed?: boolean } = {},
  ) {
    await preloadImages(paths, options);
    setImageCacheVersion((version) => version + 1);
    await waitForPaint();
  }

  async function waitForImages(roots: HTMLElement | HTMLElement[]): Promise<string[]> {
    const rootList = Array.isArray(roots) ? roots : [roots];
    // A slide's DOM is split across two sibling containers in DeckCanvas (a
    // background/feature-graphic div and an elements div), so scoping to a
    // single slide can require querying more than one root — take the union.
    const images = rootList.flatMap((root) => Array.from(root.querySelectorAll("img")));
    const failed: string[] = [];

    await Promise.all(
      images.map(async (image) => {
        if (!image.complete || image.naturalWidth === 0) {
          await new Promise<void>((resolve) => {
            const done = () => {
              image.removeEventListener("load", done);
              image.removeEventListener("error", done);
              resolve();
            };
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
            window.setTimeout(done, 2500);
          });
        }

        if (image.complete && image.naturalWidth > 0 && typeof image.decode === "function") {
          try {
            await image.decode();
          } catch {
            /* Some browsers reject decode for images that are already usable. */
          }
        }

        if (!image.complete || image.naturalWidth === 0) {
          failed.push(image.currentSrc || image.src || "unknown image");
        }
      }),
    );

    return failed;
  }

  async function exportAll(options?: { locales?: string[]; sizes?: ExportSize[] }) {
    if (!currentSlides.length) {
      toast.error("No screens to export");
      return;
    }
    // Font choices may have changed since the last export ran.
    fontEmbedCssByLocale.current.clear();

    const allSizes = getExportSizes(state.device, state.orientation);
    const sizes = options?.sizes?.length
      ? allSizes.filter((size) => options.sizes!.some((s) => s.label === size.label))
      : allSizes;
    if (!sizes.length) {
      toast.error("Nothing to export");
      return;
    }
    const locales = options?.locales?.length
      ? state.locales.filter((l) => options.locales!.includes(l))
      : state.locales;
    if (!locales.length) {
      toast.error("Nothing to export");
      return;
    }
    await preloadAndRefreshExportImages(assetPaths, { retryFailed: true });

    const missingScreens = currentSlides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => slideNeedsScreenshot(state.device, slide) && !slide.screenshot);
    const reusedBackScreens = currentSlides
      .map((slide, index) => ({ slide, index }))
      .filter(
        ({ slide }) =>
          state.device !== "feature-graphic" &&
          slide.layout === "two-devices" &&
          slide.screenshot &&
          !slide.screenshotSecondary,
      );
    if (missingScreens.length > 0 || reusedBackScreens.length > 0) {
      const details = [
        missingScreens.length
          ? `${missingScreens.length} screen${missingScreens.length === 1 ? "" : "s"} will export with an empty device.`
          : null,
        reusedBackScreens.length
          ? `${reusedBackScreens.length} two-device screen${reusedBackScreens.length === 1 ? "" : "s"} will reuse the primary screenshot in back.`
          : null,
      ].filter(Boolean);
      toast.warning("Export includes placeholder screenshots", {
        description: details.join(" "),
        duration: 7000,
      });
    }

    // Make sure custom fonts are loaded before snapshot so typography in PNG
    // matches what's on screen.
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    }

    const { cW, cH } = getCanvas(state.device, state.orientation);
    const platform = detectPlatform(state.device);
    const zip = new JSZip();
    const totalUnits = sizes.length * locales.length * currentSlides.length;
    let unit = 0;
    let okCount = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const locale of locales) {
      setExportLocaleOverride(locale);
      await waitForPaint();

      // Computed once per locale (font family can vary by locale) and reused
      // for every size × slide capture below — see fontEmbedCssByLocale.
      if (!fontEmbedCssByLocale.current.has(locale) && exportRef.current) {
        try {
          fontEmbedCssByLocale.current.set(locale, await getFontEmbedCSS(exportRef.current));
        } catch {
          /* Fall back to per-capture embedding if this fails. */
        }
      }
      const fontEmbedCSS = fontEmbedCssByLocale.current.get(locale);

      for (const size of sizes) {
        for (let i = 0; i < currentSlides.length; i++) {
          const slide = currentSlides[i];
          unit += 1;
          setExporting(`${unit}/${totalUnits}`);
          setExportSlideIndex(i);
          await waitForPaint();
          const el = exportRef.current;
          if (!el) {
            failed += 1;
            errors.push(`${locale} ${size.w}×${size.h} screen ${i + 1}: render target missing`);
            continue;
          }
          try {
            const requiredAssetPaths = requiredAssetPathsForSlide(state.device, slide, locale, state.appIcon);
            if (requiredAssetPaths.some((path) => !hasCachedImage(path) || didFail(path))) {
              await preloadAndRefreshExportImages(requiredAssetPaths, { retryFailed: true });
            }
            const failedAssetPaths = requiredAssetPaths.filter((path) => didFail(path));
            if (failedAssetPaths.length) {
              throw new Error(`Screenshot files could not be loaded: ${failedAssetPaths.join(", ")}`);
            }
            const uncachedAssetPaths = requiredAssetPaths.filter((path) => !hasCachedImage(path));
            if (uncachedAssetPaths.length) {
              throw new Error(`Screenshot files were not ready for export: ${uncachedAssetPaths.join(", ")}`);
            }
            // Only wait on images that can actually appear in this slide's
            // captured viewport. Scanning the whole off-screen deck (every
            // slide × every export unit) is O(slides) per unit and makes a
            // single stuck/broken image anywhere in the deck abort every
            // slide's export — not just its own. Connected-canvas mode still
            // scans the whole deck since elements can overflow across screens.
            const slideScopeEls = state.connectedCanvas
              ? []
              : (Array.from(
                  el.querySelectorAll(`[data-slide-id="${slide.id}"]`),
                ) as HTMLElement[]);
            const failedImages = await waitForImages(slideScopeEls.length ? slideScopeEls : el);
            if (failedImages.length) {
              throw new Error(`Images did not load: ${failedImages.slice(0, 2).join(", ")}`);
            }
            await waitForPaint();
            const dataUrl = await captureSlide(el, cW, cH, size.w, size.h, fontEmbedCSS);
            const base64 = dataUrl.split(",")[1] || "";
            const filename = `${String(i + 1).padStart(2, "0")}-${slide.layout}.png`;
            const path = `${platform}/${state.device}/${size.w}x${size.h}/${locale}/${filename}`;
            zip.file(path, base64, { base64: true });
            okCount += 1;
          } catch (e) {
            failed += 1;
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${locale} ${size.w}×${size.h} screen ${i + 1}: ${msg}`);
            console.error("Export failed", { slideId: slide.id, locale, size }, e);
          }
        }
      }
    }

    setExportLocaleOverride(null);
    setExporting(null);

    if (okCount > 0) {
      try {
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slugify(state.appName)}-${platform}-${state.device}-${stamp()}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) {
        toast.error("Couldn't bundle export");
        console.error(e);
        return;
      }
    }

    const summary = `${locales.length} locale${locales.length === 1 ? "" : "s"} × ${sizes.length} size${sizes.length === 1 ? "" : "s"}`;
    if (failed === 0) {
      toast.success(`Exported ${okCount} PNGs (${summary})`);
    } else if (okCount === 0) {
      toast.error(`All ${failed} renders failed`, {
        description: errors.slice(0, 3).join("\n"),
      });
    } else {
      toast.error(`${failed} of ${totalUnits} renders failed`, {
        description: errors.slice(0, 3).join("\n"),
      });
    }
  }

  async function captureSlide(
    el: HTMLElement,
    sourceW: number,
    sourceH: number,
    exportW: number,
    exportH: number,
    fontEmbedCSS: string | undefined,
  ) {
    // html-to-image needs the node at (0,0). Let the library scale the source
    // canvas into the requested output dimensions; CSS transforms leave
    // transparent gutters when export aspect ratios differ by a few pixels.
    const prev = {
      left: el.style.left,
      top: el.style.top,
      position: el.style.position,
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
      zIndex: el.style.zIndex,
    };
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.position = "fixed";
    el.style.transform = "none";
    el.style.transformOrigin = "top left";
    el.style.zIndex = "-1";
    try {
      const dataUrl = await toPng(el, {
        width: sourceW,
        height: sourceH,
        canvasWidth: exportW,
        canvasHeight: exportH,
        pixelRatio: 1,
        cacheBust: false,
        backgroundColor: "#ffffff",
        ...(fontEmbedCSS != null ? { fontEmbedCSS } : {}),
      });
      return dataUrl;
    } finally {
      el.style.left = prev.left || "-99999px";
      el.style.top = prev.top || "0px";
      el.style.position = prev.position || "absolute";
      el.style.transform = prev.transform;
      el.style.transformOrigin = prev.transformOrigin;
      el.style.zIndex = prev.zIndex;
    }
  }

  // ---------- Render ----------

  if (!hydrated || !ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <p className="text-sm">Loading editor…</p>
        </div>
      </div>
    );
  }

  const { cW, cH } = getCanvas(state.device, state.orientation);
  const busy = !!exporting;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Toaster position="top-right" richColors closeButton />
      <Toolbar
        appName={state.appName}
        setAppName={(v) => setState((p) => ({ ...p, appName: v }))}
        connectedCanvas={state.connectedCanvas}
        setConnectedCanvas={(v) => setState((p) => ({ ...p, connectedCanvas: v }))}
        locale={state.locale}
        setLocale={(v) => setState((p) => ({ ...p, locale: v }))}
        locales={state.locales}
        setLocales={setLocales}
        onImportLocalization={importLocalization}
        onDownloadLocalization={downloadLocalization}
        device={state.device}
        setDevice={(v) => setState((p) => ({ ...p, device: v }))}
        orientation={state.orientation}
        setOrientation={(v) => setState((p) => ({ ...p, orientation: v }))}
        onExport={exportAll}
        onResetAll={() => {
          reset();
          setActiveSlideId(null);
          toast.success("Reset all devices to defaults");
        }}
        onResetDevice={() => {
          resetDevice(state.device);
          setActiveSlideId(null);
          toast.success(`Reset ${state.device} to defaults`);
        }}
        exporting={exporting}
        savedAt={savedAt}
        saveError={saveError}
        busy={busy}
      />

      <div className="flex flex-1 overflow-hidden md:flex-row flex-col">
        <aside className="md:w-72 w-full shrink-0 border-r bg-card md:max-h-none max-h-64 overflow-hidden">
          <Sidebar
            slides={currentSlides}
            activeId={activeSlide?.id || null}
            device={state.device}
            orientation={state.orientation}
            theme={theme}
            locale={state.locale}
            appName={state.appName}
            appIcon={state.appIcon}
            connectedCanvas={state.connectedCanvas}
            disabled={busy}
            onReorder={reorderSlides}
            onSelect={setActiveSlideId}
            onDelete={deleteSlide}
            onDuplicate={duplicateSlide}
            onAdd={addSlide}
          />
        </aside>

        <main className="flex flex-1 items-stretch overflow-hidden min-h-0">
          {activeSlide && currentSlides.length > 0 ? (
            <PreviewStage
              slides={currentSlides}
              activeSlideId={activeSlide.id}
              device={state.device}
              orientation={state.orientation}
              theme={theme}
              locale={state.locale}
              appName={state.appName}
              appIcon={state.appIcon}
              connectedCanvas={state.connectedCanvas}
              selectedElement={selectedElement}
              onActiveSlideChange={setActiveSlideId}
              onLabelChange={(slide, v) => patchLocalized(slide, "label", v)}
              onHeadlineChange={(slide, v) => patchLocalized(slide, "headline", v)}
              onTextElementTextChange={patchTextElementText}
              onElementChange={patchElementTransform}
              onSelectElement={setSelectedElement}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No screen selected</p>
              <p>Add a screen on the left to get started.</p>
            </div>
          )}
        </main>

        <aside className="md:w-80 w-full shrink-0 border-l bg-card md:max-h-none max-h-96 overflow-hidden">
          {activeSlide ? (
            <Inspector
              slide={activeSlide}
              device={state.device}
              orientation={state.orientation}
              locale={state.locale}
              selectedElementId={
                selectedElement?.slideId === activeSlide.id ? selectedElement.elementId : null
              }
              onChange={(patch) => patchSlide(activeSlide.id, patch)}
              onSelectElement={(elementId) =>
                setSelectedElement(
                  elementId ? { slideId: activeSlide.id, elementId } : null,
                )
              }
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nothing to inspect</p>
              <p className="text-xs">Screen settings will appear here once you add or select one.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Off-screen export container — full-resolution canvases for html-to-image. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: -99999,
          top: 0,
          pointerEvents: "none",
        }}
      >
        {currentSlides.length > 0 && (
          <div
            ref={exportRef}
            style={{
              width: cW,
              height: cH,
              overflow: "hidden",
              position: "absolute",
              left: -99999,
              top: 0,
            }}
            data-image-cache-version={imageCacheVersion}
          >
            <div
              style={{
                position: "absolute",
                left: -exportSlideIndex * cW,
                top: 0,
                width: cW * currentSlides.length,
                height: cH,
              }}
            >
              <DeckCanvas
                slides={currentSlides}
                device={state.device}
                orientation={state.orientation}
                theme={theme}
                locale={exportLocaleOverride ?? state.locale}
                appName={state.appName}
                appIcon={state.appIcon}
                connectedCanvas={state.connectedCanvas}
                hideEmpty
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "screenshots"
  );
}

function slideNeedsScreenshot(device: Device, slide: Slide) {
  if (device === "feature-graphic") return false;
  return slide.layout !== "no-device" && slide.layout !== "feature-graphic";
}

function screenshotPathsForSlide(device: Device, slide: Slide, locale: string) {
  if (!slideNeedsScreenshot(device, slide)) return [];
  const paths = [slide.screenshot];
  if (slide.layout === "two-devices") {
    paths.push(slide.screenshotSecondary || slide.screenshot);
  }
  return paths.filter(Boolean).map((path) => resolveScreenshot(path, locale));
}

function requiredAssetPathsForSlide(
  device: Device,
  slide: Slide,
  locale: string,
  appIcon: string | undefined,
) {
  const paths = new Set<string>();
  if (device === "iphone") paths.add("/mockup.png");
  if (device === "feature-graphic" && appIcon) paths.add(appIcon);
  for (const path of screenshotPathsForSlide(device, slide, locale)) paths.add(path);
  for (const element of slide.imageElements || []) {
    if (element.src) paths.add(resolveScreenshot(element.src, locale));
  }
  return Array.from(paths).filter((path) => path && !path.startsWith("data:"));
}

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
