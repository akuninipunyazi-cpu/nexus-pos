import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { getReportData, normalizeReport, normalizeReportRange, reportRowCount, REPORT_EXPORT_LIMIT, reportToCsv } from "@/lib/reports";

export async function GET(request: NextRequest) {
  const context = await getSessionContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (context.profile.role !== "STORE_OWNER" || !context.profile.tenant_id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const report = normalizeReport(request.nextUrl.searchParams.get("report") ?? undefined);
  const range = normalizeReportRange(request.nextUrl.searchParams.get("range") ?? undefined);
  const data = await getReportData(range);
  if (!data) return NextResponse.json({ error: "Report unavailable." }, { status: 500 });
  if (reportRowCount(report, data) > REPORT_EXPORT_LIMIT) {
    return NextResponse.json({ error: "This report is too large to export in one file." }, { status: 413 });
  }

  const csv = reportToCsv(report, range, data);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pos-cafe-${report}-${range}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
