# Wazabin POS DESIGN.md

## Visual Theme & Atmosphere
Operational retail POS with calm density: fast to scan, comfortable on tablets, and clear under checkout pressure. The interface should feel like a back-office tool, not a marketing page.

## Color Palette & Roles
- Canvas: `#f6f8fb` for the app background.
- Surface: `#ffffff` for panels, forms, and repeated rows.
- Ink: `#111827` for primary text and totals.
- Muted: `#64748b` for helper text and secondary metadata.
- Primary: `#2563eb` for active selections and main actions.
- Secondary: `#0f766e` for successful scanner/import states.
- Warning: `#c2410c` for scanner misses and stock warnings.
- Border: `rgba(15, 23, 42, 0.12)` for quiet separation.

## Typography Rules
Use `IBM Plex Sans Thai` for Thai-heavy operational screens. Headings should be compact, direct, and no larger than needed inside panels. Use numeric emphasis for totals, stock counts, and branch metrics.

## Component Styling
- Panels: white, 1px border, 8px radius, soft shadow.
- Buttons: 8px radius, clear active state, minimum 38px height.
- Inputs: 42px minimum height with strong focus outline.
- Product tiles: fixed structure with name, SKU/barcode badge, stock pill, and price.
- Scanner strip: always visible on POS view, high-contrast focus input, success/error feedback.

## Layout Principles
First screen is the working POS: product grid, current order, and payment summary. Keep branch controls and day metrics in the header. Import and report surfaces are secondary tabs.

## Responsive Behavior
Desktop uses three operational columns. Tablet/mobile stacks panels vertically, keeps scanner input near the top, and preserves large tap targets.

## Do's And Don'ts
- Do prioritize barcode flow, branch context, stock visibility, and checkout speed.
- Do keep repeated controls predictable and close to the data they affect.
- Do not add hero marketing sections, decorative blobs, or oversized editorial type.
- Do not hide critical state like active branch or failed barcode scans.
