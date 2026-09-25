import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stamp } from "../src/components";
const render = (at: string) =>
  renderToStaticMarkup(
    createElement(Stamp, { at, label: "발표", timeZone: "Asia/Seoul" } as any),
  );
it("formats qualified warning instants in KST across midnight without shifting naive source time", () => {
  expect(render("2021-06-16T21:00:00.000Z")).toContain(
    "2021-06-17 06:00:00 KST",
  );
  expect(render("2021-06-17T06:00:00+09:00")).toContain(
    "2021-06-17 06:00:00 KST",
  );
  expect(render("2021-06-17T06:00:00")).toContain("2021-06-17 06:00:00");
  expect(render("2021-06-17T06:00:00")).not.toContain("KST");
  expect(render("invalid")).toContain("정보 없음");
  expect(
    renderToStaticMarkup(
      createElement(Stamp, { at: "2026-09-25T12:00", label: "관측" }),
    ),
  ).toContain("2026-09-25 12:00");
});
