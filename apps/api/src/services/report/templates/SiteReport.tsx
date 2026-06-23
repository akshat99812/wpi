/**
 * Root print template (plan §3.3). Composes the six report pages in order from
 * one ReportModel. Pure props → JSX, SSR via renderToStaticMarkup — the running
 * logo header + page numbers are Puppeteer's native header/footer (plan §5.3),
 * not part of this body.
 */

import { Page1Cover } from "./pages/Page1Cover";
import { Page2Resource } from "./pages/Page2Resource";
import { Page3Context } from "./pages/Page3Context";
import { Page4Policy } from "./pages/Page4Policy";
import { Page5Finance } from "./pages/Page5Finance";
import { Page6Disclaimer } from "./pages/Page6Disclaimer";
import type { ReportModel } from "../reportModel";

export function SiteReport({ model }: { model: ReportModel }) {
  return (
    <main>
      <Page1Cover model={model} />
      <Page2Resource model={model} />
      <Page3Context model={model} />
      <Page4Policy model={model} />
      <Page5Finance model={model} />
      <Page6Disclaimer model={model} />
    </main>
  );
}
