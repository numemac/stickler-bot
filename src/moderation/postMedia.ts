import { MAX_VISION_IMAGES } from "../constants.js";

export const MIN_VIDEO_POST_BODY_CHARS_FOR_MODERATION = 200;

/**
 * Returns true when a post appears to be a Reddit-hosted video upload.
 */
export function isRedditVideoUploadPost(post: {
  url: string;
  secureMedia?: { redditVideo?: unknown } | undefined;
}): boolean {
  if (post.secureMedia?.redditVideo != null) {
    return true;
  }

  return isVRedditUrl(post.url);
}

/**
 * Returns true when post body text is long enough to provide meaningful context.
 */
export function hasSubstantialVideoBodyText(body: string | undefined): boolean {
  return (body?.trim().length ?? 0) >= MIN_VIDEO_POST_BODY_CHARS_FOR_MODERATION;
}

/**
 * Extracts and normalizes candidate image URLs from a post for vision analysis.
 */
export function extractPostImageUrls(post: {
  url: string;
  gallery: Array<{ url: string }>;
  thumbnail?: { url: string } | undefined;
  secureMedia?: { oembed?: { thumbnailUrl?: string } } | undefined;
}): string[] {
  const rawCandidates = [
    post.url,
    ...post.gallery.map((media) => media.url),
    post.thumbnail?.url,
    post.secureMedia?.oembed?.thumbnailUrl,
  ];

  const deduped = new Set<string>();
  for (const candidate of rawCandidates) {
    if (candidate == null) {
      continue;
    }

    const normalized = normalizeImageUrl(candidate);
    if (normalized == null) {
      continue;
    }

    deduped.add(normalized);
    if (deduped.size >= MAX_VISION_IMAGES) {
      break;
    }
  }

  return Array.from(deduped);
}

/**
 * Returns true when a URL host is v.redd.it.
 */
function isVRedditUrl(urlValue: string): boolean {
  const trimmed = urlValue.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const withScheme = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return false;
  }

  return parsed.hostname.toLowerCase() === "v.redd.it";
}

/**
 * Normalizes a candidate URL and keeps only URLs that are likely image assets.
 */
function normalizeImageUrl(urlValue: string): string | null {
  const trimmed = urlValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const sanitized = trimmed.replace(/&amp;/g, "&");
  const withScheme = sanitized.startsWith("//") ? `https:${sanitized}` : sanitized;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed = appendJpegExtensionToRedditImageUrl(parsed);

  if (!isLikelyImageUrl(parsed)) {
    return null;
  }

  return parsed.toString();
}

/**
 * Appends a `.jpeg` extension to Reddit image URLs when no file extension is present.
 */
function appendJpegExtensionToRedditImageUrl(url: URL): URL {
  const host = url.hostname.toLowerCase();
  if (
    host !== "i.redd.it" &&
    host !== "preview.redd.it" &&
    host !== "external-preview.redd.it"
  ) {
    return url;
  }

  const hasExtension = /\.[a-z0-9]+$/i.test(url.pathname);
  if (hasExtension || url.pathname.endsWith("/")) {
    return url;
  }

  const updated = new URL(url.toString());
  updated.pathname = `${updated.pathname}.jpeg`;
  return updated;
}

/**
 * Heuristic check for URLs that likely point to an image resource.
 */
function isLikelyImageUrl(url: URL): boolean {
  const imageExtensionPattern =
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
  if (imageExtensionPattern.test(url.pathname)) {
    return true;
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "i.redd.it" ||
    host === "preview.redd.it" ||
    host === "external-preview.redd.it" ||
    host === "i.imgur.com" ||
    host.endsWith(".redd.it")
  ) {
    return true;
  }

  const formatParam = url.searchParams.get("format")?.toLowerCase();
  if (
    formatParam === "jpg" ||
    formatParam === "jpeg" ||
    formatParam === "png" ||
    formatParam === "webp"
  ) {
    return true;
  }

  return false;
}
