import * as cheerio from "cheerio";
import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";
import { PRICING, trackUsage } from "@/lib/services/cost-tracker";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export interface WebExtractionResult {
  success: boolean;
  url: string;
  source: "fetch" | "browserbase-fetch" | "browserbase-browser";
  data: {
    title: string;
    description: string;
    content: string;
    links?: string[];
    contactInfo?: {
      emails: string[];
      phones: string[];
      address?: string;
    };
    structuredData?: Record<string, unknown>;
    openGraph?: Record<string, string>;
  };
  extractionTime: number;
  error?: string;
}

export class WebExtractionService {
  async extract(
    url: string,
    options: {
      includeMetadata?: boolean;
      includeLinks?: boolean;
      timeout?: number;
      onLiveView?: (liveViewUrl: string) => void;
    } = {},
  ): Promise<WebExtractionResult> {
    const {
      includeMetadata = true,
      includeLinks = false,
      timeout = 15000,
      onLiveView,
    } = options;

    const startTime = Date.now();

    // 1. Try direct fetch + Cheerio (free, fastest)
    try {
      console.log(`[WebExtract] Fetching: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Definitive HTTP errors: no point cascading to Browserbase
        if (
          response.status === 404 ||
          response.status === 410 ||
          response.status === 451
        ) {
          return {
            success: false,
            url,
            source: "fetch" as const,
            data: { title: "", description: "", content: "" },
            extractionTime: Date.now() - startTime,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const result = this.parseHtml(html, url, {
        includeMetadata,
        includeLinks,
      });

      // If we got meaningful content, return it (free direct fetch -- no tracking needed)
      if (result.content.length > 100) {
        return {
          success: true,
          url,
          source: "fetch",
          data: result,
          extractionTime: Date.now() - startTime,
        };
      }

      // Content too short -- likely JS-rendered, fall through
      console.log(
        `[WebExtract] Thin content from fetch (${result.content.length} chars), trying Browserbase`,
      );
      throw new Error("Content too thin, likely JS-rendered");
    } catch (fetchError) {
      const fetchMsg =
        fetchError instanceof Error ? fetchError.message : "Unknown error";
      console.log(`[WebExtract] Fetch failed: ${fetchMsg}`);

      const bbApiKey = process.env.BROWSERBASE_API_KEY;
      const bbProjectId = process.env.BROWSERBASE_PROJECT_ID;

      if (!bbApiKey || !bbProjectId) {
        return {
          success: false,
          url,
          source: "fetch",
          data: { title: "", description: "", content: "" },
          extractionTime: Date.now() - startTime,
          error: fetchMsg,
        };
      }

      // 2. Try Browserbase Fetch with proxies (no JS rendering, but bypasses blocks)
      try {
        console.log(`[WebExtract] Trying Browserbase Fetch: ${url}`);
        const bbFetchResult = await this.extractViaBrowserbaseFetch(
          url,
          bbApiKey,
          { includeMetadata, includeLinks },
        );

        if (bbFetchResult.content.length > 100) {
          trackUsage({
            service: "browserbase",
            operation: "fetch",
            estimated_cost_usd: PRICING.browserbase_fetch,
            metadata: { url },
          });
          return {
            success: true,
            url,
            source: "browserbase-fetch",
            data: bbFetchResult,
            extractionTime: Date.now() - startTime,
          };
        }

        console.log(
          `[WebExtract] Browserbase Fetch also thin (${bbFetchResult.content.length} chars), trying browser session`,
        );
      } catch (bbFetchError) {
        const bbFetchMsg =
          bbFetchError instanceof Error
            ? bbFetchError.message
            : "Unknown error";
        console.log(`[WebExtract] Browserbase Fetch failed: ${bbFetchMsg}`);

        // If rate-limited, don't cascade to an expensive browser session
        if (bbFetchMsg.includes("429")) {
          return {
            success: false,
            url,
            source: "browserbase-fetch" as const,
            data: { title: "", description: "", content: "" },
            extractionTime: Date.now() - startTime,
            error: bbFetchMsg,
          };
        }
      }

      // 3. Try Browserbase browser session (full JS rendering via Playwright)
      if (bbProjectId) {
        try {
          console.log(
            `[WebExtract] Trying Browserbase browser session: ${url}`,
          );
          const { parsed, durationSec, sessionId } =
            await this.extractViaBrowserbaseSession(url, bbApiKey, {
              includeMetadata,
              includeLinks,
              onLiveView,
            });

          // Browserbase bills $0.10/hr for browser sessions
          const sessionCost =
            (durationSec / 3600) * PRICING.browserbase_session_per_hr;

          trackUsage({
            service: "browserbase",
            operation: "browser-session",
            estimated_cost_usd: sessionCost,
            metadata: { url, sessionId, durationSec: Math.round(durationSec) },
          });

          return {
            success: true,
            url,
            source: "browserbase-browser",
            data: parsed,
            extractionTime: Date.now() - startTime,
          };
        } catch (browserError) {
          const browserMsg =
            browserError instanceof Error
              ? browserError.message
              : "Unknown error";
          console.error(
            `[WebExtract] Browserbase browser session failed: ${browserMsg}`,
          );

          return {
            success: false,
            url,
            source: "browserbase-browser",
            data: { title: "", description: "", content: "" },
            extractionTime: Date.now() - startTime,
            error: `All methods failed. Fetch: ${fetchMsg}. Browser: ${browserMsg}`,
          };
        }
      }

      return {
        success: false,
        url,
        source: "fetch",
        data: { title: "", description: "", content: "" },
        extractionTime: Date.now() - startTime,
        error: fetchMsg,
      };
    }
  }

  /**
   * Parse HTML string with Cheerio and extract structured data.
   */
  private parseHtml(
    html: string,
    baseUrl: string,
    options: { includeMetadata?: boolean; includeLinks?: boolean },
  ) {
    const $ = cheerio.load(html);

    const title =
      $("title").text().trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      $("h1").first().text().trim() ||
      "";

    const description =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      "";

    // Extract contact info BEFORE stripping nav/footer (where contacts live)
    const contactInfo = this.parseContactInfo($, html);

    $(
      "script, style, nav, footer, header, iframe, noscript, img, svg, picture, source, figure, form, video, audio, canvas, map, object, embed",
    ).remove();
    const content = $("body").text().replace(/\s+/g, " ").trim();

    let links: string[] | undefined;
    if (options.includeLinks) {
      links = [];
      $("a[href]").each((_, elem) => {
        const href = $(elem).attr("href");
        if (href) {
          try {
            links!.push(new URL(href, baseUrl).toString());
          } catch {
            // skip invalid URLs
          }
        }
      });
    }

    let structuredData: Record<string, unknown> | undefined;
    let openGraph: Record<string, string> | undefined;

    if (options.includeMetadata) {
      openGraph = {};
      $('meta[property^="og:"]').each((_, elem) => {
        const property = $(elem).attr("property");
        const ogContent = $(elem).attr("content");
        if (property && ogContent) {
          openGraph![property.replace("og:", "")] = ogContent;
        }
      });

      structuredData = {};
      $('script[type="application/ld+json"]').each((_, elem) => {
        try {
          const jsonText = $(elem).html();
          if (jsonText) Object.assign(structuredData!, JSON.parse(jsonText));
        } catch {
          // skip invalid JSON-LD
        }
      });
    }

    return {
      title,
      description,
      content,
      links,
      contactInfo,
      structuredData:
        structuredData && Object.keys(structuredData).length > 0
          ? structuredData
          : undefined,
      openGraph:
        openGraph && Object.keys(openGraph).length > 0 ? openGraph : undefined,
    };
  }

  /**
   * Extract emails, phone numbers, and address from HTML.
   */
  private parseContactInfo(
    $: cheerio.CheerioAPI,
    html: string,
  ): { emails: string[]; phones: string[]; address?: string } | undefined {
    const emails = new Set<string>();
    const phones = new Set<string>();
    let address: string | undefined;

    const ignoredEmails =
      /^(noreply|no-reply|donotreply|mailer-daemon|postmaster|webmaster|info@example|test@)/i;
    const ignoredExtensions =
      /\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|woff|ttf|eot)$/i;
    const ignoredDomains =
      /(@sentry|@wixpress|@sentry-next|@.*\.sentry|@localhost|@example\.)/i;

    // 1. Extract emails from mailto: links
    $('a[href^="mailto:"]').each((_, elem) => {
      const href = $(elem).attr("href") || "";
      const email = href
        .replace(/^mailto:/i, "")
        .split("?")[0]
        .trim()
        .toLowerCase();
      if (
        email &&
        email.includes("@") &&
        !ignoredEmails.test(email) &&
        !ignoredExtensions.test(email) &&
        !ignoredDomains.test(email)
      ) {
        emails.add(email);
      }
    });

    // 2. Extract phones from tel: links
    $('a[href^="tel:"]').each((_, elem) => {
      const href = $(elem).attr("href") || "";
      const phone = href.replace(/^tel:/i, "").trim();
      if (phone && phone.length >= 7) {
        phones.add(phone);
      }
    });

    // 3. Extract emails from visible page text via regex (not from scripts/styles)
    const $clean = cheerio.load(html);
    $clean("script, style, noscript, code, pre").remove();
    const visibleText = $clean("body").text();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const textEmails = visibleText.match(emailRegex) || [];
    for (const email of textEmails) {
      const lower = email.toLowerCase();
      if (
        !ignoredEmails.test(lower) &&
        !ignoredExtensions.test(lower) &&
        !ignoredDomains.test(lower)
      ) {
        // Reject emails with overly long local parts (likely concatenated text)
        const localPart = lower.split("@")[0];
        if (localPart.length <= 40) {
          emails.add(lower);
        }
      }
    }

    // 4. Extract phone numbers from tel: links and visible text
    // Only match patterns that look like real phone numbers with separators
    const phoneRegex =
      /(?:\+\d{1,3}[\s.-])?\(?\d{2,5}\)[\s.-]\d{3,4}[\s.-]?\d{3,4}|\b0\d{2,4}[\s.-]\d{3,4}[\s.-]?\d{3,4}\b|\+\d{1,3}[\s.-]\d{2,4}[\s.-]\d{3,4}[\s.-]?\d{3,4}/g;
    const textPhones = visibleText.match(phoneRegex) || [];
    for (const phone of textPhones) {
      const cleaned = phone.trim();
      const digitsOnly = cleaned.replace(/\D/g, "");
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        phones.add(cleaned);
      }
    }

    // 5. Extract address from <address> tag
    const addressTag = $("address").first().text().trim();
    if (addressTag && addressTag.length > 10 && addressTag.length < 300) {
      address = addressTag.replace(/\s+/g, " ");
    }

    // 6. Try JSON-LD structured data for address
    if (!address) {
      $('script[type="application/ld+json"]').each((_, elem) => {
        if (address) return;
        try {
          const jsonText = $(elem).html();
          if (!jsonText) return;
          const data = JSON.parse(jsonText);
          const addr = data.address || data.location?.address;
          if (addr && typeof addr === "object") {
            const parts = [
              addr.streetAddress,
              addr.addressLocality,
              addr.addressRegion,
              addr.postalCode,
              addr.addressCountry,
            ].filter(Boolean);
            if (parts.length >= 2) {
              address = parts.join(", ");
            }
          }
        } catch {
          // skip
        }
      });
    }

    if (emails.size === 0 && phones.size === 0 && !address) {
      return undefined;
    }

    // Dedupe phones by digits (keep the formatted version)
    const seenDigits = new Set<string>();
    const dedupedPhones: string[] = [];
    for (const phone of phones) {
      const digits = phone.replace(/\D/g, "");
      if (!seenDigits.has(digits)) {
        seenDigits.add(digits);
        dedupedPhones.push(phone);
      }
    }

    return {
      emails: [...emails].slice(0, 5),
      phones: dedupedPhones.slice(0, 5),
      address,
    };
  }

  /**
   * Browserbase Fetch API -- raw HTTP with proxies, no JS rendering.
   */
  private async extractViaBrowserbaseFetch(
    url: string,
    apiKey: string,
    options: { includeMetadata?: boolean; includeLinks?: boolean },
  ) {
    const response = await fetchWithTimeout(
      "https://api.browserbase.com/v1/fetch",
      {
        method: "POST",
        headers: {
          "X-BB-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, proxies: true }),
      },
      60_000,
    );

    if (!response.ok) {
      throw new Error(
        `Browserbase Fetch HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const result = await response.json();
    return this.parseHtml(result.content || "", url, options);
  }

  /**
   * Full Browserbase browser session via Playwright CDP -- renders JavaScript.
   * Returns parsed HTML and session duration in seconds for cost tracking.
   */
  private async extractViaBrowserbaseSession(
    url: string,
    apiKey: string,
    options: {
      includeMetadata?: boolean;
      includeLinks?: boolean;
      onLiveView?: (liveViewUrl: string) => void;
    },
  ) {
    const bb = new Browserbase({ apiKey });
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    });

    console.log(`[WebExtract] Browser session created: ${session.id}`);

    if (options.onLiveView) {
      bb.sessions
        .debug(session.id)
        .then((live) => options.onLiveView?.(live.debuggerFullscreenUrl))
        .catch((err) =>
          console.warn(`[WebExtract] debug URL fetch failed: ${err}`),
        );
    }

    const sessionStart = Date.now();
    const browser = await chromium.connectOverCDP(session.connectUrl);

    try {
      const context = browser.contexts()[0];
      const page = context.pages()[0];

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait a bit for JS to render content
      await page.waitForTimeout(2000);

      const html = await page.content();
      const parsed = this.parseHtml(html, url, options);
      const durationSec = (Date.now() - sessionStart) / 1000;
      return { parsed, durationSec, sessionId: session.id };
    } finally {
      await browser.close();
    }
  }
}
