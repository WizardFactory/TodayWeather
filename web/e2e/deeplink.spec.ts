import { test, expect } from "./fixtures";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test.describe("shared location", () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA });

  test("previews coordinates, dismisses the app action, and saves explicitly", async ({
    page,
  }, info) => {
    await page.goto(
      "/loc?lat=0&lon=0&name=%EC%A0%81%EB%8F%84&view=daily&from=link",
    );
    await expect(page.getByRole("heading", { name: "적도" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "일별", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const save = page.getByRole("button", { name: "즐겨찾기 추가" });
    await expect(save).toBeVisible();
    const places = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("tw.web.v1.preferences") ?? "{}")
            .places ?? [],
      );
    expect(await places()).toEqual([]);
    await expect(
      page.getByRole("link", { name: "앱에서 보기" }),
    ).toHaveAttribute(
      "href",
      "https://link.todayweather.ai/loc?lat=0&lon=0&name=%EC%A0%81%EB%8F%84&view=daily&fallback=store",
    );
    await expect(page.locator(".app-qr-card")).toHaveCount(0);
    await page.locator(".topbar").scrollIntoViewIfNeeded();
    await info.attach("coordinate-preview", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page
      .locator(".link-arrival")
      .getByRole("button", { name: "닫기" })
      .click();
    await page.reload();
    await expect(page.locator(".link-arrival")).toHaveCount(0);
    await expect(save).toBeVisible();
    expect(await places()).toEqual([]);
    await save.click();
    await expect(page).toHaveURL(/\/weather\/p_0_0\/daily\?from=link$/);
    await expect.poll(places).toMatchObject([{ id: "p_0_0", lat: 0, lon: 0 }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "적도" })).toBeVisible();
    await page.goto("/loc?lat=0.005&lon=0.005&view=air&from=link");
    await expect(page).toHaveURL(/\/air\/p_0_0\?from=link$/);
    await expect(save).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "적도" })).toBeVisible();
  });

  test("invalid coordinates offer a recoverable route", async ({ page }) => {
    await page.goto("/loc/?lat=91&lon=0");
    await expect(
      page.getByText("공유된 위치를 확인할 수 없습니다."),
    ).toBeVisible();
    await expect(
      page.locator("main").getByRole("link", { name: "관심지역 관리로 이동" }),
    ).toHaveAttribute("href", "/locations");
  });

  test("resolves edge catalog arrivals independently of favorite IDs", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("tw.web.v1.preferences")) return;
      localStorage.setItem(
        "tw.web.v1.preferences",
        JSON.stringify({
          version: 1,
          places: [{ id: "future-city", name: "Imported", lat: 0, lon: 0 }],
        }),
      );
    });
    await page.goto("/weather/future-city/hourly?from=link");
    await expect(
      page.locator("main").getByRole("link", { name: "관심지역 관리로 이동" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Imported" })).toHaveCount(
      0,
    );
    await page.goto("/loc?lat=0.01&lon=0.01&from=link");
    await expect(page).toHaveURL(/\/weather\/future-city\/hourly\?from=link$/);
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible();
  });

  test("catalog alias preserves air pollutant selection when sharing", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    await page.goto("/place/seoul?view=air&pollutant=pm25");
    await expect(page).toHaveURL(/\/air\/seoul\?pollutant=pm25$/);
    await expect(page.getByRole("radio", { checked: true })).toContainText(
      "초미세먼지",
    );
    await page
      .getByRole("radio", { name: /미세먼지/ })
      .filter({ hasText: /^미세먼지/ })
      .click();
    await page.getByRole("button", { name: "지역 공유" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("https://link.todayweather.ai/air/seoul?pollutant=pm10");
  });

  test("mobile Android uses intent URI preserving the current place and Play Store fallback", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto("/weather/seoul/daily");
    await expect(
      page.getByRole("link", { name: "앱에서 보기" }),
    ).toHaveAttribute(
      "href",
      "intent://link.todayweather.ai/place/seoul?view=daily#Intent;scheme=https;package=net.wizardfactory.todayweather;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dnet.wizardfactory.todayweather;end",
    );
    await expect(
      page.locator('meta[name="apple-itunes-app"]'),
    ).toHaveAttribute(
      "content",
      "app-id=1041700694, app-argument=https://link.todayweather.ai/place/seoul?view=daily",
    );
    await context.close();
  });
});

test.describe("desktop QR and default link preview metadata", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows fixed QR card on desktop, hides mobile banner, and exposes OG tags", async ({
    page,
  }) => {
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".link-arrival")).toHaveCount(0);
    const qrCard = page.locator(".app-qr-card");
    await expect(qrCard).toBeVisible();
    await expect(
      qrCard.getByRole("img", {
        name: "오늘날씨 모바일 앱 열기 및 스토어 이동 QR 코드",
      }),
    ).toBeVisible();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://app.todayweather.ai/icons/icon-512.png",
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "오늘날씨 · TodayWeather",
    );
    // A static og:url would canonicalize every shared place to the home page.
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  });

  test("a narrow desktop window shows neither the app bar nor the QR card", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/weather/seoul/daily");
    await expect(page.getByRole("heading", { name: "서울" })).toBeVisible();
    await expect(page.locator(".link-arrival")).toHaveCount(0);
    await expect(page.locator(".app-qr-card")).toHaveCount(0);
  });

  test("the installed PWA does not show the app bar", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: IPHONE_UA,
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });
    const page = await context.newPage();
    await page.goto("/weather/seoul/daily");
    await expect(page.getByRole("heading", { name: "서울" })).toBeVisible();
    await expect(page.locator(".link-arrival")).toHaveCount(0);
    await context.close();
  });
});
