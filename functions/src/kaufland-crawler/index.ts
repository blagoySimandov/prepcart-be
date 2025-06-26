import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import puppeteer, { Page } from "puppeteer-core";
import { Storage } from "@google-cloud/storage";
import chromium from "@sparticuz/chromium";

const storage = new Storage();

const CONSTANT_URL = "https://www.kaufland.bg/broshuri.html";

const CLOUD_BUCKET = process.env.GCLOUD_PROJECT + ".firebasestorage.app";

export const kauflandCrawler = onRequest(async (request, response) => {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  try {
    await page.goto(CONSTANT_URL, { waitUntil: "networkidle2" });

    const topLevelSelector =
      "div.m-tab-navigation__inner-container div.o-slider-to-grid";
    await page.waitForSelector(topLevelSelector);

    const tiles = await page.$$(
      `${topLevelSelector} > div.o-slider-to-grid__tile`
    );

    for (const tile of tiles) {
      const dateElement = await tile.$(
        "div.m-flyer-tile__text p.m-flyer-tile__validity-date"
      );
      if (!dateElement) continue;

      const dateRangeText = await page.evaluate(
        (el) => el.textContent,
        dateElement
      );
      if (!dateRangeText) continue;

      const [startDateStr, endDateStr] = dateRangeText.split(" – ");
      if (!startDateStr || !endDateStr) continue;

      const parseDate = (dateStr: string) => {
        const [day, month, year] = dateStr.split(".").map(Number);
        return new Date(year, month - 1, day);
      };

      const startDate = parseDate(startDateStr);
      const endDate = parseDate(endDateStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (today >= startDate && today <= endDate) {
        logger.info(`Found a valid brochure for date range: ${dateRangeText}`);

        const button = await tile.$("button.a-button__container");
        if (button) {
          // The button click navigates to the PDF.
          // We need to get the url of the new page.
          const newPagePromise = new Promise((x) =>
            browser.once("targetcreated", (target) => x(target.page()))
          );
          await button.click();

          const newPage = (await newPagePromise) as Page;
          if (newPage) {
            const pdfUrl = newPage.url();
            logger.info(`Navigated to PDF url: ${pdfUrl}`);

            const pdfResponse = await newPage.goto(pdfUrl);
            const pdfBuffer = await pdfResponse!.buffer();

            const fileName = `brochures/kaufland-bg_bulgaria_${startDateStr}_${endDateStr}.pdf`;
            const file = storage.bucket(CLOUD_BUCKET).file(fileName);
            await file.save(pdfBuffer, {
              metadata: { contentType: "application/pdf" },
            });
            logger.info(`Uploaded ${fileName} to ${CLOUD_BUCKET}`);
            await newPage.close();
          }
        }
      }
    }
    response.status(200).send({ success: true });
  } catch (error) {
    logger.error("Error during crawling:", error);
    response.status(500).send({ success: false });
  } finally {
    await browser.close();
  }
});
