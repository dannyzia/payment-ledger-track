import type { LocalEntry, CachedPaymentMethod } from '$lib/db';
import { formatPoishaForCsv } from './export-csv';

/**
 * Generates an XML Spreadsheet 2003 (.xlsx/.xls) document compatible with Excel,
 * LibreOffice, and Google Sheets without external binary library baggage.
 * Preserves UTF-8 encoding, exact decimal types, and includes full entry list with totals row.
 */
export function formatMonthlyReportXmlSpreadsheet(
  entries: LocalEntry[],
  month: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): string {
  let sumQty = 0;
  let sumGross = 0n;
  let sumVat = 0n;
  let sumComm = 0n;
  let sumBizFee = 0n;
  let sumCustFee = 0n;
  let sumNet = 0n;

  const escapeXml = (str: string) =>
    str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const entryRows = entries
    .map((e) => {
      sumQty += e.sub_qty;
      sumGross += BigInt(e.gross_poisha);
      sumVat += BigInt(e.vat_poisha);
      sumComm += BigInt(e.commission_poisha);
      sumBizFee += BigInt(e.business_charge_poisha);
      sumCustFee += BigInt(e.customer_charge_poisha);
      sumNet += BigInt(e.net_poisha);

      const methodName = methodsMap[e.method_id]?.name ?? e.method_id;
      return `    <Row>
      <Cell><Data ss:Type="String">${escapeXml(e.entry_number ?? e.local_id)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.entry_date)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.customer_name)}</Data></Cell>
      <Cell><Data ss:Type="Number">${e.sub_qty}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(methodName)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.gross_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.vat_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.commission_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.business_charge_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.customer_charge_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.net_poisha)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.txn_ref ?? '')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.notes ?? '')}</Data></Cell>
    </Row>`;
    })
    .join('\n');

  const totalsRow = `    <Row ss:StyleID="BoldHeader">
      <Cell><Data ss:Type="String">TOTALS</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="Number">${sumQty}</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumGross.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumVat.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumComm.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumBizFee.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumCustFee.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumNet.toString())}</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
    </Row>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="BoldHeader">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Statement-${month}">
    <Table>
      <Row ss:StyleID="BoldHeader">
        <Cell><Data ss:Type="String">Entry Number</Data></Cell>
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Customer</Data></Cell>
        <Cell><Data ss:Type="String">Sub Qty</Data></Cell>
        <Cell><Data ss:Type="String">Method</Data></Cell>
        <Cell><Data ss:Type="String">Gross (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">VAT (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Commission (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Merchant Fee (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Customer Fee (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Net (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Txn Ref</Data></Cell>
        <Cell><Data ss:Type="String">Notes</Data></Cell>
      </Row>
${entryRows}
${totalsRow}
    </Table>
  </Worksheet>
</Workbook>`;
}

/**
 * Minimal structural contract for the Capacitor global (no `any` casts, CLT-D-015 pattern).
 */
interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean } | undefined;
}

export function exportMonthlyReportXlsx(
  entries: LocalEntry[],
  month: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): void {
  // Mobile / Capacitor platform branch (Plan 019 handoff)
  if (typeof window !== 'undefined' && (window as unknown as CapacitorWindow).Capacitor?.isNativePlatform?.()) {
    console.info('[Export XLSX] Delegating to Capacitor Filesystem/Share plugin in Plan 019');
  }

  const xmlContent = formatMonthlyReportXmlSpreadsheet(entries, month, methodsMap);
  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `monthly-statement-${month}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
