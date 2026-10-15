# Receipt and invoice printing

Printing uses the browser's normal print system with page sizes set by CSS (`@page`). Three layouts exist:

| Format | Layout | Typical printer |
|---|---|---|
| 80 mm | 72 mm printable width, monospace | Most POS thermal printers (Xprinter XP-80, Epson TM-T20/T82, Rongta) |
| 58 mm | 48 mm printable width, shorter lines (no SKU column) | Small thermal printers, Bluetooth mobile printers |
| A4 | Full invoice with item table, totals, warranty text | Any office printer, or "Save as PDF" |

There is also a server-generated **PDF** (A4) for e-mailing or WhatsApp: *Sales history → sale → PDF*.

Before every print the POS asks for the paper size: **80 mm**, **58 mm**, **A4 invoice** or **PDF**. The size used last
on that device is pre-selected (press Enter to print it); a new device starts with *Settings → Default print format*.
The receipt then opens in a new tab with the print dialog. Old invoices can be reprinted from *Sales history* (*Print / PDF* button) (reprints are written to the audit log).
The receipt is always rebuilt from the stored sale, so prices changed later never appear on an old invoice.

## One-time printer setup (Windows)

1. Install the printer's Windows driver from the manufacturer (for generic Xprinter-type units use the
   "POS-80" / "POS-58" driver that ships on the CD or on the vendor site).
2. In *Printer properties → Preferences* set the paper to **80 mm × receipt** (or 58 mm). Many drivers call it
   "80(72.1) x 3276 mm" or "Roll paper". Enable "cut paper at end of document" if available.
3. Print a Windows test page to confirm the driver works.

## Browser settings (Chrome / Edge)

Open any receipt, press **Print**, and set once (Chrome remembers per printer):

- **Destination**: the thermal printer
- **Margins**: None (the layout already has 2 mm margins)
- **Scale**: Default / 100%
- **Headers and footers**: off
- **Background graphics**: off (receipts are black text)

Firefox: the same options are under *More settings*; set "Margins: None" and turn off "Print headers and footers".

## Silent printing (optional)

Browsers do not allow a web page to print without a dialog. On the dedicated shop PC you can start Chrome in kiosk
printing mode so the dialog is skipped and the **default** printer is used:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://pos.example.lk/pos
```

Make the thermal printer the Windows default printer. Use this shortcut only on the till PC. Without these flags
everything still works, it just shows the print dialog (press Enter).

For network ESC/POS printing without any dialog you would need a local print helper (for example QZ Tray). That is
not included; the browser print path works with any installed printer.

## Mobile (owner's phone)

On Android, *Share → Print* or the browser print menu can use a Wi-Fi printer or save a PDF. Bluetooth thermal
printers need the vendor's Android print service app installed. The PDF button is the most reliable option on phones.

## Troubleshooting

| Problem | Fix |
|---|---|
| Receipt prints very small in the middle of the paper | Scale is set to "Fit to page" or paper size is A4: set paper to 80 mm roll in the driver and Scale 100% |
| Text is cut off on the right | Wrong format: use 58 mm layout for 58 mm paper; check driver paper width |
| Long blank paper after the receipt | Set the driver paper to roll/"receipt" length, not a fixed long page; enable auto-cut |
| Page header with URL and date appears | Turn off "Headers and footers" in the print dialog |
| The print dialog did not open after a sale | The pop-up was blocked: allow pop-ups for the POS site, or use the print buttons in the "Sale completed" box |
| Logo prints as a black block | Use a simple black-and-white PNG logo; thermal printers cannot print shades |
| Nothing prints, test page also fails | Driver/port problem: reinstall the driver, check USB cable, check the printer is not paused in Windows |
