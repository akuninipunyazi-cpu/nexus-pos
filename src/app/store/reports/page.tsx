import Link from "next/link";
import { getAnalyticsPeriod } from "@/lib/analytics";
import { getReportData, normalizeReport, normalizeReportRange, REPORT_OPTIONS, type ReportKind } from "@/lib/reports";
import { requireStoreOwner } from "@/lib/store";
import { ReportsView } from "@/components/store/reports-view";

const PERIOD_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string; range?: string }> }) {
  await requireStoreOwner();
  const params = await searchParams;
  const report = normalizeReport(params.report);
  const range = normalizeReportRange(params.range);
  const data = await getReportData(range);
  const period = getAnalyticsPeriod(range);
  const linkFor = (nextReport: ReportKind, nextRange = range) => `/store/reports?report=${nextReport}&range=${nextRange}`;
  const exportHref = `/store/reports/export?report=${report}&range=${range}`;

  return (
    <div className="reports-page">
      <div className="page-heading-row reports-heading">
        <div>
          <p className="eyebrow">Store workspace</p>
          <h1 className="page-title">Reports</h1>
          <p className="page-intro">Structured views of recorded sales, stock, purchasing, and kitchen activity.</p>
        </div>
        <div className="reports-period">
          <span>Reporting period</span>
          <strong>{period.label} - Asia/Jakarta</strong>
          <a className="primary-button compact" href={exportHref}>Export CSV</a>
        </div>
      </div>

      <nav className="report-tabs" aria-label="Report category">
        {REPORT_OPTIONS.map((option) => <Link key={option.key} className={report === option.key ? "selected" : ""} aria-current={report === option.key ? "page" : undefined} href={linkFor(option.key)}>{option.label}</Link>)}
      </nav>

      <div className="report-period-tabs" aria-label="Reporting period">
        {PERIOD_OPTIONS.map((option) => <Link key={option.key} className={range === option.key ? "selected" : ""} aria-current={range === option.key ? "page" : undefined} href={linkFor(report, option.key)}>{option.label}</Link>)}
      </div>

      {!data ? <div className="large-empty"><h2>Report unavailable.</h2><p>The server could not load this tenant report. No values were fabricated.</p></div> : <ReportsView data={data} report={report} />}
    </div>
  );
}
