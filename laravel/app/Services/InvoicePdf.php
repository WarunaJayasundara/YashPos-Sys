<?php

namespace App\Services;

use FPDF;

/** A4 PDF invoice from the stored sale snapshot (same layout as the original pdfkit version). */
class InvoicePdf
{
    private const METHOD = ['CASH' => 'Cash', 'CARD' => 'Card', 'BANK_TRANSFER' => 'Bank transfer', 'QR' => 'QR payment', 'CREDIT' => 'On account'];

    // FPDF core fonts are Windows-1252
    private static function t(?string $s): string
    {
        return (string) @iconv('UTF-8', 'windows-1252//TRANSLIT', (string) $s);
    }

    private static function money(mixed $v, string $cur): string
    {
        return $cur.' '.number_format((float) $v, 2, '.', ',');
    }

    private static function localTime(string $iso, string $format): string
    {
        $offset = (int) config('pos.tz_offset_minutes', 330) * 60;

        return gmdate($format, strtotime($iso) + $offset);
    }

    public static function render(array $s, object $st): string
    {
        $pdf = new FPDF('P', 'pt', 'A4');
        $pdf->SetTitle(self::t('Invoice '.$s['invoiceNumber']));
        $pdf->SetAuthor(self::t($st->shopName));
        $pdf->SetMargins(48, 48, 48);
        $pdf->SetAutoPageBreak(false);
        $pdf->AddPage();
        $cur = $st->currency;
        $left = 48;
        $right = 547;

        $tx = $left;
        if ($st->logoUrl && str_starts_with($st->logoUrl, '/uploads/')) {
            $file = public_path('uploads/'.basename($st->logoUrl));
            if (is_file($file) && preg_match('/\.(png|jpe?g)$/i', $file)) {
                try {
                    $pdf->Image($file, $left, 44, 64, 0);
                } catch (\Throwable) {
                    // unreadable image: print without a logo
                }
            }
            $tx = $left + 76;
        }
        $pdf->SetFont('Helvetica', 'B', 20);
        $pdf->SetXY($tx, 48);
        $pdf->Cell(250, 22, self::t($st->shopName));
        $pdf->SetFont('Helvetica', '', 9);
        $pdf->SetTextColor(68, 68, 68);
        $y = 72;
        foreach (array_filter([$st->address, $st->phone ? "Tel: $st->phone" : null, $st->email, $st->taxRegNo ? "$st->taxLabel Reg. No: $st->taxRegNo" : null]) as $line) {
            $pdf->SetXY($tx, $y);
            $pdf->Cell(250, 12, self::t($line));
            $y += 12;
        }

        $pdf->SetTextColor(0, 0, 0);
        $pdf->SetFont('Helvetica', 'B', 16);
        $pdf->SetXY(350, 48);
        $pdf->Cell($right - 350, 18, $s['status'] === 'VOIDED' ? 'INVOICE (VOID)' : 'INVOICE', 0, 0, 'R');
        $pdf->SetFont('Helvetica', '', 9);
        $meta = [['Invoice No', $s['invoiceNumber']], ['Date', self::localTime($s['createdAt'], 'd/m/Y, H:i:s')], ['Cashier', $s['cashierName']]];
        if ($s['customerName'] || $s['customerPhone']) {
            $meta[] = ['Customer', implode(' / ', array_filter([$s['customerName'], $s['customerPhone']]))];
        }
        $my = 72;
        foreach ($meta as [$k, $v]) {
            $pdf->SetXY(300, $my);
            $pdf->Cell($right - 300, 12, self::t("$k: $v"), 0, 0, 'R');
            $my += 13;
        }

        $y = max($y, $my) + 18;
        $cols = [$left, $left + 230, $left + 300, $left + 380, $left + 440];
        $pdf->SetFillColor(238, 241, 246);
        $pdf->Rect($left, $y - 4, $right - $left, 18, 'F');
        $pdf->SetFont('Helvetica', 'B', 9);
        foreach (['Item', 'Qty', 'Unit price', 'Discount', 'Amount'] as $i => $h) {
            $w = $i === 0 ? 225 : ($cols[$i + 1] ?? $right) - $cols[$i];
            $pdf->SetXY($cols[$i], $y);
            $pdf->Cell($w, 11, $h, 0, 0, $i === 0 ? 'L' : 'R');
        }
        $y += 20;
        $pdf->SetDrawColor(227, 230, 234);
        foreach ($s['items'] as $it) {
            if ($y > 720) {
                $pdf->AddPage();
                $y = 48;
            }
            $pdf->SetFont('Helvetica', '', 9);
            $pdf->SetXY($cols[0], $y);
            $pdf->MultiCell(225, 11, self::t($it['productName']));
            $h = $pdf->GetY() - $y;
            $pdf->SetFont('Helvetica', '', 7);
            $pdf->SetTextColor(102, 102, 102);
            $sub = 'SKU '.$it['sku'].($it['serialNumber'] ? '  S/N '.$it['serialNumber'] : '').($it['warrantyMonths'] ? '  Warranty '.$it['warrantyMonths'].' mo' : '');
            $pdf->SetXY($cols[0], $y + $h);
            $pdf->Cell(225, 9, self::t($sub));
            $pdf->SetTextColor(0, 0, 0);
            $pdf->SetFont('Helvetica', '', 9);
            $cells = [[$cols[1], 70, (string) $it['qty']], [$cols[2], 80, self::money($it['unitPrice'], $cur)],
                [$cols[3], 60, (float) $it['lineDiscount'] ? self::money($it['lineDiscount'], $cur) : '-'], [$cols[4], $right - $cols[4], self::money($it['lineTotal'], $cur)]];
            foreach ($cells as [$x, $w, $text]) {
                $pdf->SetXY($x, $y);
                $pdf->Cell($w, 11, self::t($text), 0, 0, 'R');
            }
            $y += $h + 14;
            $pdf->Line($left, $y - 4, $right, $y - 4);
        }

        $totals = [['Subtotal', self::money((float) $s['subtotal'] - (float) $s['lineDiscount'], $cur), false]];
        if ((float) $s['billDiscount']) {
            $totals[] = ['Bill discount', '- '.self::money($s['billDiscount'], $cur), false];
        }
        if ((float) $s['taxAmount']) {
            $totals[] = [$st->taxLabel.' ('.$s['taxRate'].'%)', self::money($s['taxAmount'], $cur), false];
        }
        $totals[] = ['Grand total', self::money($s['total'], $cur), true];
        foreach ($s['payments'] as $p) {
            $totals[] = ['Paid - '.(self::METHOD[$p['method']] ?? $p['method']), self::money($p['amount'], $cur), false];
        }
        if ((float) $s['amountTendered']) {
            $totals[] = ['Cash received', self::money($s['amountTendered'], $cur), false];
            $totals[] = ['Change', self::money($s['changeDue'], $cur), false];
        }
        if ((float) $s['balanceDue']) {
            $totals[] = ['Balance due', self::money($s['balanceDue'], $cur), true];
        }
        $y += 6;
        foreach ($totals as [$k, $v, $bold]) {
            $pdf->SetFont('Helvetica', $bold ? 'B' : '', $bold ? 11 : 9);
            $pdf->SetXY(330, $y);
            $pdf->Cell(110, 12, self::t($k), 0, 0, 'R');
            $pdf->SetXY(440, $y);
            $pdf->Cell($right - 440, 12, self::t($v), 0, 0, 'R');
            $y += $bold ? 17 : 13;
        }
        foreach ($s['returns'] as $r) {
            $pdf->SetFont('Helvetica', '', 8);
            $pdf->SetTextColor(170, 0, 0);
            $pdf->SetXY($left, $y + 4);
            $pdf->Cell($right - $left, 10, self::t("Returned {$r['returnNumber']} on ".self::localTime($r['createdAt'], 'd/m/Y').': refund '.self::money($r['refundTotal'], $cur)));
            $y += 12;
        }
        $pdf->SetTextColor(0, 0, 0);
        $y += 24;
        if ($s['notes']) {
            $pdf->SetXY($left, $y);
            $pdf->SetFont('Helvetica', 'B', 9);
            $pdf->Write(11, 'Note: ');
            $pdf->SetFont('Helvetica', '', 9);
            $pdf->Write(11, self::t($s['notes']));
            $y = $pdf->GetY() + 21;
        }
        if ($st->warrantyPolicy) {
            $pdf->SetXY($left, $y);
            $pdf->SetFont('Helvetica', 'B', 8);
            $pdf->Cell($right - $left, 10, 'Warranty');
            $pdf->SetFont('Helvetica', '', 8);
            $pdf->SetXY($left, $y + 10);
            $pdf->MultiCell($right - $left, 10, self::t($st->warrantyPolicy));
            $y = $pdf->GetY() + 10;
        }
        $pdf->SetFont('Helvetica', '', 9);
        $pdf->SetXY($left, $y);
        $pdf->MultiCell($right - $left, 11, self::t($st->receiptFooter), 0, 'C');

        return $pdf->Output('S');
    }
}
